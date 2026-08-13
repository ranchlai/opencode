import { Installation } from "@/installation"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  streamText,
  generateText,
  wrapLanguageModel,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
  tool,
  jsonSchema,
} from "ai"
import { mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { PermissionNext } from "@/permission/next"
import { Auth } from "@/auth"

export namespace LLM {
  const log = Log.create({ service: "llm" })
  export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    permission?: PermissionNext.Ruleset
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    toolChoice?: "auto" | "required" | "none"
    stream?: boolean
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
      .tag("mode", input.agent.mode)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [language, cfg, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get(),
      Provider.getProvider(input.model.providerID),
      Auth.get(input.model.providerID),
    ])
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    l.info("stream mode", {
      useStream: input.stream ?? !cfg.experimental?.disable_stream,
      disable_stream: cfg.experimental?.disable_stream,
    })

    const system = []
    system.push(
      [
        // use agent prompt otherwise provider prompt
        // For Codex sessions, skip SystemPrompt.provider() since it's sent via options.instructions
        ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )

    const header = system[0]
    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID, model: input.model },
      { system },
    )
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )
    if (isCodex) {
      options.instructions = SystemPrompt.instructions()
    }

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const { headers } = await Plugin.trigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    const maxOutputTokens =
      isCodex || provider.id.includes("github-copilot") ? undefined : ProviderTransform.maxOutputTokens(input.model)

    const tools = await resolveTools(input)

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.["litellmProxy"] === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    const useStream = input.stream ?? !cfg.experimental?.disable_stream

    const commonParams = {
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions: ProviderTransform.providerOptions(input.model, params.options),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      toolChoice: input.toolChoice,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: {
        ...(input.model.providerID.startsWith("opencode")
          ? {
              "x-opencode-project": Instance.project.id,
              "x-opencode-session": input.sessionID,
              "x-opencode-request": input.user.id,
              "x-opencode-client": Flag.OPENCODE_CLIENT,
            }
          : input.model.providerID !== "anthropic"
            ? {
                "User-Agent": `opencode/${Installation.VERSION}`,
              }
            : undefined),
        ...input.model.headers,
        ...headers,
      },
      maxRetries: input.retries ?? 0,
      messages: [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...input.messages,
      ],
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
              }
              return args.params
            },
          },
        ],
      }),
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
          sessionId: input.sessionID,
        },
      },
    }

    if (useStream) {
      return streamText({
        onError(error) {
          l.error("stream error", {
            error,
          })
        },
        async experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.toLowerCase()
          if (lower !== failed.toolCall.toolName && tools[lower]) {
            l.info("repairing tool call", {
              tool: failed.toolCall.toolName,
              repaired: lower,
            })
            return {
              ...failed.toolCall,
              toolName: lower,
            }
          }
          return {
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error.message,
            }),
            toolName: "invalid",
          }
        },
        ...commonParams,
      })
    }

    l.info("commonParams", { commonParams })
    const result = await generateText({
      ...commonParams,
    })
    l.info("result", { result })
    // also write the commonParams and result to prompt.json and result.json
  


    return {
      fullStream: (async function* () {
        l.info("emit event", { type: "start" })
        yield { type: "start" as const }
        const textId = "ns-" + Date.now()
        const reasoningId = "ns-reasoning-" + Date.now()

        // Emit reasoning events
        if (result.reasoning && result.reasoning.length > 0) {
          const reasoningText = result.reasoning.map((r) => r.text).join("")
          l.info("emit event", { type: "reasoning-start", reasoningId })
          yield { type: "reasoning-start" as const, id: reasoningId }
          l.info("emit event", { type: "reasoning-delta", reasoningId, text: reasoningText.substring(0, 100) })
          yield { type: "reasoning-delta" as const, id: reasoningId, text: reasoningText }
          l.info("emit event", { type: "reasoning-end", reasoningId })
          yield { type: "reasoning-end" as const, id: reasoningId }
        }

        if (result.text) {
          l.info("emit event", { type: "text-start", textId })
          yield {
            type: "text-start" as const,
            id: textId,
            providerMetadata: undefined,
          }
          l.info("emit event", { type: "text-delta", textId, text: result.text.substring(0, 100) })
          yield {
            type: "text-delta" as const,
            id: textId,
            text: result.text,
            providerMetadata: undefined,
          }
          l.info("emit event", { type: "text-end", textId })
          yield {
            type: "text-end" as const,
            id: textId,
            providerMetadata: undefined,
          }
        }
        if (result.toolCalls && result.toolCalls.length > 0) {
          for (const tc of result.toolCalls) {
            const tcAny = tc as unknown as { toolCallId: string; toolName: string; input: unknown }
            l.info("emit event", { type: "tool-input-start", toolCallId: tcAny.toolCallId, toolName: tcAny.toolName })
            yield {
              type: "tool-input-start" as const,
              id: tcAny.toolCallId,
              toolName: tcAny.toolName,
            }
            l.info("emit event", { type: "tool-call", toolCallId: tcAny.toolCallId, toolName: tcAny.toolName })
            yield {
              type: "tool-call" as const,
              toolCallId: tcAny.toolCallId,
              toolName: tcAny.toolName,
              input: tcAny.input as object,
              providerMetadata: undefined,
            }
          }
          for (const tr of result.toolResults ?? []) {
            l.info("emit event", { type: "tool-result", toolCallId: tr.toolCallId, toolName: tr.toolName })
            yield {
              type: "tool-result" as const,
              toolCallId: tr.toolCallId,
              toolName: tr.toolName,
              input: tr.input,
              output: tr.output,
            }
          }
          // generateText puts failed calls in steps as tool-error, not toolResults.
          // Without these, the processor leaves tools "running" and shows "Tool execution aborted".
          for (const step of result.steps ?? []) {
            for (const part of step.content ?? []) {
              if (part.type !== "tool-error") continue
              const err = part.error
              const message =
                err instanceof Error
                  ? err.message
                  : typeof err === "string"
                    ? err
                    : err && typeof err === "object" && "message" in err && typeof err.message === "string"
                      ? err.message
                      : "Tool execution failed"
              l.info("emit event", { type: "tool-error", toolCallId: part.toolCallId, toolName: part.toolName })
              yield {
                type: "tool-error" as const,
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
                error: new Error(message),
              }
            }
          }
        }
        l.info("emit event", { type: "finish-step", finishReason: result.finishReason ?? "stop" })
        yield {
          type: "finish-step" as const,
          finishReason: result.finishReason ?? "stop",
          usage: result.usage
            ? {
                inputTokens: result.usage.inputTokens ?? 0,
                outputTokens: result.usage.outputTokens ?? 0,
                totalTokens: result.usage.totalTokens ?? 0,
              }
            : undefined,
          providerMetadata: undefined,
        }
      })(),
      text: Promise.resolve(result.text),
      toolCalls: Promise.resolve(result.toolCalls),
    } as unknown as StreamOutput
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">) {
    const disabled = PermissionNext.disabled(
      Object.keys(input.tools),
      PermissionNext.merge(input.agent.permission, input.permission ?? []),
    )
    for (const tool of Object.keys(input.tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
    return input.tools
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }
}

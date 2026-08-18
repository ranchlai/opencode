---
marp: true
title: 如何使用 OpenCode
description: 基础、Superpowers、Ralph Loop、Agent 循环，再到 /loop、/team
paginate: true
lang: zh-CN
---

<!-- Slide 1 -->

# 如何使用 OpenCode

本 fork — TUI、`/loop`、`/team` 与项目级控制

*先讲基础。进阶才是本次分享的重点。*

英文版：`tutorial/slides.md`

---

<!-- Slide 2 -->

# 目录

1. **基础** — 是什么、第一次会话、TUI
2. **定制 Agent** — 配置、规则、权限
3. **扩展能力** — 命令、skills、tools、plugins、MCP
4. **Superpowers** — 设计 → 计划 → TDD
5. **Agent 循环** — 一轮一轮直到停下
6. **Ralph Loop / `/loop`** — 无人值守，直到完成
7. **并行** — `/team`
8. **运维** — 非流式、CLI、serve
9. **什么时候用什么**

---

<!-- Slide 3 -->

# OpenCode 是什么

开源 **AI 编程 Agent**。不绑定模型供应商。内置 LSP 支持。

| 界面 | 命令 | 用途 |
| --- | --- | --- |
| TUI | `opencode` / `bun dev` | 日常工作 |
| 一次性 | `opencode run "…"` | 脚本、CI |
| 服务 | `opencode serve` | 无界面 / 远程 TUI |

底层只有一套会话引擎，TUI 只是主客户端。

---

<!-- Slide 4 -->

# 跑 *这个* 仓库

公开的 `npm i -g opencode-ai` 是**上游**包。本 fork 并非那个包。

```bash
bun install
bun dev /path/to/project     # TUI
./build.sh --single          # 二进制 → packages/opencode/dist/
```

需要 **Bun 1.3+**、现代终端、LLM API 密钥、git（`/undo` 依赖它）。

---

<!-- Slide 5 -->

# 第一次会话

```bash
bun dev auth login           # 或在 TUI 里 /connect
bun dev models
cd ~/code/my-app && bun dev ~/code/my-app
```

然后在输入框里：

```text
/models          → 选择 provider/model
/init            → 生成 AGENTS.md，然后提交
```

```text
Map agents/, robot/, and how the LLM planner calls tools.
```

---

<!-- Slide 6 -->

# TUI 基础

| 想做 | 怎么做 |
| --- | --- |
| 附上文件 | `@path` 模糊搜索 |
| 执行 shell 命令 | `!git status` |
| 切换 Agent | `Tab` / `Shift+Tab` |
| 停止生成 | `Escape` |
| 命令面板 | `Ctrl+P` |
| Leader 快捷键 | `Ctrl+X` 再按一个字母 |

`N` 新会话 · `L` 会话列表 · `M` 模型 · `U` 撤销 · `C` 压缩 · `H` 帮助 · `Q` 退出

---

<!-- Slide 7 -->

# Agent

**主 Agent**（你直接对话的）：

- **build** — 默认，工具全开
- **plan** — 分析；改文件和执行 bash 前先 *询问*

**子 Agent**（`@name`，或由主 Agent 派生）：

- **explore** — 快速、只读搜索
- **general** — 多步任务，可以改代码

典型流程：**plan → 达成一致 → Tab 切到 build → 小改动 → 出错就 `/undo`**。

---

<!-- Slide 8 -->

# 进阶：配置是分层的

优先用**项目本地**文件。放入 git 与团队共享。

```text
opencode.json          模型、权限、loop、experimental
tui.json               主题、快捷键   ← 不在 opencode.json 里
AGENTS.md              长期说明
.cursor/rules/*.mdc    兼容 Cursor 的规则
.opencode/             commands、agents、skills、plugins、tools
```

个人默认：`~/.config/opencode/`
凭据：`~/.local/share/opencode/auth.json`

---

<!-- Slide 9 -->

# 进阶：让它熟悉仓库

**`AGENTS.md`** — 目录结构、测试命令、风格、哪些文件不要动。

**Cursor `.mdc`** — 自动发现，不必在配置里逐条列出。

```markdown
---
description: Python agent conventions
globs: agents/**/*.py, robot/**/*.py
alwaysApply: false
---
- Type hints on public functions. Pytest for behavior.
- Planner owns the LLM loop; robot/ is motion only.
```

| Frontmatter | 效果 |
| --- | --- |
| `alwaysApply: true` | 每次会话都注入 |
| `globs` | 读取匹配文件时附加 |
| 只有 `description` | 任务相关时由 Agent 自行加载 |

---

<!-- Slide 10 -->

# 进阶：权限

`"allow"` · `"ask"` · `"deny"` — 按工具区分，支持 glob。

```json
{
  "permission": {
    "*": "ask",
    "edit": "allow",
    "bash": {
      "*": "ask",
      "git *": "allow",
      "pytest*": "allow",
      "rm *": "deny"
    }
  }
}
```

plan Agent 对 edit/bash 本来就会 *询问*。无人值守 `/loop` 时再进一步收紧。

---

<!-- Slide 11 -->

# 进阶：自定义斜杠命令

`.opencode/command/test.md`

```markdown
---
description: 运行测试并修复失败
agent: build
---
运行 pytest。修复最小范围的文件，让测试变绿。
$ARGUMENTS
```

```text
/test agents/planner
```

`$ARGUMENTS`、`$1`、`$2` · 反引号注入 shell 输出 · 可选 `model` / `subtask`。

---

<!-- Slide 12 -->

# 进阶：Skills（按需加载）

一个目录 + `SKILL.md`。Agent 先看到 **name + description**，再用 `skill` 工具加载正文。

```text
.opencode/skills/git-release/SKILL.md
```

```markdown
---
name: git-release
description: Changelog、tag、健全性检查。除非要求，否则不要推送 tag。
---
```

还有：`.claude/skills/`、`.agents/skills/`、`~/.config/opencode/skills/`。

描述写得具体，模型才能选对 skill。

---

<!-- Slide 13 -->

# 进阶：自定义 tools 与 plugins

**Tools** — 供 LLM 调用的函数。

```ts
// .opencode/tools/database.ts  → 工具名 "database"
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "查询机器人遥测数据（位姿、电量、上一次工具调用）",
  args: { query: tool.schema.string() },
  async execute(args) { /* ... */ },
})
```

**Plugins** — 事件钩子（会话结束、chat params、headers）。

- 本地：`.opencode/plugin/*.ts`
- npm：在 `opencode.json` 里 `"plugin": ["some-package"]`

---

<!-- Slide 14 -->

# 进阶：MCP

外部工具（浏览器、工单、文档）。它们会**占用上下文**。

```json
{
  "mcp": {
    "browser": {
      "type": "local",
      "command": ["npx", "-y", "some-mcp-server"]
    }
  }
}
```

```bash
opencode mcp add
opencode mcp list
```

少开几个。GitHub 一类 MCP 很容易把上下文窗口撑爆。

---

<!-- Slide 15 -->

# Superpowers — 方法论插件

不是新的斜杠命令。本仓库的 `opencode.json` 已经在加载它。

| 部件 | 作用 |
| --- | --- |
| **Bootstrap**（`using-superpowers`） | 注入到第一条用户消息。只要 skill 可能相关，**先调用再回答**。 |
| **Skills** | 流程手册：brainstorming、TDD、systematic-debugging、… |
| **Plugin** | 注册这些 skills，并注入 bootstrap |

- **TDD** — 没有失败测试，不写生产代码
- **系统性** — 先找根因，再修
- **YAGNI** — 能跑起来的最小设计

Skills 是**必须走的流程**，不是建议。和 `/loop`、`/team` 相互独立 — 先 brainstorm，再用它们去执行。

---

<!-- Slide 16 -->

# Superpowers — 怎么加载

```json
"plugin": ["superpowers@git+https://github.com/obra/superpowers.git"]
```

启动时：按 git spec 拉取 → 把 bootstrap 注入**第一条**用户消息 → 用 `skill` 工具加载手册。

新会话（`/new`）冒烟测试：

```text
Tell me about your superpowers
```

它应能说出这个库的名字，以及规则：**动手前先调 skill**。然后再试：

```text
Let's add max_steps to the Python LLM planner so tool calls cannot loop forever.
```

期望先走 **brainstorming**（提问、短设计、等你点头）— 这时还不写代码。

---

<!-- Slide 17 -->

# Superpowers — 默认功能路径

```text
brainstorming     → spec（你批准）
writing-plans     → plan 文件
每个任务做 TDD    → 红 → 绿 → 重构（+ review）
收尾分支
```

| 你说 | 先走哪个 skill |
| --- | --- |
| “Let's add max_steps to the planner” | **brainstorming** — 设计没 OK 之前不写代码 |
| “Planner never stops calling tools” | **systematic-debugging** |
| 按计划实现 | **test-driven-development** |

硬门槛：「这太简单了」也要一份短设计。之后如果工作量大或要并行，再用 `/loop` 或 `/team`。

---

<!-- Slide 18 -->

# Ralph Loop — 不达目的不罢休

名字来自《辛普森一家》的 **Ralph Wiggum**：屡败屡战，永不放弃。

一种让 AI 编程助手**自主持续迭代**、直到复杂任务真正完成的工作模式。不是一次性回答。

普通助手一轮就停下，复杂任务经常半途而废。Ralph Loop **拒绝闲置**。

本 fork 的 `/loop` 就是这套模式：完成暗号、拦截退出、直到目标完成（或预算用尽）。

---

<!-- Slide 19 -->

# Ralph Loop — 核心机制

从「一次性回答」到「持续工作」：

1. 下达**任务**和**完成暗号**（经典：`<promise>DONE</promise>`；这里：`LOOP_DONE`）
2. AI 开始干活：改代码、跑测试、提交
3. **拦截退出** — 它准备停下时，Stop Hook / tick 把它拦住
4. **检查暗号**
   - 没有 → 把原任务再喂回去，从仓库现有结果继续
   - 有了 → 循环结束
5. **进度在文件系统里积累** — 每轮可以是新窗口（或 compaction）；代码、测试日志、git 才是长期记忆

```text
干活 → 要停了 → 有暗号？  没有 → nudge / 再提示 → 继续干
                         有   → 完成
```

---

<!-- Slide 20 -->

# Ralph Loop — HITL、AFK、安全

**价值：** 可以短时间**无人值守（AFK）**。设好任务走开，回来验收。

| 模式 | 何时用 |
| --- | --- |
| **人在回路（HITL）** | 盯着每一步，随时介入。学习和调试首选。 |
| **无人值守（AFK）** | 提示词和任务边界够清楚，就让它自己跑。 |

**安全（防止无限循环）：**

- **最大迭代次数** — 硬上限（这里：`/loop 50` 或截止时间 `2h`）
- **人工中断** — `/loop stop`（经典 Ralph：`/cancel-ralph`）

**它不是 TDD / YAGNI。** 那是「如何写出好代码」的开发实践；Ralph 是「如何让 AI 持续干到完」的自动化策略。两者可以叠加：每轮走红 → 绿 → 重构；提示词里写明 YAGNI — 只写当前任务要的最少代码。

---

<!-- Slide 21 -->

# Agent 循环

OpenCode 不是「一次提问对应一次 LLM 调用」。

一个 **session** 会在 `SessionPrompt.loop` 里保持 **busy**，直到模型**不再调工具**（或你按 Escape / 硬停止）。

两种不同的「循环」：

| 循环 | 代码 | 职责 |
| --- | --- | --- |
| **会话循环** | `prompt.ts` `loop()` | 继续转：LLM → 工具 → compact → 再来 |
| **自主 `/loop`** | `loop.ts` `tick()` | 停下后注入 nudge，让它继续朝目标干活 |

本节剩下的是**会话循环**。`/loop` 叠在它上面。

---

<!-- Slide 22 -->

# 一张图

```text
  用户消息  （或 /command，或 /loop nudge）
           │
           ▼
    ┌─────────────────────────────┐
    │     SessionPrompt.loop      │
    │         while true          │
    │                             │
    │  有 pending subtask? → 执行 │
    │  overflow?         → compact│
    │  否则: LLM + tools          │
    │                             │
    │  finish = tool-calls → 再来 │
    │  finish = stop              │
    │       │                     │
    │       ▼                     │
    │  /loop 进行中? → 合成       │
    │       用户 nudge → 再来     │
    │  否则 break（idle）         │
    └─────────────────────────────┘
```

状态：循环内是 **busy**，退出后是 **idle**。

---

<!-- Slide 23 -->

# 一步（一次 LLM 回合）

不是 subtask / compaction 的每一轮：

1. 加载消息（跳过已经 compact 过的）
2. 解析 **agent**、**tools**、**permissions**、system prompt
   （`AGENTS.md`、skills、team prompt、environment）
3. 创建一条 **assistant** 消息
4. `SessionProcessor.process` → `LLM.stream()`（`streamText` 或 `generateText`）
5. 流式事件变成 parts：reasoning、text、tool calls
6. 工具执行（edit、bash、read、…）。这一步会 snapshot git patch。

然后**会话循环看 `finish`**，决定：再跑一轮、compact，还是停。

---

<!-- Slide 24 -->

# 为什么它会继续转

模型的 finish reason 就是开关：

| `finish` | 含义 | 会话循环 |
| --- | --- | --- |
| `tool-calls` | 「我还要调工具」 | **继续** — 跑工具，再调 LLM |
| `stop` / `end_turn` | 模型说完了 | 检查 `/loop` tick，否则 **退出** |
| `unknown` | 不明确 | 当作还在进行中 |
| error / abort / deny | 硬停止 | **退出**（deny 可配置成不停） |

所以「Agent 循环」**就是** 调工具：读 → 想 → 改 → 测 → 再想 … 直到 stop。

`agent.steps` 限制最多转多少轮。

---

<!-- Slide 25 -->

# 循环中的 Compaction

上下文有限。溢出**不会**杀掉会话。

```text
tokens 太高
    → 入队 compaction part
    → compaction agent 总结历史
    → 带着摘要继续循环
```

- 在 assistant 结束之后**以及** processor 一步之后都会检查
- `/compact` 是手动版（`auto: false`）
- 会话循环退出后，旧的工具输出可能被 **prune**

这就是 `/loop` 能跑几小时的原因：compaction 是**循环的一轮**，不是终点。

---

<!-- Slide 26 -->

# Processor 内部

`SessionProcessor` 在流外面还有自己的 `while (true)`：

- **Retry** 瞬时 API 错误（状态 = retry，退避）
- **Doom loop** — 同一工具 + 同一参数 **3 次** → 权限 `doom_loop`
- **权限 / 提问被拒绝** → 通常 `stop` 会话循环
  （`experimental.continue_loop_on_deny` 可让它继续）
- **Escape** 中止流；未完成的工具标成 error
- 工具结果写回 parts，**下一次** LLM 调用能看见

子 Agent（`task` / `@explore`）**不是** lead 里再套一层会话循环：它们是 pending **subtask** part，外层循环执行完再继续。

---

<!-- Slide 27 -->

# `/loop` 怎么用上这一套

当会话循环本来要**退出**（assistant 的 `finish` 是真正的 stop）：

```text
SessionLoop.tick(session)
```

| Assistant 说了 | tick 做什么 |
| --- | --- |
| `LOOP_BLOCKED` | 结束自主循环，会话 idle |
| `LOOP_DONE` | 跑 `loop.verify`；失败 → **合成用户消息**，继续 |
| 预算用尽 | 结束（`deadline` / `max` 轮数） |
| 还没完 | 注入 **nudge**（目标、轮次、verify 命令）作为合成用户消息 |

那条合成消息就是又一轮用户输入 — **同一个**会话循环再启动。

`/loop` 并不替换 Agent 循环。它**拒绝 idle**，直到目标完成。

---

<!-- Slide 28 -->

# `/loop` — 长目标

本 fork 的 **Ralph Loop**。跨 **compaction** 继续干活。你不用盯着喊 “continue”。

这里的完成暗号是 **`LOOP_DONE`**（需要你出面则 **`LOOP_BLOCKED`**）。

```text
/loop 2h make pytest tests/test_planner.py green
/loop 50 @docs/agent-loop.md
/loop 2h 30 cap planner tool calls with max_steps
/loop stop
```

| 预算 | 含义 |
| --- | --- |
| `2h` `30m` `1d` | 截止时间 |
| `50` | 最多续多少轮 |
| 文本或 `@file` | 目标 |

Agent 必须以 **`LOOP_DONE`** 或 **`LOOP_BLOCKED`** 结束。

---

<!-- Slide 29 -->

# `/loop` — 要 verify，否则只靠自觉

```json
{
  "loop": {
    "verify": ["pytest -q"]
  }
}
```

收到 `LOOP_DONE` 时：

1. 在项目目录依次跑每条命令
2. 全部退出码 `0` → 循环结束
3. 任一失败 → **拒绝**；Agent 拿到 stdout 继续干

`LOOP_BLOCKED` 一定停（密钥、不可逆选择、缺依赖）。

状态存在 SQLite — 重启可以**接着同一个 loop**。

---

<!-- Slide 30 -->

# `/loop` — 写出能完成的目标

**差：** “改进这个代码库”

**好：** “让 `pytest tests/test_planner.py` 全绿。不要改公开的 Agent API。”

- 完成条件要具体
- 永远配上 `loop.verify`
- 用轮数或时间预算，卡住的 Agent 不能无限跑
- 约定写进 `AGENTS.md`，不要写在 loop 提示词里

---

<!-- Slide 31 -->

# `/team` — 并行专家

一个 **lead** 会话 + 具名队友 + 共享任务板。

**默认关闭：**

```bash
OPENCODE_EXPERIMENTAL_TEAM_MODE=1 bun dev /path/to/project
```

```text
/team review the LLM planner for unbounded tool loops and add pytest
```

Lead：建队 → 拆任务 → 派生 2–3 个专家 → 协调 → merge → cleanup。

标题栏徽章：`team:planner · 2 busy · 1 idle`

---

<!-- Slide 32 -->

# `/team` — 派生方式

```js
team({ action: "create", name: "planner", delegate: true })

team({ action: "spawn", member: "scout", agent: "explore",
       prompt: "Map the LLM tool loop in agents/planner.py; find missing max_steps", worktree: false })

team({ action: "spawn", member: "builder", agent: "build",
       prompt: "Add pytest for unbounded tool calls; cap with max_steps", plan_approval: true })

team({ action: "tasks", task_action: "add", title: "map planner tool loop" })
team({ action: "status" })
```

- 调研：`explore`，**不要 worktree**
- 实现：`build`，worktree **默认开**
- 高风险写者：`plan_approval: true` — lead 必须 `approve`

---

<!-- Slide 33 -->

# `/team` — 看板、merge、cleanup

```text
add → pending（或被 deps 挡住）
    → claim → claimed
    → complete → done
```

```js
team({ action: "message", to: "builder", text: "Planner loop first, then robot/control" })
team({ action: "message", to: "*", text: "Do not touch robot/firmware" })
team({ action: "merge", member: "builder" })
team({ action: "cleanup" })
```

空闲成员**以及 lead** 收到消息会自动唤醒。嵌套的 `task` 子 Agent **不能**用 `team`。

优先 **2–3** 个队友。不要一窝蜂。

---

<!-- Slide 34 -->

# 非流式 LLM 调用

默认：`streamText()` — token 边到边显示。

有些代理 / 本地模型会**弄坏 SSE**（卡住、工具 JSON 被截断）。

```json
{
  "experimental": {
    "disable_stream": true
  }
}
```

改用 `generateText()`，再**回放**一条假流，UI 不用改。

代价：没有打字机效果。等完整回复到了，一次性倒出来。

---

<!-- Slide 35 -->

# CLI、服务、attach

```bash
opencode run "Explain how agents/planner.py stops tool-calling"
opencode run -m anthropic/claude-sonnet-4-5 -f agents/planner.py "Review the LLM loop"
opencode run --format json "List public methods on Agent"
opencode run -c "Finish the remaining planner tests"
```

```bash
opencode serve --port 4096
opencode attach http://127.0.0.1:4096
opencode run --attach http://127.0.0.1:4096 "Summarize git diff"
```

复用已经热起来的服务，避免每次 `run` 都冷启动 MCP。

---

<!-- Slide 36 -->

# 配方：无人值守做一个功能

1. `/init` + 收紧 `AGENTS.md`
2. 权限：允许 edit 和测试命令；拒绝 `rm` / `git push`
3. `loop.verify`：`pytest -q`
4. **plan** Agent：先把设计谈妥
5. `/loop 2h 40 cap planner tool calls; do not change the public Agent API`
6. 需要调研和实现并行 → 改用 **`/team`**（打开 flag）
7. 自己看 diff；`/undo` 是基于 git 的

---

<!-- Slide 37 -->

# 什么时候用什么

| 场景 | 用什么 |
| --- | --- |
| 先想再改 | **plan** Agent |
| 一次聚焦的改动 | **build**，`@agents/planner.py` |
| 写代码前先设计 | **Superpowers** brainstorming |
| 带着证据修 bug | **systematic-debugging** |
| 模型不停调工具 | **会话循环**（自动） |
| 几小时、一个目标 | **Ralph Loop** → `/loop` + verify |
| 盯着它干 | **HITL**；信得过了再 AFK |
| 调研 ∥ 实现 | **`/team`**（2–3 人） |
| 每天同一句提示 | 自定义 **`/command`** |
| 领域流程 | **Skill** |
| 流式代理坏了 | **`disable_stream`** |
| CI / 脚本 | **`opencode run`** |
| 产品外部 API | **MCP**（少开）或 **自定义 tool** |

---

<!-- Slide 38 -->

# 踩坑

| 现象 | 处理 |
| --- | --- |
| Agent 直接开写代码 | Superpowers 没加载 — `/new` 后问 “Tell me about your superpowers” |
| 没有 `/loop` `/team` `disable_stream` | 装的是 **上游**，不是这个仓库 |
| Agent 回一句就「停了」 | 正常 — `finish ≠ tool-calls` 时会话循环退出 |
| Agent 不停调工具 | `agent.steps` 上限；相同调用 3 次触发 doom_loop |
| 没有 `/team` | `OPENCODE_EXPERIMENTAL_TEAM_MODE=1` |
| Loop 说 “done” 但测试失败 | 加上 `loop.verify` |
| `/undo` 不回滚文件 | 不是 git 仓库 |
| 上下文爆炸 | MCP 开太多 |
| Lead 一直 “waiting” | 空闲会自动唤醒；检查 heartbeat |
| Writer 改不了文件 | Lead 必须 `approve` 计划 |

---

<!-- Slide 39 -->

# 回顾

- **基础：** `bun dev`、`/connect`、`/init`、`@`、`Tab`、`Ctrl+X`
- **控制：** `AGENTS.md`、`.mdc` 规则、权限 glob
- **扩展：** commands、skills、tools、plugins、MCP
- **Superpowers：** brainstorm → plan → TDD（动手前先调 skill）
- **Ralph Loop：** 拦截退出直到 `LOOP_DONE`（先 HITL，再 AFK）
- **会话循环：** LLM → 工具 → compact → 再来，直到 `finish ≠ tool-calls`
- **无人值守：** 这里的 `/loop` 就是 Ralph — nudge + `loop.verify` + 预算
- **并行：** `/team` — lead、2–3 专家、worktree、merge、cleanup
- **本 fork：** `disable_stream`、loop、team、Cursor 规则

---

<!-- Slide 40 -->

# 资料（本仓库）

| | |
| --- | --- |
| 动手教程 | `tutorial/README.md` |
| Superpowers | `tutorial/superpowers.md` |
| 配置参考 | `OPENCODE_CONFIG.md` |
| Team 内部 | `packages/opencode/src/team/README.md` |
| 开发 / `bun dev` | `CONTRIBUTING.md` |
| 上游文档 | [opencode.ai/docs](https://opencode.ai/docs) |
| 英文幻灯片 | `tutorial/slides.md` |

```bash
OPENCODE_EXPERIMENTAL_TEAM_MODE=1 bun dev /path/to/project
```

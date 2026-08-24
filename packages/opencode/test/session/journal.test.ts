import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Journal } from "../../src/session/journal"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

function lines(id: string) {
  const text = Bun.file(Journal.file(id)).text()
  return text.then((raw) =>
    raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { time: number; type: string; properties: unknown }),
  )
}

describe("session journal", () => {
  test("appends session events to a jsonl file", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const messageID = MessageID.ascending()
        await Session.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID,
          sessionID: session.id,
          type: "text",
          text: "hello",
        })

        const records = await lines(session.id)
        const types = records.map((record) => record.type)
        expect(types).toContain("session.created")
        expect(types).toContain("session.updated")
        expect(types).toContain("message.updated")
        expect(types).toContain("message.part.updated")
        expect(records.every((record) => typeof record.time === "number")).toBe(true)

        const before = records.length
        await Session.remove(session.id)
        const after = await lines(session.id)
        expect(after.length).toBeGreaterThan(before)
        expect(after.map((record) => record.type)).toContain("session.deleted")
      },
    })
  })
})

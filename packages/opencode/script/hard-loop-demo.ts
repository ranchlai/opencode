#!/usr/bin/env bun
import path from "path"
import os from "os"
import { HardLoop } from "../src/session/hard-loop"

const dir = path.join(os.tmpdir(), "hard-loop-demo-" + Date.now())
await Bun.write(path.join(dir, ".keep"), "")
const file = path.join(dir, "progress.txt")

const info = HardLoop.create({
  goal: "Increment progress.txt until it reaches 3, then reply LOOP_DONE.",
  max: 10,
})

console.log("hard-loop demo")
console.log("Each round is a fresh process. Chat is gone. Only files persist.")
console.log(`workdir ${dir}\n`)

const result = await HardLoop.drive(info, async (text) => {
  const n = (await Bun.file(file).exists()) ? Number(await Bun.file(file).text()) + 1 : 1
  await Bun.write(file, String(n))
  const reply = n >= 3 ? `progress=${n} LOOP_DONE` : `progress=${n}`
  console.log(`--- round ${n} ---`)
  console.log(text.split("\n").slice(0, 4).join("\n"))
  console.log(`agent: ${reply}`)
  console.log(`disk:  progress.txt=${await Bun.file(file).text()}\n`)
  return reply
})

console.log(`${result.kind} after ${result.rounds} fresh processes`)
console.log(`progress.txt = ${await Bun.file(file).text()}`)

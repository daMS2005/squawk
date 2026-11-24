// Squawk for Cline: when teammates' messages arrive, queues a fixed note in this session, which runs it when idle
// (their text never becomes a prompt). Copy to .cline/plugins/squawk.ts; needs squawk-mcp on PATH.
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

export default {
  name: "squawk",
  manifest: { capabilities: ["hooks"] },
  setup(_api: unknown, ctx: any) {
    const sessionId = ctx.session?.sessionId
    const watcher = spawn("squawk-mcp", ["--watch", "--signal", "--as", "cline"], { cwd: ctx.cwd, stdio: ["ignore", "pipe", "ignore"] })
    createInterface({ input: watcher.stdout! }).on("line", (line) => ctx.emitEvent?.("queue_message", { sessionId, prompt: JSON.parse(line).text }))
    ctx.onDispose?.(() => watcher.kill())
  },
}

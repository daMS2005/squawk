// Squawk for OpenCode: when teammates' messages arrive, wakes the session that last used the Squawk tools with a fixed
// note (their text never becomes a prompt). Copy to .opencode/plugins/squawk/index.ts; needs squawk-mcp on PATH.
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "squawk",
  async setup(ctx) {
    const watcher = spawn("squawk-mcp", ["--watch", "--signal", "--as", "opencode"], { cwd: ctx.location.directory, stdio: ["ignore", "pipe", "ignore"] })
    createInterface({ input: watcher.stdout! }).on("line", (line) => {
      const { session, text } = JSON.parse(line)
      if (session) ctx.session.synthetic({ sessionID: session, text, delivery: "queue" }).catch(() => {})
    })
    return () => watcher.kill()
  },
})

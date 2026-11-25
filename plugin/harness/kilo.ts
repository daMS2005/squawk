// Qwack for Kilo Code: when teammates' messages arrive, wakes the latest active session with a fixed note (their
// text never becomes a prompt). Copy to .kilo/plugin/squawk.ts; needs squawk-mcp on PATH.
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { Plugin } from "@kilocode/plugin"

const squawk: Plugin = async ({ client, directory }) => {
  let target: string | undefined
  const watcher = spawn("squawk-mcp", ["--watch", "--signal", "--as", "kilo"], { cwd: directory, stdio: ["ignore", "pipe", "ignore"] })
  watcher.on("error", () => {})  // squawk-mcp not on PATH: no wake-ups, but the host keeps running
  createInterface({ input: watcher.stdout! }).on("line", (line) => {
    const id = target || JSON.parse(line).session
    if (id) client.session.promptAsync({ path: { id }, body: { parts: [{ type: "text", text: JSON.parse(line).text }] } }).catch(() => {})
  })
  return { event: async ({ event }: any) => { if (event.properties?.sessionID) target = event.properties.sessionID } }
}
export default { id: "squawk", server: squawk }

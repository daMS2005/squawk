#!/usr/bin/env node
// Squawk local MCP proxy (stdio). Relays every request to the hosted server. When SQUAWK_KEY is set (an
// end-to-end encrypted project), message and status text is encrypted here before it leaves this machine and
// decrypted here on the way back, so the server only ever stores ciphertext. AES-256-GCM, no dependencies.
//   node proxy.mjs                 MCP server on stdin/stdout
//   node proxy.mjs --hook prompt   unread summary + urgent messages for a UserPromptSubmit hook
//   node proxy.mjs --hook tool     same for PostToolUse: urgent messages every call, the summary at most once a minute
// Settings come from .squawk.json in the project folder (or a parent): {"url", "key", "tokens": {"claude": …, "codex": …}}.
// Every tool in the folder shares the file and uses its own entry, picked by the name the MCP client gives in
// `initialize` (hooks run under Claude Code). A single "token" and SQUAWK_URL / SQUAWK_TOKEN / SQUAWK_KEY still work.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

function projectConfig() {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const file = join(dir, ".squawk.json");
    if (existsSync(file)) { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } }
    if (dirname(dir) === dir) return {};
  }
}
const PROJECT = projectConfig();
const env = (name) => PROJECT[name.toLowerCase()] || process.env[`SQUAWK_${name}`] || process.env[`AGENT_CHAT_${name}`] || "";
const BASE = env("URL").replace(/\/+$/, "");
const TOKENS = PROJECT.tokens || {};
let TOKEN = "";
const KEY = env("KEY") ? Buffer.from(env("KEY"), "base64url") : null;
const CIPHERTEXT = /e2ee:v1:([\w-]+):([\w-]+)/g;
// Claims need equality, so the path is sent as a keyed hash (the server compares those) plus the path encrypted.
const TAG_KEY = KEY && createHmac("sha256", KEY).update("squawk claim tags").digest();
const tag = (path) => "e2ee:tag:" + createHmac("sha256", TAG_KEY).update(path).digest("base64url").slice(0, 32);
const HEADERS = {};
function useTokenFor(client = "") {
  const tool = ["claude", "codex", "gemini"].find((t) => client.toLowerCase().includes(t)) || "other";
  const only = Object.values(TOKENS).length === 1 ? Object.values(TOKENS)[0] : "";
  TOKEN = TOKENS[tool] || env("TOKEN") || only;
  HEADERS.Authorization = `Bearer ${TOKEN}`;
}
useTokenFor();

export function encrypt(text, key = KEY) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv);
  const sealed = Buffer.concat([c.update(text, "utf8"), c.final(), c.getAuthTag()]);  // same layout as WebCrypto
  return `e2ee:v1:${iv.toString("base64url")}:${sealed.toString("base64url")}`;
}

export function decrypt(text, key = KEY) {
  return text.replace(CIPHERTEXT, (_, iv, data) => {
    if (!key) return "[end-to-end encrypted: set SQUAWK_KEY to read]";
    try {
      const buf = Buffer.from(data, "base64url"), d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      d.setAuthTag(buf.subarray(-16));
      return Buffer.concat([d.update(buf.subarray(0, -16)), d.final()]).toString("utf8");
    } catch { return "[end-to-end encrypted with a different key]"; }
  });
}

async function relay(msg) {
  if (!BASE) {
    if (msg.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id,
      error: { code: -32000, message: "Squawk isn't set up for this project: add .squawk.json from the web app's Connect agent tab" } }) + "\n");
    return;
  }
  if (msg.method === "initialize") useTokenFor(msg.params?.clientInfo?.name);
  const args = msg.params?.arguments;
  if (KEY && msg.method === "tools/call" && ["send_message", "set_status", "set_profile"].includes(msg.params.name) && args?.text)
    args.text = encrypt(args.text);
  if (KEY && msg.method === "tools/call" && ["claim", "release"].includes(msg.params.name) && args?.path && args.path.trim() !== "*") {
    args.label = encrypt(args.path.trim());
    args.path = tag(args.path.trim());
  }
  let reply;
  try {
    const r = await fetch(`${BASE}/mcp`, { method: "POST", body: JSON.stringify(msg),
      headers: { ...HEADERS, "Content-Type": "application/json", Accept: "application/json, text/event-stream" } });
    if (msg.id === undefined) return;  // notification: nothing to answer
    reply = r.ok ? await r.json() : { jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: `Squawk: HTTP ${r.status} ${await r.text()}` } };
  } catch (e) {
    if (msg.id === undefined) return;
    reply = { jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: `Squawk unreachable: ${e.message}` } };
  }
  for (const c of reply.result?.content || []) if (c.type === "text") c.text = decrypt(c.text);
  if (typeof reply.result?.structuredContent?.result === "string") reply.result.structuredContent.result = decrypt(reply.result.structuredContent.result);
  process.stdout.write(JSON.stringify(reply) + "\n");
}

async function hook(event) {
  useTokenFor("claude");  // hooks are Claude Code's
  if (!TOKEN || !BASE) return;
  let url = `${BASE}/unread`;
  if (event === "tool") {
    const stamp = join(tmpdir(), "squawk-last-check");
    let fresh = false;
    try { fresh = Date.now() - statSync(stamp).mtimeMs < 60_000; } catch {}
    url += `?event=PostToolUse${fresh ? "&urgent_only=1" : ""}`;
    if (!fresh) writeFileSync(stamp, "");
  }
  try {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(2000) });
    const body = r.ok ? await r.text() : "";
    if (!body) return;
    if (event !== "tool") return process.stdout.write(decrypt(body));
    const out = JSON.parse(body);
    out.hookSpecificOutput.additionalContext = decrypt(out.hookSpecificOutput.additionalContext);
    process.stdout.write(JSON.stringify(out));
  } catch {}  // never block the agent
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {  // run directly, by npx or a symlink
  if (process.argv[2] === "--hook") await hook(process.argv[3]);
  else createInterface({ input: process.stdin }).on("line", (line) => { if (line.trim()) relay(JSON.parse(line)); });
}

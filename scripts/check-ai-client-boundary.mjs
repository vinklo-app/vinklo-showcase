#!/usr/bin/env node
/** Build guard: the assistant is optional; provider code belongs only on the server. */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".next");
const { pages } = JSON.parse(fs.readFileSync(path.join(root, "app-build-manifest.json"), "utf8"));
const routes = ["/page", "/crear/page", "/b/[slug]/page", "/panel/page", "/panel/invitados/page", "/panel/mesas/page"];
for (const route of routes) {
  if (!pages[route]) throw new Error(`Missing build entry: ${route}`);
  const ancestors = route.split("/").slice(1, -1);
  const entries = [route, "/layout", ...ancestors.map((_, index) => `/${ancestors.slice(0, index + 1).join("/")}/layout`)];
  const chunks = new Set(entries.flatMap(entry => pages[entry] ?? []).filter(file => file.endsWith(".js")));
  for (const chunk of chunks) {
    if (fs.readFileSync(path.join(root, chunk), "utf8").includes("pn-ai-composer")) {
      throw new Error(`Assistant conversation included in initial route: ${route} (${chunk})`);
    }
  }
  console.log(`OK initial route without assistant conversation: ${route}`);
}
let lazyChunks = 0;
function inspect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { inspect(file); continue; }
    if (!entry.name.endsWith(".js")) continue;
    const content = fs.readFileSync(file, "utf8");
    if (content.includes("pn-ai-composer")) lazyChunks++;
    if (/api\.anthropic\.com|ANTHROPIC_API_KEY/.test(content)) throw new Error(`Anthropic server implementation exposed in client JavaScript: ${file}`);
  }
}
inspect(path.join(root, "static"));
if (!lazyChunks) throw new Error("Assistant conversation was not emitted as a separate client module");
console.log("OK assistant emitted separately; Anthropic credentials/transport excluded from browser JavaScript");

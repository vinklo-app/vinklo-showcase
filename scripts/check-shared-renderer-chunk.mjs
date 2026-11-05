#!/usr/bin/env node
/**
 * Guarda de P1-4: tras `next build`, la landing (/ y /en), /demo/[plantilla] y
 * /b/[slug] deben servir el renderer de la invitación desde el MISMO chunk.
 * Turbopack ordena ese chunk compartido según el primer import que lo alcanza
 * en cada ruta; si cambia el orden de imports de la landing (ver
 * components/landing/landing-lovable.tsx), sale otra copia con distinto hash y
 * el navegador descarga ~52 kB gz de más (el prefetch trae las tres).
 *
 * Lee los manifiestos de .next: para cada ruta, el chunk que define
 * components/invitation/web-layout.tsx (el que exporta "WebLayout").
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const NEXT = path.resolve(process.argv[2] ?? ".next");
const ROUTES = ["page", "en/page", "demo/[plantilla]/page", "b/[slug]/page"];
const MODULE = "components/invitation/web-layout.tsx";

function rendererChunk(route) {
  globalThis.__RSC_MANIFEST = {};
  require(path.join(NEXT, "server/app", `${route}_client-reference-manifest.js`));
  const manifest = Object.values(globalThis.__RSC_MANIFEST)[0];
  const key = Object.keys(manifest.clientModules).find((k) => k.endsWith(MODULE));
  if (!key) throw new Error(`${route}: el manifiesto no referencia ${MODULE}`);
  const chunks = manifest.clientModules[key].chunks.filter((c) => c.endsWith(".js"));
  const defining = chunks.filter((c) => {
    const file = path.join(NEXT, c.replace(/^\/_next\//, ""));
    return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes('"WebLayout"');
  });
  if (defining.length !== 1) throw new Error(`${route}: se esperaba un chunk con WebLayout y hay ${defining.length} (${chunks.join(", ")})`);
  return defining[0];
}

const found = ROUTES.map((route) => [route, rendererChunk(route)]);
for (const [route, chunk] of found) console.log(`${("/" + route.replace(/\/?page$/, "")).padEnd(20)} ${chunk}`);
if (new Set(found.map(([, chunk]) => chunk)).size !== 1) {
  console.error("\nEl renderer va en chunks distintos: revisad el orden de imports de components/landing/landing-lovable.tsx y app/page.tsx (P1-4).");
  process.exit(1);
}
console.log("OK: un solo chunk del renderer para /, /en, /demo y /b.");

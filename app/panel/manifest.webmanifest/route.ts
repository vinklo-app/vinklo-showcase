import { PANEL_MANIFEST } from "@/lib/pwa/panel-manifest";

/** /panel/manifest.webmanifest: ver lib/pwa/panel-manifest.ts. */
export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(PANEL_MANIFEST), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

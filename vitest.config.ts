import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // tsconfig usa `jsx: preserve` (Next lo transforma). Vitest necesita que
  // oxc compile el JSX de los tests de renderer con react-dom/server.
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  // Los componentes importan su CSS (p. ej. components/invitation/story-player.css).
  // Vite no entiende el postcss.config.mjs de Next (plugins como strings): con
  // una config inline vacía no lo busca y el CSS queda fuera de los tests.
  css: { postcss: { plugins: [] } },
  // Los worktrees de agentes (.claude/worktrees) son copias del repo y e2e/
  // son specs de Playwright (npx playwright test): fuera de vitest.
  test: { environment: "node", exclude: [...configDefaults.exclude, ".claude/**", "e2e/**"] },
});

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Errores de consola y de página; se ignoran los de red a terceros (fuentes, analítica). */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error" || /Failed to load resource/.test(m.text())) return;
    // Barra de Vercel (comentarios/toolbar) en previews: ruido ajeno a la app.
    if (/vercel\.live|vercel\.com/.test(m.location().url + m.text())) return;
    errors.push(m.text());
  });
  return errors;
}

test("la portada carga sin errores de consola y muestra el héroe", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test("/login se muestra", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Por defecto, correo + contraseña; el código por correo sigue a un toque.
  await expect(page.getByLabel("Contraseña", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /código por correo/ }).click();
  await expect(page.getByRole("button", { name: /Enviar el código/ })).toBeVisible();
});

test("/crear: compositor visible y un hueco abre la hoja de nombres", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/crear");
  await expect(page.getByRole("heading", { name: "Vuestra invitación" })).toBeVisible();
  // Tocar el hueco de la vista previa abre el editor de nombres (sin llamar a la IA).
  await page.getByRole("button", { name: "Escribir vuestros nombres" }).click();
  await expect(page.getByRole("dialog").filter({ hasText: "Vuestros nombres" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("/demo/origen: se abre el sobre y la invitación se desplaza", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/demo/origen");
  await page.getByRole("button", { name: "Abrir la invitación" }).click();
  await expect(page.getByRole("dialog", { name: /Invitación de/ })).toBeHidden();
  // El scroll es del contenedor `.wl` (layout propio), no de la ventana.
  const lugar = page.getByRole("heading", { name: "Lugar de la celebración" });
  await expect(lugar).not.toBeInViewport();
  await lugar.scrollIntoViewIfNeeded();
  await expect(lugar).toBeInViewport();
  expect(await page.locator(".wl").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("/demo: la asistencia se envía en local (nunca llama al servidor) y da las gracias", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/demo");
  await page.getByRole("button", { name: "Abrir la invitación" }).click();
  await expect(page.getByRole("dialog", { name: /Invitación de/ })).toBeHidden();
  // Cualquier petición que no sea GET (la server action de submitRsvp es un POST) rompe la demo.
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") writes.push(`${r.method()} ${r.url()}`);
  });
  const name = page.locator("#rsvp-name");
  await name.scrollIntoViewIfNeeded();
  await name.fill("Marta García");
  await page.getByRole("button", { name: "¡Sí, allí estaré!" }).click();
  await page.getByRole("button", { name: "Enviar mi respuesta" }).click();
  const done = page.getByRole("status").filter({ hasText: "¡Gracias, Marta!" });
  await expect(done).toBeVisible();
  // El foco pasa al aviso (VoiceOver lo lee).
  await expect(done).toBeFocused();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

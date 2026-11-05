/**
 * Lo único del SDK que usa el navegador. Se carga con `import()` desde
 * sentry-client.ts: importar el paquete entero en diferido no deja podar
 * nada (replay, feedback, trazas…) y el chunk triplicaba su tamaño.
 */
export { captureException, captureRouterTransitionStart, init } from "@sentry/nextjs";

# Design System: vinklo — «Ciruela y perla» (v9, 2026-10-09)

> **v9 SUSTITUYE los colores y adornos de v8 «Papel cálido».** Fuente de
> verdad para la interfaz propia de vinklo: landing, creador, acceso,
> onboarding, panel, invitados, ajustes, vacíos y errores. Estado:
> **implementado en local en la rama `marca-ciruela`** (desde
> `integracion-3`), **sin publicar**. Se conservan de v8 la tipografía, el
> logo, el movimiento (§5 de v8) y la voz (§8 de v8).
>
> **Las invitaciones de boda NO forman parte de la marca.** Las webs de
> boda (`components/invitation/*`, el renderer de `/b/[slug]`, `/demo` y la
> vista previa del creador) siguen con sus temas y sus ocho paletas
> (`lib/site-document.ts`). `app/globals.css` fija los valores v8 dentro de
> `:where(.sp-shell)` para que borradores y webs publicadas se vean igual
> que antes; no se toca sin comparar `/demo` píxel a píxel.

## 1. Intención

Ilusión por invitar, cercanía y tranquilidad al organizar. Superficies
claras casi siempre; el ciruela se concentra en acciones, selección y
detalles de marca. Sin beige, marrón ni terracota en la interfaz; sin
dibujos de alianzas, sobres, lazos ni ramas como adorno.

## 2. Color (contrastes WCAG 2.x medidos)

| Token (v9) | Hex | Uso | Contraste |
|---|---|---|---|
| `--perla` | `#F8F7FA` | fondo / lienzo | — |
| `--blanco` / `--card` | `#FFFFFF` | tarjetas, campos | — |
| `--perla-2` | `#ECE7F0` | fondo secundario, tinte del estado encendido, superficie tras una muestra | — |
| `--texto` | `#24212A` | texto principal | 14,8:1 perla · 13,0:1 perla-2 |
| `--texto-2` | `#655E6B` | texto secundario | 5,8:1 perla · 5,1:1 perla-2 · 6,2:1 blanco |
| `--ciruela` | `#573B62` | marca, acción principal, selección, foco | 8,9:1 perla · 7,8:1 perla-2 · 9,5:1 blanco; blanco sobre ciruela 9,5:1 |
| `--ciruela-hover` | `#46304F` | hover/pulsado de la acción | blanco encima 11,7:1 |
| `--ciruela-tinta` | `#2E2335` | superficie oscura (embudo del panel, frase de la landing, botón de página) | perla encima 14,0:1 |
| `--ciruela-claro` | `#C9B8D3` | acento sobre tinta ciruela (cursiva, barras, foco) | 8,0:1 sobre tinta ciruela |
| `--separador` | `#DCD4E1` | filetes y bordes decorativos | 1,35:1 — **nunca** delimita un control |
| `--borde-control` | `#857A8E` | borde de campos, chips, interruptores | 3,8:1 perla · 4,0:1 blanco · 3,3:1 perla-2 |
| `--exito` | `#2F6B45` | confirmado, hecho | 5,9:1 perla · 6,3:1 blanco |
| `--aviso` | `#8A5300` | vence, sobrecupo de presupuesto, sin mesa | 5,9:1 perla · 6,3:1 blanco |
| `--error` | `#A3322A` | errores, campos inválidos, acciones destructivas | 6,5:1 perla · 6,9:1 blanco |

Reglas:

- **Marca ≠ semánticos.** Éxito, aviso y error nunca usan ciruela y no
  decoran. `--clay-dark` (v8: hover y error a la vez) es ahora solo error;
  los hovers usan `--ciruela-hover`.
- **Nombres v8 como alias** (para no reescribir cientos de clases):
  `paper→perla`, `paper-2→perla-2`, `ink→texto`, `ink-muted→texto-2`,
  `clay→ciruela`, `clay-dark→error`, `olive→exito`, `gold→ciruela`,
  `line→separador`, `line-strong→borde-control`; y los históricos
  (`tinta`, `papel`, `cava`, `rubor`, `salvia`, `granate`…) siguen
  apuntando a ellos. shadcn: `--primary` = ciruela, `--input` =
  borde-control, `--ring` = ciruela, `--destructive` = error. Código
  nuevo: nombres v9 (`bg-ciruela`, `text-texto-2`, `border-borde-control`).
- **Selección**: fondo ciruela y texto blanco (chips, pestañas, navegación
  inferior, interruptores). Opciones de tarjeta: borde ciruela de 2 px.
- **Foco**: `outline: 2px solid` ciruela con 3 px de separación (sobre
  tinta ciruela, `--ciruela-claro`).
- **Disabled**: opacidad 0,55–0,6 sobre el mismo color (exento de
  contraste según WCAG; nunca única pista de estado).
- **Superficies oscuras** solo si hacen falta: tinta ciruela con texto
  perla; nunca marrón ni negro con resplandor. Sin degradados luminosos,
  sin halos, sin texturas.
- **Sombras** teñidas de texto (`rgba(36, 33, 42, …)`).

## 3. Tipografía

Se conservan Playfair Display (titulares), Plus Jakarta Sans (interfaz) y
JetBrains Mono (etiquetas). Cambios:

- Titulares más contenidos: hero de la landing hasta 4,25 rem, h2 hasta
  4 rem, frase y «Hacedla vuestra» hasta 4–4,25 rem, nombres del panel
  hasta 4,5 rem.
- **Cursivas moderadas**: la cursiva se mantiene como forma, pero solo
  lleva color propio en el hero de la landing, la frase oscura (en
  ciruela claro), el estado encendido de «Hacedla vuestra» y los nombres
  de la pareja en el panel. El resto hereda el color del titular.

## 4. Logo

Sin cambios de forma: la V abierta en `--texto` con el punto de la ı en el
acento (ahora ciruela). `LazoIcon` usa `var(--clay)`: dentro de una
invitación conserva su valor v8. Assets regenerados en ciruela sobre perla
(mismos tamaños y esquinas): `app/icon.svg`, `app/icon.png` (512,
esquinas 22/100), `app/apple-icon.png` (180, cuadrado),
`public/icon-192.png`, `public/icon-512.png`, `assets/icon.png` (1024),
`app/favicon.ico` (16/32/48), `public/email/vinklo-mark.png` (96) y
`public/og.png` / `app/opengraph-image.tsx` (1200×630).

## 5. Formas y motivo

- Botones con radio de 12 px; contenedores de producto 12–18 px; píldoras
  solo en chips y estados. En una muestra editorial de invitación se
  permite una esquina más curva.
- **Motivo de marca** (`BrandCurve` en `components/brand/icons.tsx`): una
  curva amplia y asimétrica, recortada por el borde, con una segunda línea
  desplazada. Como máximo uno por sección importante, siempre al fondo,
  sin cruzar texto ni controles, `aria-hidden` y sin eventos de puntero.
  Se retira por debajo de 1200 px en «Hacedla vuestra». Hoy: «Hacedla
  vuestra» y la tarjeta social.
- `--perla-2` puede formar una superficie muy tenue detrás de una muestra
  de invitación (el vuelo de la landing, solo escritorio).
- Panel: superficies limpias y separadores; ningún adorno detrás de
  tablas o formularios.

## 6. «Hacedla vuestra» (landing)

Mismo comportamiento (se enciende solo pasado el 42 % del capítulo, se
puede pulsar, `role="switch"` con `aria-checked`, titular con
`aria-live`). Apagado: perla, pista blanca con borde de control y botón
gris a la izquierda. Encendido: tinte perla-2, pista ciruela con el botón
blanco a la derecha y una marca de verificación, titular de respuesta con
la cursiva en ciruela. Sin foto de fondo, sin capa de luz y sin los cuatro
dibujos (`landing-objects.tsx` eliminado). Reduced motion: sin fundidos
de titular ni transición de fondo.

## 7. Fuera de la marca (no cambiar)

- Temas, paletas, sobre y lacre de las invitaciones; `lib/site-document.ts`,
  `lib/wedding-settings.ts`, `lib/og/invitation-card.tsx`,
  `lib/invite-theme-color.ts` (el theme-color de `/b/[slug]` sigue la
  paleta de la boda).
- Muestras de invitación en la landing (móvil, sobre del vuelo, puntos de
  paleta del vuelo): representan invitaciones reales.
- Código archivado sin ruta pública que aún lleva v8: `landing-cinema.tsx`
  y su parte de `landing-atelier.css`, `components/landing/reel/*`
  (`/borrador/reel`), `components/drafts/*`.

## 8. Pendiente

- Tras publicar: volver a pegar en el dashboard de Supabase las plantillas
  de Auth (`supabase/templates/magic_link.html` y `confirmation.html`),
  como indica `docs/ops/supabase-auth.md`.
- iOS: regenerar AppIcon/Splash con `npm run cap:assets` desde
  `assets/icon.png` en la siguiente build nativa.

## 9. Creador (/crear y /onboarding), 2026-10-10

Extensión ordinaria de v9 (rama `rediseno-crear`): mismos tokens, misma
tipografía, mismo movimiento. La invitación es la protagonista y conserva
su paleta; la interfaz de vinklo se limita a una barra inferior, un dock y
una hoja. Implementación: `components/panel/onboarding-wizard.tsx`,
`components/panel/wedding-builder.css`, `components/creator/creator-sheet.tsx`,
`components/creator/gap-targets.ts`, `components/creator/native.ts`,
`components/site-chat/site-chat.css`.

### 9.1 Disposición

- **Corte en 1000 px** (`MOBILE_QUERY` = `(max-width: 999.98px)`, solo el
  creador; `/onboarding/listo` sigue cortando en 720 px).
- **Escritorio (≥ 1000 px)**: rejilla de dos columnas; a la izquierda una
  columna de 420 px sobre perla con filete `--separador` a la derecha
  (título en Playfair 2 rem, acción principal, lo entendido, «Os falta»,
  «Añadir más», conversación y compositor); a la derecha el escenario en
  perla-2 con el móvil a proporciones reales (radio 26 px y sombra teñida
  de texto, compensados con la escala).
- **Compacto (< 1000 px)**: la invitación a sangre, de borde a borde, sin
  marco, radio ni sombra (`useFitPreview` en modo `"width"`: escala = ancho
  disponible / ancho lógico; ancho lógico = el del teléfono hasta 480 px y
  430 px en tableta; alto ≥ ancho × 2,17; nunca se oculta). En el estado
  listo de la maqueta «Como una web» usa `"fill"` (alto exacto del hueco
  sobre la barra; lo demás se desplaza dentro). La Story conserva su alto
  natural (`"width"`) y se ancla. El editor del panel (`/panel/ajustes`)
  hace lo mismo en compacto (enmienda del 13-oct-2026, antes `"contain"`):
  la invitación a sangre en `"fill"` (el ancho del teléfono y el alto exacto
  del hueco: sin el anclaje del creador, `"width"` cortaba los controles de
  la Story bajo la hoja), sin marco ni sombra de teléfono, bajo
  la franja blanca con «‹ Panel», «Seleccionar» y el estado, y la hoja abre recogida en
  una barra de una línea (el dock, empezando por «Pedid cambios») que se
  despliega al tocar una herramienta. Conserva todo lo del editor (Pedid
  cambios, versiones, deshacer, publicar). `"contain"` (por defecto) ya no
  lo usa ninguna pantalla compacta.
- **Anclaje**: la invitación sube (`--wb-shift`, 300 ms en
  `--ease-drawer`) hasta dejar nombres y fecha sobre la barra o la hoja,
  sin cortar nunca el comienzo de los nombres.
- **Fundido sobre la barra**: la barra no tiene sombra; un degradado
  sólido de 64 px (`.wb-bar::before`, de perla transparente a perla, que
  termina 20 px por debajo de su borde) funde la invitación en perla unos
  44 px por encima. Nada se lee cortado por el borde redondeado (20 px
  arriba) de la barra.

### 9.2 Adaptación del fondo en iOS (citada, obligatoria)

En compacto, el fondo del creador y del editor es **#fff arriba** y baja a
perla-2: `.wb-app` es `position: fixed` con fondo #fff, `globals.css` pone
html/body en #fff cuando existe `.wb-app`, el escenario lleva
`linear-gradient(#fff 0–14 %, --perla-2 100 %)` y hay una franja blanca
superior (`env(safe-area-inset-top) + 3.6rem`) con un filete de 1 px
teñido. **Motivo:** Safari de iOS 26 tiñe la banda de la isla dinámica /
barra de estado con el color del body o del elemento fijo superior; para
que se vea continua, la parte de arriba tiene que coincidir con el lienzo
vivo. Ese #fff es `--blanco`; no es un token nuevo ni contradice el lienzo
perla del resto de la interfaz. No se cambia a perla sin probarlo en un
iPhone real.

### 9.3 Componentes del creador

- **Compositor «Contadnos vuestra boda»**: caja blanca de radio 20 px con
  borde de control, que crece de 1 a 4 líneas (autogrow por JS, sin
  animación); botón de enviar redondo de 40 px en ciruela. Foco = un solo
  marco: borde ciruela + 1 px de sombra ciruela, sin el contorno global.
  Cuando ya hay nombres y fecha, el mismo sitio es «Pedid cambios»
  (conversación de site-chat). Los ejemplos son chips de 44 px, bodas
  enteras (nombres, fecha, lugar), que solo aparecen con el borrador vacío.
- **Botón de guardado**: siempre visible, arriba a la derecha en compacto.
  Su etiqueta es «Guardar» (el email se explica en la hoja siguiente;
  autenticado, «Guardar y publicar»). Mientras falten nombres o fecha, es
  silencioso (borde, sin relleno); con ambos, ciruela.
- **Lo entendido**: píldoras blancas de 40 px, borde de control, Jakarta
  600 a 13 px, con un check en ciruela; tocarlas abre su editor. Entran
  220 ms desde 6 px abajo (`--ease-out`). En compacto, fila única que se
  desliza en horizontal.
- **Huecos en la invitación**: lo que falta (nombres, fecha) lleva un
  contorno **discontinuo ciruela** de 2 px con 3 px de separación y radio
  6 px (compensados por la escala para verse igual a cualquier tamaño) y
  un resplandor ciruela tenue (`rgb(87 59 98 / .3)`) en un `::after` cuya
  opacidad respira (2400 ms, `--ease-in-out`); con reduced motion, estático
  a 0,6. Es la única sombra en ciruela del sistema y solo existe para
  señalar un hueco. El mismo trazo discontinuo de 1,5 px marca
  `.wb-gap-btn` y la píldora «Os falta», que vive en la barra (móvil) o en
  la columna (escritorio), **nunca sobre la invitación**. Sin nombres, el
  monograma derivado se oculta solo en el creador.
- **Hoja inferior** (`CreatorSheet`): siempre montada; entra y sale con
  `translateY` en 300 ms con la curva de cajón de iOS
  (`--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`, local a `.wb-app`);
  cerrada queda `inert` y oculta. Perla, radio 22 px arriba, sombra teñida
  hacia arriba, alto máximo 64 % (74 % con teclado, que además oculta la
  frase de ayuda y encoge el asa). El asa (40 × 5 px) se arrastra con
  captura de puntero: 1:1 hacia abajo, resistencia `rubberBand` hacia
  arriba; se cierra si la velocidad supera 0,11 px/ms o baja más del 30 %
  de su alto. Escape, toque fuera y la X de la cabecera (44 px) también
  cierran; el foco vuelve al disparador. Enmienda del 13-oct-2026: los
  editores de un paso llevan abajo a la derecha «Siguiente» (píldora
  blanca, texto ciruela, 44 px; en escritorio, pegada al pie de la
  columna), que abre el editor siguiente en el orden del asistente
  (nombres, foto, fecha, lugar, invitados, día, historia, bienvenida;
  en el diseño, Colores → Letra); el último dice «Hecho» y cierra.
  Sustituye al «Hecho» de la cabecera, que confundía. Variante `thread` para la
  conversación: flota sobre la barra, radio 22 px en las cuatro esquinas,
  0,5 rem de margen, 52 % de alto. Con reduced motion, solo fundido.
  En escritorio el mismo editor se abre en la columna.
- **Dock de diseño**: botones de 52 px sin borde, icono (Lucide, 18 px,
  trazo 1,75) en ciruela y etiqueta Jakarta 600 a 11 px; pulsado/abierto =
  fondo perla-2 y texto ciruela. Ranuras: (Añadir, solo compacto) ·
  Colores · Letra · Ver en grande («Ampliar» en compacto). Enmienda del
  13-oct-2026: «Forma» y «Sobre» salen del creador (toda invitación nueva
  es web y abre con el sobre; la Story vuelve como opción premium).
  El compositor sugiere, con un editor abierto o una sección
  seleccionada, lo que se puede pedir en esa sección
  (`SECTION_CHANGE_PROMPTS`, lib/site-chat/edit-focus.ts).
  «Pedid cambios» no es una ranura: es el compositor.
- **Acción principal siempre visible** («Guardar y publicar» / «Guardar y
  continuar con email»): botón ciruela de 48 px y radio 12 px arriba de la
  columna en escritorio; en compacto, píldora de 44 px arriba a la derecha
  en la franja blanca, nunca encima de la barra propia de la invitación.
  Si falta algo esencial, abre ese campo con su validación.

### 9.4 Interacción

- **Pulsación**: todo control del creador y del chat baja a `scale(.97)`
  al pulsar, con transición de `transform` de 160 ms `--ease-out`; con
  reduced motion no escala.
- **Hover** solo dentro de `@media (hover: hover) and (pointer: fine)`
  (borde ciruela en controles con borde, perla-2 en el dock y los huecos,
  `--ciruela-hover` en la acción).
- Puntos de «leyendo» en ciclos de 750 ms; nada entra desde `scale(0)` ni
  usa `transition: all`.
- **Editar desde la vista previa** (13-oct-2026, solo escritorio con ratón:
  `(hover: hover) and (pointer: fine)` y el corte de cada pantalla, 1000 px
  en el creador y 1024 px en el panel): al pasar el ratón, contorno
  discontinuo ciruela de 2 px y una píldora pequeña «Editar» / «Cambiar»
  (ciruela, texto blanco). Un texto se edita encima de sí mismo (misma letra
  y medida, contorno ciruela sólido con halo blanco, ayuda «Intro para
  guardar · Esc para cancelar» con contador); la foto, la fecha, los nombres
  y las filas del programa abren su editor con el campo enfocado.
  Implementación: `components/site-chat/live-edit.tsx`,
  `lib/site-chat/live-edit.ts`.

### 9.5 Formas: alcance de las píldoras

§5 reserva las píldoras para chips y estados. En el creador se amplía a
**controles flotantes sobre la invitación o en su borde** (publicar en
compacto, «Siguiente»/«Hecho», «Os falta», cerrar «Ver en grande», aviso del
escenario): son píldoras. Los botones en línea siguen en 12 px. Sombras: la
píldora de publicar lleva una sombra teñida de tinta ciruela
(`rgb(46 35 53 / .6)`) y el hueco su resplandor ciruela; todo lo demás
sigue teñido de texto.

### 9.6 Límite conocido

En la maqueta Story, estado listo, a 390 px: la barra de progreso se
mantiene arriba (`--wb-chrome-top`), pero la fila ‹ «Ver todos los
detalles» › queda bajo la barra porque la portada (monograma → cuenta
atrás) llena el hueco visible. A 440 px sí cabe (`--wb-chrome-bottom`).

---

# [SUPERSEDED por v9 en color y adornos] Design System: vinklo — "Papel cálido" (v8, 2026-08-09)

> **v8 SUPERSEDE v7 "Editorial B/N".** Fuente de verdad para cualquier
> pantalla nueva y para la fase 2 (estructura). Decisiones y diagnóstico
> completos en `docs/design/2026-08-09-rediseno-landing-sistema-y-decisiones.md`;
> prototipo de referencia (autocontenido, fuentes incrustadas) en
> `docs/design/2026-08-09-vinklo-rediseno-prototipo.html`.
>
> **Qué cambió en esta fase (2026-09-06, publicado en vinklo.es):** color,
> logo y tipografía. **Qué NO cambió:** copys, estructura de secciones,
> formas (esquinas rectas de v7) y movimiento. Lo pendiente está en §9.

## 1. Diagnóstico que motiva v8

El monocromo v7 era elegante pero frío: indistinguible de un fintech, sin
registro emocional para algo que es una boda. v8 conserva el ADN editorial
(serif de display, folios, filetes, mayúsculas espaciadas) y le da
temperatura: lienzo de papel, tinta cálida y **un** acento de arcilla.

## 2. Color — todo verificado WCAG (contraste sobre `--paper`)

| Token | Hex | Uso | Contraste |
|---|---|---|---|
| `--paper` | `#FAF6F1` | fondo / lienzo | — |
| `--paper-2` | `#F3ECE3` | bandas de sección, tiles suaves, hover | — |
| `--card` (shadcn) | `#FFFFFF` | tarjetas | — |
| `--ink` | `#17130F` | texto principal, botón primario de nav | 17,2:1 |
| `--ink-muted` | `#6B5F55` | texto secundario, etiquetas (`--muted` en el prototipo) | 5,8:1 |
| `--clay` | `#9E3B22` | **primario**: CTA, cursivas de énfasis, ı del wordmark, punto del símbolo, anillos de foco | 6,3:1 |
| `--clay-dark` | `#7E2D18` | hover del CTA; urgencia/error semántico | 8,9:1 |
| `--olive` | `#3F5136` | estado "pagado", checks, éxito semántico | 8,0:1 |
| `--gold` | `#B07D2B` | numeración editorial | 3,4:1 — **solo texto XL** |
| `--line` / `--line-strong` | `#E7DDD1` / `#D3C4B2` | filetes, bordes de tarjeta / bordes de controles | decorativo |

Reglas:

- **Un solo acento.** La arcilla es el primario; oro y oliva no decoran.
- **El oro nunca en texto de cuerpo** — únicamente numerales display.
- Salvia/granate (semánticos v7) ahora son `--olive` / `--clay-dark`.
- Sombras siempre teñidas de tinta (`--shadow-sm`, `--shadow-md`), nunca
  negro puro.
- Alias históricos que siguen funcionando en clases Tailwind
  (`text-tinta`, `bg-papel`, `ring-cava`, `bg-rubor`…): `tinta→ink`,
  `papel→paper`, `cava/cava-texto→clay`, `gris-etiqueta→ink-muted`,
  `rubor→paper-2`, `menta/vainilla→line`, `salvia→olive`,
  `granate→clay-dark`. Código nuevo: usar los nombres v8
  (`text-ink`, `bg-paper`, `text-clay`, `border-line`…).
- `--muted` del prototipo se llama `--ink-muted` en código porque shadcn
  ya usa `--muted` como color de superficie.

## 3. Tipografía

Se conserva el par existente y se añade una mono para las etiquetas.

- **Playfair Display** (`--font-serif` → `.font-display` / `.lv3-display` /
  `.bb-display`) — titulares y cifras, peso 400, tracking −0.02em,
  leading 1.03–1.06. **La cursiva en `--clay` es el recurso de énfasis de
  toda la página** (*hecho realidad entre todos.*, *sobre*, *adelantar*…).
- **Plus Jakarta Sans** (`--font-sans`) — interfaz y cuerpo (500–700).
  Wordmark: `vınklo` en 700, 19px, tracking −0.02em, con la ı sin punto
  (U+0131) en arcilla.
- **JetBrains Mono** (`--font-mono`, next/font `--font-jetbrains`) —
  etiquetas editoriales: `.folio`, `.bb-folio`, `.font-label`:
  11px · 500 · tracking .16em · mayúsculas · `--ink-muted`
  (`Nº 01 — EL SOBRE`, `ESPAÑA · 2026`, eyebrows de sección).
- Cifras siempre con `font-variant-numeric: tabular-nums` (`.tabular`,
  `.bb-tnum`) para que los contadores no muevan el layout.
- Formateo de números a mano (miles con punto, decimales con coma):
  `Intl` no es fiable en todos los builds de navegador.

## 4. Logo

- **Símbolo:** V abierta en un trazo (`M3 5.5 12 20l9-14.5`, stroke 2.1,
  puntas redondeadas, `currentColor` = tinta) con el punto de la ı
  flotando encima (`circle cx=12 cy=3.2 r=1.5`) en arcilla. Componente:
  `LazoIcon` en `components/brand/icons.tsx` (nombre conservado; `landing/v3/icons` lo reexporta).
- **Wordmark:** `v<span class="text-clay">ı</span>nklo`, Jakarta 700.
  Nunca "VINKLO", nunca "Vinklo". Símbolo + wordmark juntos en nav y
  footer (`.v-wordmark` en la landing; `SiteHeader`/`SiteFooter` fuera).
- **Assets:** `app/icon.svg`, `app/icon.png` (512), `app/apple-icon.png`
  (180), `public/icon-192.png`, `public/icon-512.png`, `assets/icon.png`
  (1024, fuente para `npm run cap:assets`), `public/og.png` (1200×630).
  Todos sobre `--paper`; el favicon usa esquinas 22/100.
- El lazo curvo del brandkit v2 (v6/v7) queda retirado.

## 5. Movimiento (sistema, aplicable en fase 2)

Curvas y duraciones del skill `animate` (Emil Kowalski); las nativas de CSS
son demasiado débiles. Tokens ya definidos en `app/globals.css`:

```
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1)
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)
--d-micro: 140ms   --d-ui: 220ms   --d-reveal: 560ms
```

- Solo `transform` y `opacity`. Nada de `width`/`height`/`top`.
- Nunca `ease-in` en UI. Nunca `transition: all`.
- Reveals con IntersectionObserver, escalonado 60 ms (tope 300 ms), una vez.
- Sin librería de animación para reveals/fundidos: CSS. Motion solo si se
  añaden gestos o animaciones de layout.
- `prefers-reduced-motion`: se conservan los fundidos, se elimina el
  desplazamiento y cualquier autoplay arranca pausado. Menos y más suave.
- Todo `:hover` detrás de `@media (hover:hover) and (pointer:fine)`.

## 6. Componentes (estado actual)

- **CTA primario de página** (`.cta-coral`): bloque de arcilla, texto
  blanco, mayúsculas 13px tracking .08em, hover `--clay-dark`
  (`--d-ui` / `--ease-out`). **CTA de nav** fuera del home: tinta con
  texto papel (como `.btn-primary` del prototipo).
- **Tarjetas** (`.card`, `.bb-card`): blanco sobre papel, filete `--line`.
  Forma heredada de v7 (esquinas rectas, sin sombra) — ver §9.
- **Bordes:** estructura y tarjetas en `--line`; controles interactivos
  (botones secundarios, chips, numerales de paso) en `--line-strong`.
  Chip/opción seleccionada: fondo tinta, texto blanco.
- **Foco:** anillo `--clay` (`outline: 2px solid`, offset 3px).
- **Inputs:** fondo papel/blanco, borde `--line`, foco en arcilla; en
  bloques en negativo, `color-scheme: dark`.
- **Estados semánticos:** pagado/éxito en `--olive`, vence/urgencia en
  `--clay-dark`; nunca decoran.

## 7. Estructura objetivo (fase 2, del prototipo — NO aplicada aún)

| # | Sección | Qué cambia |
|---|---|---|
| 01 | Hero | Titular a la promesa concreta. **Una sola** tarjeta de dinero ("el sobre") con contador animado. Franja de confianza bajo el CTA. |
| 02 | Cómo funciona | Stepper de 3 pasos sincronizado con escenario (formulario → WhatsApp → calendario). Autoplay 5,2 s, pausa al interactuar, solo con la sección a la vista. Clic y teclado. |
| 03 | El dinero | Bento de 6 piezas; la del 100 % en negativo. |
| 04 | Calculadora | Sliders con relleno, resultado en Playfair, desglose invitado/novios. |
| 05 | Precios | Dos planes, Premium con borde `--clay` y badge de lanzamiento. |
| 06 | Proveedores | Tres columnas numeradas (numeral en `--gold`). |
| 07 | FAQ | `<details>` nativo. |
| 08 | Lista de espera | Bloque en negativo, formulario con chips. |

Además: eliminar la marquesina decorativa; anclas con
`scroll-margin-top: 92px`; objetivos táctiles ≥ 44 px; puntos de stepper
como `<button>` con `aria-label`.

## 8. Voz y copy (es-ES) — sin cambios respecto a v7

Cálido con invitados, sobrio con la pareja; "vosotros" para la pareja;
nunca "recaudar dinero" ni "colecta"; gastos de gestión siempre visibles
antes de pagar; Klarna 3× como opción, nunca como camino principal. Esta
fase no ha tocado ni un copy.

## 9. Pendiente / decisiones para el equipo

- **Fase 2 (estructura):** aplicar §7 sobre el prototipo; decidir radios
  (`--radius: 14px / 22px` en el prototipo vs. esquinas rectas v7) y
  sombras teñidas.
- Las respuestas del FAQ del prototipo se compusieron con afirmaciones que
  ya hacía la web: **revisar con criterio legal/financiero** antes de
  publicarlas.
- Falta la prueba de confianza más importante: **quién custodia el dinero
  (Stripe) y qué pasa si se cancela la boda.** Es la objeción nº 1 y hoy
  no se contesta en ningún sitio.
- Los datos del hero y del calendario del prototipo son de ejemplo (Ana y
  Luis).
- iOS: regenerar AppIcon/Splash con `npm run cap:assets` desde el nuevo
  `assets/icon.png` cuando se prepare la siguiente build nativa.

---

# [SUPERSEDED] Design System: vinklo — "Editorial B/N" (v7, 2026-07-09)

> **v7 SUPERSEDE v6 "Paper Pro".** Direction chosen by the user on
> 2026-07-09 over mockups: black-and-white fashion-magazine editorial.
> Canvas is pure white `#FFFFFF`; ink `#111111` is the ONLY brand voice
> (text, hairline grids, rectangular uppercase CTAs); display type is a
> high-contrast serif (Playfair Display ≈ Didot) with the body/UI in
> Plus Jakarta Sans; the logo is the brandkit-v2 curved lazo (continuous
> curved V + knotted teardrop, both in ink) and the `vınklo` wordmark
> with the separated tittle + gapped stem. Corners are SQUARE and
> shadows are gone in editorial surfaces; radii survive only inside
> product mockups. Grays: `#444444` secondary text, `#767676` labels
> (AA floor — never `#999` on white), `#F6F6F6/#F0F0F0/#EAEAEA` soft
> surfaces. Salvia `#3E5C3A` / granate `#6E2B35` stay semantic-only.
> Section folios ("Nº 01 — El regalo") number the page like a magazine
> issue. Full spec: `docs/superpowers/specs/2026-07-09-editorial-bn-redesign-design.md`.
> Everything below this note documents v6 and remains only as history —
> where v6 and v7 conflict, v7 wins.

# [SUPERSEDED] Design System: vinklo — "Paper Pro" (v6, 2026-07-08)

> Single source of truth for generating new screens (Google Stitch or any
> agent). Encodes the identity the product actually ships today: warm paper
> canvas, near-black ink, pastel-gold brand details, Plus Jakarta Sans, and
> the envelope ("el sobre") as the signature object. Spanish (es-ES) copy
> always. vinklo is a wedding gift-funding SaaS: guests contribute to the
> couple's common gift through one beautiful link; the couple watches it all
> in one panel and pays vendors as money arrives.

## 1. Visual Theme & Atmosphere

A calm, professional paper-studio interface — like a well-lit stationery
atelier where wedding invitations are pressed. Warm paper canvas with a
barely-there grain texture, confident left-aligned compositions, generous
whitespace, and one quiet flash of pastel gold where the brand lives. The
mood is trustworthy and warm, never saccharine, never corporate-cold.

- **Density:** 4 — daily-app balanced. The couple's panel may reach 5–6;
  marketing surfaces stay airy.
- **Variance:** 6 — offset asymmetric. Left-aligned heroes, two-tone
  headlines, one oversized "flap" corner per card. Never artsy-chaotic.
- **Motion:** 6 — fluid. Staggered blur-in reveals, springy progress bars,
  one gentle perpetual pulse on the guest countdown. Never gratuitous.

## 2. Color Palette & Roles

- **Papel** (#F2EFE9) — primary canvas, always with a subtle SVG grain
  overlay at ~5% opacity. The whole product lives on this warm paper.
- **Blanco** (#FFFFFF) — cards and containers. Cards carry a hairline
  border plus a soft brown-tinted shadow, never a gray one.
- **Tinta** (#171512) — primary text and primary CTA fill (black pill
  buttons with white text). Never pure #000000.
- **Tinta 66%** (rgba(23,21,18,0.66)) — body copy, descriptions.
- **Tinta 60%** (rgba(23,21,18,0.6)) — metadata, quiet labels. This is the
  FLOOR for readable text: 0.60 is the lowest ink opacity that passes
  WCAG AA 4.5:1 on both Papel (4.55:1) and white (4.74:1). Anything below
  60% is decoration-only (hairlines, aria-hidden chevrons) — never copy.
  (The old Tinta 42% token measured 2.66:1 on Papel — an AA failure — and
  was retired for text on 2026-07-09.)
- **Hairline** (rgba(23,21,18,0.09)) — 1px borders, dividers, browser-frame
  chrome.
- **Oro pastel** (#C9A26B) — THE single accent, saturation well under 80%.
  Brand-only dosage: the lazo mark, the wordmark's i-dot, progress-bar
  fills, focus rings, icon strokes. NEVER large fills, NEVER button
  backgrounds (buttons are Tinta), and NEVER as a text color on Papel or
  white — it measures 2.06:1 on Papel, failing AA at any size. Text on an
  oro fill, if ever needed, is dark brown #35291D (5.96:1) — never white.
- **Oro texto** (#856434) — the text-safe gold. Use this whenever a word,
  numeral or glyph needs the gold voice (two-tone headlines, highlighted
  stats): 4.5:1+ on Papel/white/rubor/menta; on vainilla (4.13:1) only at
  display sizes (≥24px bold, 3:1 threshold).
- **Paper tints** (#FAF8F3 · #EFEAE0 · #E7E0D3) — pastel tile backgrounds
  for stat trios, FAQ numerals, soft callouts. Tonal family, no rainbow.
- **Salvia** (#6E7D6A) — semantic success only ("pagada ✓", confirmations).
- **Granate** (#6E2B35) — semantic urgency/error only ("vence en 3 días").
  Semantic colors never decorate; they inform.

## 3. Typography Rules

- **One family for everything: Plus Jakarta Sans.** Hierarchy is carried by
  weight, size and the two-tone trick — never by switching typefaces.
  - Display: weight 800 (ExtraBold), tracking −0.025em, leading ~1.04.
    Two-tone headlines are the signature: first clause in Tinta, the
    second in Tinta 42% (e.g. "Un enlace. Vuestro regalo," / "hecho
    realidad entre todos.").
  - UI/labels: weight 700. Micro-labels uppercase with +0.14em tracking.
  - Body: weight 500, relaxed leading, max 65ch.
- **Numbers:** always `font-variant-numeric: tabular-nums` in any list,
  table or stat. Money is sacred: "6.450 €" style, es-ES formatting.
- **Wordmark:** always lowercase "vinklo", weight 800, with the i-dot drawn
  in Oro pastel (dotless ı + a gold dot). Never "VINKLO", never "Vinklo".
- **Banned:** Inter, Georgia, Times New Roman, any generic serif anywhere.
  No serif at all in this system — warmth comes from color and shape.

## 4. Component Stylings

- **Buttons:** primary = Tinta pill (fully rounded), white text, weight
  700–800, soft ink-tinted shadow (0 10px 22px −10px rgba(23,21,18,0.45)),
  −1px translate on hover, back to 0 on press. Secondary = white pill with
  hairline border, or a plain bold text link with underline on hover. One
  primary CTA per view. No neon, no glows, no gradients.
- **Cards:** white, radius 1.375rem with ONE oversized top-right "flap"
  corner at 2.25rem — the envelope signature, applied to feature cards and
  tiles, not to tiny chips. Hairline border + soft brown shadow. Use cards
  only where elevation means something; inside dense panels prefer divider
  rows.
- **The envelope ("el sobre"):** the guest contribution module is a white
  card with a triangular top flap (clip-path) that rotates open once when
  scrolled into view, and a circular wax-seal button in Oro pastel with the
  couple's initials. This is the product's face — treat it with care.
- **Glass pills:** floating nav and small badges only — white at 65%
  opacity, backdrop blur 10px, hairline border, fully rounded.
- **Browser-frame showcase:** product screenshots live inside a minimal
  white browser chrome (three hairline dots + a pill URL reading
  vinklo.es/…) sitting on Papel.
- **Inputs:** label above (weight 500–700), field on Papel-40% fill with
  hairline border, focus ring in Oro pastel at 40%, error text below in
  Granate. Amount fields get quick-amount chips (paper-tint pills) — they
  are suggestions, never minimums.
- **Loading:** skeleton blocks matching layout. **Empty states:** warm
  composed copy telling the couple what will appear and how to make it
  happen — never bare "No data".

## 5. Layout Principles

- Left-aligned, asymmetric compositions. Centered layouts only for the
  guest invitation page, which is ceremonial by nature.
- Max-width containment: marketing 72rem, app panels 64rem, guest page
  28rem column. CSS Grid for multi-column structures; no flex percentage
  math, no calc() hacks.
- The "3 equal cards" pattern only as a stat/tile trio with paper-tint
  backgrounds and tight copy — never as a generic feature row. Features go
  in steps-beside-demo or zig-zag splits.
- Full-height sections use min-h-svh/dvh, never h-screen.
- One decorative "technical drawing" corner allowed per page: repeating
  135° dashed hairlines masked to fade, top-right, desktop only.
- Mobile < 768px: single column, no horizontal scroll ever, 44px minimum
  touch targets, headlines scale via clamp().

## 6. Motion & Interaction

- **Signature entrance:** staggered blur-in — words or blocks animate from
  { opacity 0, y 20–40, blur(10px) } to sharp, 0.7–0.8s easeOut, ~90ms
  stagger. Hero on load; sections via whileInView, once, ~15% threshold.
- **Progress bars** grow from a small width to their value (~1.4s easeOut,
  delayed) in Oro pastel.
- **One perpetual loop maximum per view:** the guest countdown breathes
  (scale 1→1.03, 2.6s ease-in-out infinite). Nothing else loops.
- **Autoplaying product demo:** stories-style scenes with thin progress
  bars that drive scene advance; pause/replay controls always visible.
- `prefers-reduced-motion`: everything collapses to opacity-only fades;
  loops and parallax stop. Non-negotiable.
- Animate transform/opacity only. Grain lives on a fixed pseudo-element.

## 7. Voice & Copy (es-ES)

- Warm and celebratory to guests ("¡Qué ganas de veros!"), sober and clear
  in the couple's panel. Always "vosotros" for the couple.
- The value proposition is IMPLIED, never stated bluntly: guests' money
  arrives before the wedding and the couple pays vendors with it, "sin
  adelantarlo todo, sin agobios". Never write "financiada por vuestros
  invitados" as a headline; never "recaudar dinero" or "colecta".
- Zero tax/fiscal language (no Hacienda, no ISD). Zero pressure language
  (no minimums, no "plazas limitadas" scarcity badges).
- Fees are always disclosed before paying: "Gastos de gestión" on its own
  line. Klarna 3× interest-free is mentioned as an option ("también
  podéis"), never as the main path.

## 8. Anti-Patterns (Banned)

- No emojis as UI iconography. No Inter. No serif fonts. No pure #000000.
- No purple/blue AI gradients, no neon glows, no oversaturated accents,
  no second accent color (coral and lime were retired — do not resurrect).
- No white text on Oro pastel (contrast failure).
- No Oro pastel (#C9A26B) as a text color on Papel or white (2.06:1, AA
  failure at any size) — text that needs the gold voice uses Oro texto
  (#856434); Oro pastel stays on borders, rings, icon strokes and fills
  behind Tinta text (verify contrast case-by-case, never assume safe).
- No readable text below Tinta 60% opacity — sub-60% ink is
  decoration-only.
- No centered marketing heroes, no "Scroll to explore", no bouncing
  chevrons, no scarcity badges, no trust-logo farms with invented brands.
- No overlapping elements; the open envelope flap must always have empty
  space to rotate into.
- No generic names (use Ana & Luis, Marta y Jorge, Tía Carmen) and no
  round fake numbers (6.450 € beats 5.000 €).
- No AI copy clichés: "Elevate", "Seamless", "Unleash", "revoluciona",
  "sin complicaciones" as filler.
- No stock photography; imagery is CSS/SVG-drawn (mockups, the lazo, the
  envelope) until real wedding photography is art-directed.
- No suggested-amount or per-person pricing anywhere guest-facing: amounts
  are free, chips are shortcuts.

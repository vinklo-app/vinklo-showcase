import type { CSSProperties, ReactNode } from "react";
import { CoverPhoto } from "./cover-photo";
import type { SceneImage, SceneOf, SiteThemeId } from "@/lib/site-document";
import { coupleInitials, formatWeddingDate, isOptimizableImage } from "../format";
import { CoverCountdown } from "./cover-countdown";
import { DATE_GAP_FIELD, editPath, editScene } from "../edit-targets";

/** Familia del h1 por tema (DESIGN.md §3: display en peso 400). */
export const NAME_FONT: Record<SiteThemeId, string> = {
  editorial: "font-display",
  clasico: "font-script",
  natural: "font-serif",
};

/**
 * Fotos muy panorámicas (más de 2:1): recortarlas a una pantalla vertical
 * las amplía ×4 o más y quedan borrosas. En móvil se muestran enteras como
 * banda arriba, con el texto sobre la tinta del tema.
 */
const WIDE_PHOTO = 2;

/**
 * Escalones del h1 por longitud (grafemas de nombre + nombre): > 26 baja un
 * escalón (`data-long=""`), > 48 dos y limita líneas en la Story
 * (`data-long="xl"`). El texto completo sigue en el DOM y en «Ver todos los
 * detalles».
 */
const LONG_NAMES = 26;
const XLONG_NAMES = 48;

export function nameTier(partnerName1: string, partnerName2: string): "" | "xl" | undefined {
  const length = Array.from(`${partnerName1}${partnerName2}`).length;
  if (length > XLONG_NAMES) return "xl";
  if (length > LONG_NAMES) return "";
  return undefined;
}

/**
 * Palabra más larga de los nombres (grafemas, mínimo 4; el «& » cuenta con
 * la primera del segundo nombre, que abre su línea; las mayúsculas tras la
 * inicial pesan más, para nombres escritos en versales). La escala grande de
 * portada no puede partir una palabra a mitad («Bartholomew» a 6rem no cabe
 * en 358 px): el CSS limita la cifra a lo que cabe para esta palabra en el
 * ancho de la columna (`--sp-word`, ver `.sp-h1` en story-player.css).
 */
export function longestWord(partnerName1: string, partnerName2: string): number {
  // Las mayúsculas de Playfair son ~1,3 veces más anchas que las minúsculas.
  const graphemes = (w: string) => Math.ceil(Array.from(w).reduce((n, ch) => n + (ch !== ch.toLowerCase() && n > 0 ? 1.3 : 1), 0));
  const words1 = partnerName1.trim().split(/\s+/);
  const words2 = partnerName2.trim().split(/\s+/);
  // «& Juan» viaja junto: la primera palabra del segundo nombre cuenta con el «& ».
  return Math.max(4, ...words1.map(graphemes), ...words2.map(graphemes), graphemes(words2[0] ?? "") + 2);
}

/**
 * Nombres en dos líneas de revista: el primero, y debajo el «&» en cursiva
 * de acento con el segundo. Los espacios se conservan para que el texto
 * (y el lector de pantalla) siga siendo «Lucía Juan» como antes.
 */
export function Names({ partnerName1, partnerName2, ampClassName }: { partnerName1: string; partnerName2: string; ampClassName: string }) {
  return (
    <>
      <span className="sp-name">{partnerName1}</span>{" "}
      <span className="sp-name">
        <span aria-hidden="true" className={`sp-amp font-script ${ampClassName}`.trim()}>
          &amp;
        </span>{" "}
        {partnerName2}
      </span>
    </>
  );
}

export interface CoverSceneProps {
  scene: SceneOf<"cover">;
  themeId: SiteThemeId;
  /** Reloj inyectable para una cuenta atrás determinista (tests, preview). */
  now?: Date;
  /** Hora de la ceremonia (lugar o programa): con ella la cuenta atrás llega a horas y minutos. */
  ceremonyTime?: string | null;
  /**
   * Foto que sustituye a la del documento (preview del creador con un
   * `blob:` local que el contrato no admite). La pone el renderer.
   */
  imageOverride?: SceneImage | null;
  /** Hueco opcional entre la bienvenida y la cuenta atrás (p. ej. acciones). */
  children?: ReactNode;
  /**
   * Nivel del título con los nombres. 1 en la página pública (es su título);
   * 2 en los previews, que viven dentro de otra página con su propio h1.
   */
  headingLevel?: 1 | 2;
  /** Solo en el editor: marcas de «Seleccionar» (ver edit-targets.ts). */
  edit?: boolean;
}

/**
 * Portada.
 *
 * - **Con foto**: la foto de la pareja a sangre ocupa toda la escena (o toda
 *   la primera pantalla en la vista continua), con un velo de tinta de cine
 *   que asegura la lectura; nombres a escala de revista alineados a la
 *   izquierda, fecha y cuenta atrás compacta en papel sobre la foto. Es la
 *   única imagen con prioridad (LCP).
 * - **Sin foto**: monograma de un glifo, eyebrow, nombres, fecha, bienvenida
 *   y cuenta atrás tipográfica sobre el papel (igual que antes).
 */
export function CoverScene({ scene, themeId, now, ceremonyTime = null, imageOverride, children, headingLevel = 1, edit }: CoverSceneProps) {
  const at = (field: string) => editPath(edit, `${scene.id}/${field}`);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const { partnerName1, partnerName2, weddingDate, eyebrow, welcomeMessage, showCountdown } = scene.props;
  const image = imageOverride !== undefined ? imageOverride : scene.props.image;
  const initials = coupleInitials(partnerName1, partnerName2);
  const prettyDate = weddingDate ? formatWeddingDate(weddingDate) : null;
  // Instante del primer render (servidor o cliente): la cuenta atrás hidrata con él y luego sigue viva.
  const initialNow = (now ?? new Date()).getTime();
  const countdown = showCountdown && weddingDate ? (variant: "photo" | "paper") => <CoverCountdown weddingDate={weddingDate} time={ceremonyTime} initialNow={initialNow} variant={variant} /> : () => null;
  const long = nameTier(partnerName1, partnerName2);
  const wordVar = { "--sp-word": String(longestWord(partnerName1, partnerName2)) } as CSSProperties;

  if (image) {
    const ratio = image.width && image.height ? image.width / image.height : null;
    return (
      <header
        className="sp-cover flex flex-col"
        {...editScene(edit, scene.id)}
        data-photo=""
        data-photo-fit={ratio && ratio > WIDE_PHOTO ? "band" : undefined}
        style={ratio ? ({ "--sp-photo-ratio": String(ratio) } as CSSProperties) : undefined}
      >
        <div className="sp-cover-photo">
          <CoverPhoto
            src={image.url}
            alt={image.alt || `Foto de ${partnerName1} y ${partnerName2}`}
            unoptimized={!isOptimizableImage(image.url)}
          />
          {/* Velo de tinta (token del tema): lectura AA del texto en papel sobre cualquier foto. */}
          <div aria-hidden="true" className="sp-cover-scrim" />
        </div>

        <div className="sp-cover-body mx-auto w-full max-w-[44rem]" style={wordVar}>
          {eyebrow && <p className="sp-cover-eyebrow sp-eyebrow font-mono text-[11px] font-medium uppercase" {...at("eyebrow")}>{eyebrow}</p>}
          <Heading className={`${NAME_FONT[themeId]} sp-h1 mt-4 text-papel`} data-long={long} {...at("names")}>
            <Names partnerName1={partnerName1} partnerName2={partnerName2} ampClassName="" />
          </Heading>
          {prettyDate && <p className="sp-date font-display mt-5 text-papel" {...at(DATE_GAP_FIELD)}>{prettyDate}</p>}
          {!prettyDate && edit && <p className="sp-date sp-date-gap font-display mt-5 text-papel" {...at(DATE_GAP_FIELD)}>Vuestra fecha</p>}
          {welcomeMessage && (
            <p className="sp-cover-welcome mt-4 max-w-[30rem] whitespace-pre-line text-[0.9375rem] leading-relaxed text-pretty" {...at("welcomeMessage")}>
              {welcomeMessage}
            </p>
          )}
          {children}
          {countdown("photo")}
        </div>
      </header>
    );
  }

  return (
    <header className="sp-cover flex flex-col" {...editScene(edit, scene.id)}>
      <p aria-hidden="true" className="sp-monogram font-script text-center text-tinta/70">
        {initials}
      </p>

      <div className="sp-cover-body mx-auto w-full max-w-[44rem] text-center pt-7" style={wordVar}>
        {eyebrow && (
          <p className="sp-eyebrow font-mono text-[11px] font-medium text-cava-texto uppercase" {...at("eyebrow")}>{eyebrow}</p>
        )}
        <Heading className={`${NAME_FONT[themeId]} sp-h1 mt-5 text-tinta`} data-long={long} {...at("names")}>
          <Names partnerName1={partnerName1} partnerName2={partnerName2} ampClassName="text-cava" />
        </Heading>
        {prettyDate && <p className="sp-date font-display mt-6 text-tinta/85" {...at(DATE_GAP_FIELD)}>{prettyDate}</p>}
        {!prettyDate && edit && <p className="sp-date sp-date-gap font-display mt-6 text-tinta/85" {...at(DATE_GAP_FIELD)}>Vuestra fecha</p>}
        {welcomeMessage && (
          <p className="mx-auto mt-7 max-w-[34rem] whitespace-pre-line text-base leading-relaxed text-pretty text-tinta/75" {...at("welcomeMessage")}>
            {welcomeMessage}
          </p>
        )}
        {children}
        {countdown("paper")}
      </div>
    </header>
  );
}

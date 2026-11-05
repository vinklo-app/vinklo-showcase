"use client";

import { SITE_PALETTES, type SitePaletteId, type SiteThemeId } from "@/lib/site-document";

const LETTERS: ReadonlyArray<{ id: SiteThemeId; label: string }> = [
  { id: "editorial", label: "Editorial" },
  { id: "clasico", label: "Caligráfica" },
  { id: "natural", label: "Serena" },
];

/**
 * Colores de la web: una muestra por paleta curada (contraste AA verificado
 * en el contrato). Cada muestra pinta su papel, su tinta y su acento con los
 * valores de `SITE_PALETTES` (datos, no estilos de la marca Vinklo).
 * Botones con `aria-pressed`: Tab los recorre, Espacio/Intro elige.
 * Debajo, la letra de los nombres. La forma (Story o web) y el sobre ya no
 * se eligen en el creador (13-oct-2026): toda invitación nueva es web y
 * abre con el sobre; la Story vuelve como opción premium (tarea 5).
 */
export function PalettePicker({ selected, style, onPalette, onStyle, disabled, only }: { selected: SitePaletteId; style: SiteThemeId; onPalette: (id: SitePaletteId) => void; onStyle: (id: SiteThemeId) => void; disabled?: boolean; /** Solo un apartado (el creador abre cada uno desde su botón). */ only?: "colores" | "letra" }) {
  const show = (section: "colores" | "letra") => !only || only === section;
  return <div className="wb-design" data-only={only}>
    {show("colores") && <>
    <div className="wb-design-head"><p id="wb-palettes-label">Colores</p><p className="wb-design-current" aria-live="polite">{SITE_PALETTES.find((palette) => palette.id === selected)?.label}</p></div>
    <div className="wb-palettes" role="group" aria-labelledby="wb-palettes-label">
      {SITE_PALETTES.map((palette) => <button
        key={palette.id}
        type="button"
        className="wb-swatch"
        aria-pressed={selected === palette.id}
        aria-label={palette.label}
        title={palette.label}
        disabled={disabled}
        onClick={() => onPalette(palette.id)}
        style={{ "--sw-paper": palette.paper, "--sw-ink": palette.ink, "--sw-accent": palette.accent } as React.CSSProperties}
      >
        <span className="wb-swatch-card" aria-hidden="true"><span className="wb-swatch-aa">Aa</span><span className="wb-swatch-dot" /></span>
      </button>)}
    </div>
    </>}
    {show("letra") && <div className="wb-letters" role="group" aria-label="Letra de los nombres">
      <span aria-hidden="true">Letra</span>
      {LETTERS.map((letter) => <button key={letter.id} type="button" aria-pressed={style === letter.id} disabled={disabled} onClick={() => onStyle(letter.id)}>{letter.label}</button>)}
    </div>}
  </div>;
}

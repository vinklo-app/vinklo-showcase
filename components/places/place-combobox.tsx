"use client";

/**
 * Campo de texto con sugerencias de lugares (patrón combobox de ARIA 1.2,
 * lista «list» con aria-activedescendant). Lo que escribe la pareja manda:
 * las sugerencias solo ayudan; elegir una llama a `onPick` con nombre,
 * dirección y (con Google) el place_id. Teclado: flechas, Intro, Escape.
 * Táctil: opciones de 44 px; el campo no pierde el foco al tocarlas.
 *
 * Pide a /api/lugares (proxy de servidor) tras 350 ms sin teclear y con 3+
 * caracteres; respuestas en caché por consulta mientras la página está
 * abierta. Si el servicio no responde, el campo funciona como uno normal.
 *
 * La etiqueta envuelve SOLO el texto y el campo (mismas clases que el resto
 * del formulario); la lista va fuera para no entrar en el nombre accesible.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { normalizePlaceQuery, PLACES_ATTRIBUTION, PLACES_DEBOUNCE_MS, type PickedPlace, type PlaceDetail, type PlaceSuggestion, type PlacesResponse } from "@/lib/places/places";
import "./place-combobox.css";

export interface PlaceComboboxProps {
  label: ReactNode;
  value: string;
  /** Texto escrito a mano (también al borrar). */
  onChange(value: string): void;
  /** Sugerencia elegida. Puede llamarse otra vez con la dirección completa (Google). */
  onPick(place: PickedPlace): void;
  id?: string;
  className?: string;
  labelClassName?: string;
  inputClassName?: string;
  maxLength?: number;
  placeholder?: string;
  enterKeyHint?: "next" | "done" | "enter" | "go" | "search" | "send" | "previous";
  disabled?: boolean;
  required?: boolean;
}

const responseCache = new Map<string, PlacesResponse>();
const CACHE_MAX = 100;

function newSessionToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

export function PlaceCombobox({
  label,
  value,
  onChange,
  onPick,
  id,
  className,
  labelClassName,
  inputClassName,
  maxLength,
  placeholder,
  enterKeyHint,
  disabled,
  required,
}: PlaceComboboxProps) {
  const autoId = useId();
  const inputId = id ?? `place-${autoId.replace(/:/g, "")}`;
  const listId = `${inputId}-lista`;
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [provider, setProvider] = useState<PlacesResponse["provider"] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const session = useRef<string | null>(null);
  const latestValue = useRef(value);
  /** Sube con cada tecla y cada elección: la dirección completa solo llega si nada cambió después. */
  const edits = useRef(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestValue.current = value;
  // La dirección completa llega después: se entrega con el onPick del último
  // render (el de la elección ya tiene un estado viejo y lo devolvería).
  const latestOnPick = useRef(onPick);
  latestOnPick.current = onPick;

  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (blurTimer.current) clearTimeout(blurTimer.current);
    abort.current?.abort();
  }, []);

  function show(response: PlacesResponse) {
    setProvider(response.provider);
    setSuggestions(response.suggestions);
    setActive(-1);
    setOpen(response.suggestions.length > 0);
  }

  function schedule(text: string) {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    const query = normalizePlaceQuery(text);
    if (!query) {
      setSuggestions([]);
      close();
      return;
    }
    const cached = responseCache.get(query.toLocaleLowerCase("es"));
    if (cached) {
      show(cached);
      return;
    }
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      abort.current = controller;
      session.current ??= newSessionToken();
      try {
        const params = new URLSearchParams({ q: query, sesion: session.current });
        const res = await fetch(`/api/lugares?${params.toString()}`, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) {
          setSuggestions([]);
          close();
          return;
        }
        const body = (await res.json()) as PlacesResponse;
        if (!Array.isArray(body?.suggestions)) return;
        // Las respuestas de Google no se guardan (condiciones de Google Maps Platform).
        if (body.provider !== "google") {
          if (responseCache.size >= CACHE_MAX) {
            const oldest = responseCache.keys().next().value;
            if (oldest !== undefined) responseCache.delete(oldest);
          }
          responseCache.set(query.toLocaleLowerCase("es"), body);
        }
        // Si mientras tanto la pareja siguió escribiendo, llega otra respuesta.
        if (normalizePlaceQuery(latestValue.current) === query) show(body);
      } catch {
        /* Sin red o cancelada: el campo sigue siendo un campo normal. */
      }
    }, PLACES_DEBOUNCE_MS);
  }

  function pick(suggestion: PlaceSuggestion) {
    close();
    setSuggestions([]);
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    const place: PickedPlace = { name: suggestion.name, address: suggestion.address, ...(suggestion.placeId ? { placeId: suggestion.placeId } : {}) };
    onPick(place);
    const seq = ++edits.current;
    const token = session.current;
    session.current = null;
    // Google: el detalle cierra la sesión (lo que la abarata) y trae la dirección completa.
    if (provider === "google" && suggestion.placeId) {
      const params = new URLSearchParams({ id: suggestion.placeId, ...(token ? { sesion: token } : {}) });
      void fetch(`/api/lugares?${params.toString()}`, { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<{ detail: PlaceDetail | null }>) : null))
        .then((body) => {
          const detail = body?.detail;
          if (!detail || detail.placeId !== suggestion.placeId || !detail.address) return;
          // Solo si nadie ha escrito ni elegido otra cosa mientras tanto.
          if (edits.current !== seq) return;
          latestOnPick.current({ ...place, address: detail.address, full: true });
        })
        .catch(() => { /* La dirección corta ya está puesta. */ });
    }
  }

  const expanded = open && suggestions.length > 0;
  const activeId = expanded && active >= 0 ? `${listId}-${active}` : undefined;

  return (
    <div className={`vk-place${className ? ` ${className}` : ""}`}>
      <label htmlFor={inputId} className={labelClassName}>
        {label}
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={activeId}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={inputClassName}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          enterKeyHint={enterKeyHint}
          disabled={disabled}
          required={required}
          onChange={(event) => {
            edits.current += 1;
            onChange(event.target.value);
            schedule(event.target.value);
          }}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
          }}
          onBlur={() => {
            // Un toque en una opción no quita el foco (onMouseDown), pero en
            // algunos móviles el blur llega antes: margen breve.
            blurTimer.current = setTimeout(close, 150);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              if (suggestions.length === 0) return;
              event.preventDefault();
              setOpen(true);
              setActive((i) => (i + 1) % suggestions.length);
            } else if (event.key === "ArrowUp") {
              if (!expanded) return;
              event.preventDefault();
              setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
            } else if (event.key === "Enter") {
              if (expanded && active >= 0 && suggestions[active]) {
                event.preventDefault();
                pick(suggestions[active]);
              }
            } else if (event.key === "Escape") {
              if (expanded) {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            } else if (event.key === "Tab") {
              close();
            }
          }}
        />
      </label>
      <div className="vk-place-pop" hidden={!expanded}>
        <ul id={listId} role="listbox" aria-label="Sugerencias de lugares" className="vk-place-list">
          {suggestions.map((s, i) => (
            <li
              key={s.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="vk-place-option"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
            >
              <span className="vk-place-name">{s.name}</span>
              {s.address && <span className="vk-place-address">{s.address}</span>}
            </li>
          ))}
        </ul>
        {provider && <p className="vk-place-credit">{PLACES_ATTRIBUTION[provider]}</p>}
      </div>
      <p className="sr-only" aria-live="polite">
        {expanded ? `${suggestions.length} ${suggestions.length === 1 ? "sugerencia" : "sugerencias"}; usad las flechas para elegir.` : ""}
      </p>
    </div>
  );
}

import { SearchIcon } from "lucide-react";

/**
 * Buscador rápido del resumen: lleva a la lista con la búsqueda hecha (la
 * búsqueda real es la del servidor, `guest_page`). Sin JavaScript también
 * funciona: es un formulario GET.
 */
export function QuickSearch() {
  return (
    <form action="/panel/invitados" method="get" role="search" className="pn-search pn-quick-search">
      <SearchIcon aria-hidden="true" className="size-4 shrink-0 pn-muted" />
      <label htmlFor="pn-quick-q" className="sr-only">Buscar un invitado</label>
      <input id="pn-quick-q" name="q" type="search" placeholder="Buscar un invitado por su nombre…" autoComplete="off" enterKeyHint="search" maxLength={80} />
    </form>
  );
}

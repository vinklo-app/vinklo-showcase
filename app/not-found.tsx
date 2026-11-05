import Link from "next/link";

import { LazoIcon } from "@/components/brand/icons";
import "@/app/login/access.css";

export const metadata = { title: "Página no encontrada" };

/**
 * 404 raíz con la marca. Lo recibe cualquier ruta inexistente fuera de
 * /b/[slug] (que tiene su propio not-found para invitados). Cuando una web
 * de boda se retire y C retire el suyo, también se verá esta pantalla.
 */
export default function NotFound() {
  return (
    <main className="ac-page">
      <header className="ac-top">
        <Link href="/" aria-label="vinklo, inicio" className="ac-wordmark">
          <LazoIcon aria-hidden="true" />
          <span aria-hidden="true">
            v<span className="ac-wordmark-i">ı</span>nklo
          </span>
        </Link>
      </header>

      <section className="ac-center">
        <div className="ac-card">
          <p className="ac-code tabular" aria-hidden="true">
            404
          </p>
          <h1 className="ac-h1">Esta página no existe.</h1>
          <Link href="/" className="ac-btn ac-btn--inline">
            Volver al inicio
          </Link>
        </div>
      </section>

      <footer className="ac-foot">
        <nav aria-label="Legal">
          <Link href="/aviso-legal">Aviso legal</Link>
          <Link href="/privacidad">Privacidad</Link>
        </nav>
      </footer>
    </main>
  );
}

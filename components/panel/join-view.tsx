import Link from "next/link";

import { LazoIcon } from "@/components/brand/icons";
import { JoinAcceptForm } from "@/components/panel/join-accept-form";
import { continueToLogin, type AcceptState } from "@/lib/actions/partner";
import "@/app/login/access.css";

/**
 * Vista de /unirse (también en /borrador/pareja). `email`: undefined = sin
 * sesión; null = sesión sin email. Nunca recibe datos de la boda.
 */
export function JoinView({ token, email, initial }: { token: string | null; email: string | null | undefined; initial?: AcceptState }) {
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

      <section className="ac-center" aria-labelledby="unirse-title">
        <div className="ac-card">
          <p className="font-label ac-eyebrow">Invitación de tu pareja</p>
          {!token ? (
            <>
              <h1 id="unirse-title" className="ac-h1">
                Falta <em>el enlace.</em>
              </h1>
              <p className="ac-lead">
                Abre el botón «Unirme a la boda» del correo que te ha llegado. Si no lo encuentras,
                pide a tu pareja que te reenvíe la invitación desde Ajustes.
              </p>
              <Link href="/login" className="ac-btn ac-btn--inline">Ir a la entrada</Link>
            </>
          ) : email === undefined ? (
            <>
              <h1 id="unirse-title" className="ac-h1">
                Preparad la boda <em>a cuatro manos.</em>
              </h1>
              <p className="ac-lead">
                Entra con el correo en el que has recibido la invitación. Te mandamos un enlace de un
                solo uso y, al volver, aceptas y ves vuestra boda.
              </p>
              <form action={continueToLogin}>
                <input type="hidden" name="token" value={token} />
                <button type="submit" className="ac-btn">Entrar con mi correo</button>
              </form>
            </>
          ) : (
            <>
              <h1 id="unirse-title" className="ac-h1">
                Preparad la boda <em>a cuatro manos.</em>
              </h1>
              <JoinAcceptForm token={token} email={email} initial={initial} />
            </>
          )}
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

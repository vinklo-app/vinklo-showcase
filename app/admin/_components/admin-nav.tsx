"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/admin", label: "Resumen" },
  { href: "/admin/bodas", label: "Bodas" },
  { href: "/admin/waitlist", label: "Waitlist" },
] as const;

/** Navegación del admin; `current` fija la sección activa (borrador de dev). */
function AdminNav({ current }: { current?: string }) {
  const pathname = usePathname();
  const active = current ?? pathname;
  return (
    <nav aria-label="Secciones del admin" className="ad-nav">
      <ul>
        {NAV.map((item) => (
          <li key={item.href}>
            <Link href={item.href} aria-current={active === item.href ? "page" : undefined}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AdminTopbar({ current }: { current?: string }) {
  return (
    <header className="ad-topbar">
      <p className="ad-brand">
        <span aria-label="vinklo">
          v<span className="ad-brand-i">ı</span>nklo
        </span>
        <span className="ad-folio">Admin</span>
      </p>
      <AdminNav current={current} />
    </header>
  );
}

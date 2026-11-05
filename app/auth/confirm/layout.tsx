import type { Metadata } from "next";

// La página es de cliente (verifica el enlace al cargar) y no puede exportar
// metadata: la pone este layout. Enlace de un solo uso, fuera del índice.
export const metadata: Metadata = {
  title: "Enlace de acceso",
  robots: { index: false, follow: false },
};

export default function AuthConfirmLayout({ children }: { children: React.ReactNode }) {
  return children;
}

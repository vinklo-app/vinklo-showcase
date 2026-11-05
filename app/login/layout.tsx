import { NacarBackground } from "@/components/brand/nacar-background";
import type { Metadata } from "next";

// La página de login es un client component; su metadata vive aquí.
export const metadata: Metadata = {
  title: "Entrar",
  description:
    "Accede a vuestro panel de vinklo para crear vuestra web de boda y gestionar las confirmaciones de asistencia.",
};

export default function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <NacarBackground />
      {children}
    </>
  );
}

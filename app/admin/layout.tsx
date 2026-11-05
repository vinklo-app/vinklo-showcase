import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { AdminTopbar } from "./_components/admin-nav";
import "@/components/panel/panel.css";
import "./admin.css";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false, nocache: true },
};

// Siempre dinámico: datos privados y en vivo. El middleware añade
// `Cache-Control: private, no-store` a /admin/:path*.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // El layout NO es la frontera de seguridad (cada página llama a
  // assertAdmin); este chequeo solo evita pintar el marco a quien no toca.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdminUser(user)) {
    notFound();
  }

  return (
    <div className="bb-scope min-h-svh">
      <div className="ad-shell">
        <AdminTopbar />
        <main className="flex flex-col gap-5">{children}</main>
      </div>
    </div>
  );
}

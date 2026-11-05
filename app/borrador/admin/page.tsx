import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTopbar } from "@/app/admin/_components/admin-nav";
import { OverviewView } from "@/app/admin/_components/overview-view";
import { buildFunnel, summarizeSignups } from "@/lib/admin/overview";
import type { AdminOverview, AdminWeddingSummary } from "@/lib/admin/types";
import "@/components/panel/panel.css";
import "@/app/admin/admin.css";

/**
 * Preview del resumen del admin con datos FICTICIOS — SOLO en desarrollo
 * (404 en producción; nunca indexable). Misma vista que /admin.
 * `?datos=demo` (por defecto) · `vacio` (día cero) · `parcial` (producción
 * con migraciones pendientes: cifras «—» y nota al pie).
 */
export const metadata: Metadata = {
  title: "Borrador · admin",
  robots: { index: false, follow: false },
};

const NOW = new Date("2026-10-04T10:30:00Z");
const DAY = 86_400_000;
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - days * DAY - hours * 3_600_000).toISOString();

function demoSignups(): string[] {
  // Curva creíble: goteo inicial y subida tras compartir la landing.
  const perDay = [0, 1, 0, 0, 2, 1, 0, 1, 3, 2, 0, 1, 4, 2, 3, 5, 2, 1, 6, 4, 3, 2, 7, 5, 4, 6, 3, 8, 5, 3];
  const out: string[] = [];
  perDay.forEach((n, i) => {
    for (let k = 0; k < n; k += 1) out.push(ago(29 - i, 1 + k));
  });
  for (let k = 0; k < 9; k += 1) out.push(ago(40 + k * 3));
  return out;
}

const WEDDINGS: AdminWeddingSummary[] = [
  { id: "1", slug: "lucia-y-juan", partnerNames: "Lucía y Juan", weddingDate: "2027-06-12", createdAt: ago(0, 2), siteState: "published", hasPhoto: true, palette: "terracota", guestCount: 118, isInternal: false },
  { id: "2", slug: "marta-y-jorge", partnerNames: "Marta y Jorge", weddingDate: "2027-05-22", createdAt: ago(1, 5), siteState: "published", hasPhoto: false, palette: "editorial", guestCount: 64, isInternal: false },
  { id: "3", slug: "ines-y-alvaro-2", partnerNames: "Inés y Álvaro", weddingDate: "2027-09-04", createdAt: ago(2, 1), siteState: "draft", hasPhoto: false, palette: "mar", guestCount: 0, isInternal: false },
  { id: "4", slug: "nerea-y-iker", partnerNames: "Nerea y Iker", weddingDate: "2027-07-17", createdAt: ago(3, 9), siteState: "published", hasPhoto: true, palette: "natural", guestCount: 132, isInternal: false },
  { id: "5", slug: "carmen-y-pablo", partnerNames: "Carmen y Pablo", weddingDate: null, createdAt: ago(5), siteState: "legacy", hasPhoto: false, palette: "clasico", guestCount: 7, isInternal: false },
  { id: "6", slug: "rocio-y-dani", partnerNames: "Rocío y Dani", weddingDate: "2027-04-30", createdAt: ago(8, 3), siteState: "retired", hasPhoto: true, palette: "rosa", guestCount: 41, isInternal: false },
  { id: "7", slug: "maria-jose-y-francisco-javier", partnerNames: "María José y Francisco Javier", weddingDate: "2027-10-09", createdAt: ago(11), siteState: "published", hasPhoto: true, palette: "oro", guestCount: 1204, isInternal: false },
  { id: "8", slug: "marta-y-jorge-prueba", partnerNames: "Marta y Jorge", weddingDate: "2027-05-22", createdAt: ago(0, 1), siteState: "published", hasPhoto: false, palette: "editorial", guestCount: 12, isInternal: true },
];

function demo(): AdminOverview {
  const createdAts = demoSignups();
  const users = {
    ...summarizeSignups(createdAts, NOW),
    recentSignIns: [
      ["lucia.fernandez@gmail.com", ago(0, 1), false],
      ["marta.y.jorge.2027@hotmail.com", ago(0, 3), false],
      ["prueba@vinklo.es", ago(0, 5), true],
      ["iker.etxeberria.larrinaga@outlook.es", ago(0, 7), false],
      ["ines@ejemplo.es", ago(1, 2), false],
      ["rocio.dani@icloud.com", ago(2, 6), false],
    ].map(([email, lastSignInAt, isInternal]) => ({ email: email as string, lastSignInAt: lastSignInAt as string, isInternal: isInternal as boolean })),
    truncated: false,
    internalTotal: 1,
  };
  return {
    generatedAt: NOW.toISOString(),
    users,
    weddings: {
      total: 23,
      published: 14,
      withPhoto: 9,
      palettes: [
        { id: "editorial", label: "Editorial", count: 7 },
        { id: "terracota", label: "Terracota", count: 5 },
        { id: "natural", label: "Natural", count: 4 },
        { id: "mar", label: "Azul mar", count: 3 },
        { id: "rosa", label: "Rosa empolvado", count: 2 },
        { id: "oro", label: "Oro viejo", count: 1 },
        { id: "clasico", label: "Clásico", count: 1 },
      ],
    },
    guests: { total: 1566, prepared: 1012, sent: 847, yes: 389, no: 61, pending: 1116 },
    waitlist: {
      total: 38,
      byKind: { pareja: 31, planner: 4, proveedor: 2, otro: 1 },
      interestedInGifts: 17,
      latest: [
        { id: "w1", email: "anayluis.boda@gmail.com", name: "Ana", kind: "pareja", wedding_date: "2027-06-05", source: "landing-waitlist-v2", created_at: ago(0, 4), interested_in_gifts: true },
        { id: "w2", email: "hola@estudiodebodas.es", name: null, kind: "planner", wedding_date: null, source: "landing-waitlist-v2", created_at: ago(1, 1), interested_in_gifts: false },
        { id: "w3", email: "paula.y.sergio.se.casan.en.septiembre@gmail.com", name: "Paula", kind: "pareja", wedding_date: "2027-09-18", source: "landing-waitlist-v2", created_at: ago(2, 8), interested_in_gifts: true },
        { id: "w4", email: "fincalaalameda@ejemplo.es", name: "Finca La Alameda", kind: "proveedor", wedding_date: null, source: "landing-waitlist-v2", created_at: ago(4), interested_in_gifts: false },
      ],
    },
    funnel: buildFunnel({ registered: createdAts.length, wedding: 23, published: 14, guest: 12, rsvp: 6 }),
    latestWeddings: WEDDINGS,
    payments: { contributions: 6, confirmed: 4, confirmedCents: 64_500, cardFeesCents: 1_838 },
    unavailable: [],
  };
}

function empty(): AdminOverview {
  return {
    generatedAt: NOW.toISOString(),
    users: { ...summarizeSignups([], NOW), recentSignIns: [], truncated: false, internalTotal: 0 },
    weddings: { total: 0, published: 0, withPhoto: 0, palettes: [] },
    guests: { total: 0, prepared: 0, sent: 0, yes: 0, no: 0, pending: 0 },
    waitlist: { total: 0, byKind: { pareja: 0, planner: 0, proveedor: 0, otro: 0 }, interestedInGifts: 0, latest: [] },
    funnel: buildFunnel({ registered: 0, wedding: 0, published: 0, guest: 0, rsvp: 0 }),
    latestWeddings: [],
    payments: null,
    unavailable: [],
  };
}

function partial(): AdminOverview {
  const d = demo();
  return {
    ...d,
    weddings: { ...d.weddings, published: null },
    guests: { ...d.guests, prepared: null, sent: null },
    waitlist: { ...d.waitlist, interestedInGifts: null, latest: d.waitlist.latest.map((row) => ({ ...row, interested_in_gifts: undefined })) },
    funnel: buildFunnel({ registered: d.users!.total, wedding: 23, published: null, guest: 12, rsvp: 6 }),
    latestWeddings: d.latestWeddings.map((w) => ({ ...w, siteState: "legacy" as const })),
    payments: null,
    unavailable: ["wedding_guests.invitation_prepared_at", "wedding_guests.invitation_sent_at", "wedding_sites", "waitlist.interested_in_gifts"],
  };
}

export default async function BorradorAdminPage({ searchParams }: { searchParams: Promise<{ datos?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { datos } = await searchParams;
  const data = datos === "vacio" ? empty() : datos === "parcial" ? partial() : demo();
  return (
    <div className="bb-scope min-h-svh">
      <div className="ad-shell">
        <AdminTopbar current="/admin" />
        <main className="flex flex-col gap-5">
          <OverviewView data={data} />
        </main>
      </div>
    </div>
  );
}

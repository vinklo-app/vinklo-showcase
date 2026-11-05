import Link from "next/link";

/**
 * Pestañas de una página de «Planificar» por enlace (?ver=…): funcionan sin
 * JavaScript y cada vista tiene su URL. Server-safe.
 */
export function PlanningTabs<T extends string>({ label, current, tabs, href }: {
  label: string; current: T; tabs: ReadonlyArray<{ value: T; label: string; count?: number | null }>; href(value: T): string;
}) {
  return (
    <nav aria-label={label} className="pn-segment pn-plan-tabs">
      {tabs.map((tab) => (
        <Link key={tab.value} href={href(tab.value)} aria-current={tab.value === current ? "page" : undefined} className="pn-segment-btn" scroll={false}>
          {tab.label}{typeof tab.count === "number" && <small>{tab.count}</small>}
        </Link>
      ))}
    </nav>
  );
}

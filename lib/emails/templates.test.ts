import { describe, expect, it } from "vitest";
import {
  coupleNotificationHtml,
  guestReceiptHtml,
  shareNudgeHtml,
  trancheReminderHtml,
  vendorInviteHtml,
  vendorSetupNoticeHtml,
  weeklyDigestHtml,
} from "./templates";
import { BRAND_TAGLINE } from "@/lib/brand";

// PNG alojado (Gmail/Outlook no pintan SVG en línea).
const LOGO_IMG = '<img src="https://vinklo.es/email/vinklo-mark.png"';

/**
 * Un correo con el diseño aprobado: logo, footer de marca y, cuando
 * lleva CTA (todas salvo guestReceiptHtml, que es solo un recibo sin
 * botón), un botón redondeado en caja normal — nunca mayúsculas/
 * tracking ni esquinas rectas (diseño v7 antiguo).
 */
function expectApprovedDesign(html: string, { cta = true }: { cta?: boolean } = {}): void {
  expect(html).toContain(LOGO_IMG);
  expect(html).not.toContain("<svg");
  expect(html).toContain(`vinklo &middot; ${BRAND_TAGLINE}`);
  const ctaMatch = html.match(/<a href="[^"]*"[^>]*padding:17px 32px[^>]*>/);
  if (cta) {
    expect(ctaMatch).not.toBeNull();
    expect(ctaMatch?.[0]).toContain("border-radius:10px");
    expect(ctaMatch?.[0]).not.toContain("text-transform:uppercase");
  }
}

describe("diseño aprobado (logo, CTA redondeado, tagline) en cada plantilla", () => {
  it("guestReceiptHtml (recibo, sin CTA)", () => {
    expectApprovedDesign(
      guestReceiptHtml({
        guestName: "Marta",
        partnerNames: "Ana y Luis",
        totalFormatted: "150,00 €",
        feeFormatted: "3,80 €",
        nCubiertos: 2,
      }),
      { cta: false },
    );
  });

  it("trancheReminderHtml", () => {
    expectApprovedDesign(
      trancheReminderHtml({
        vendorName: "Catering Rao",
        trancheLabel: "señal",
        amountFormatted: "3.000,00 €",
        dueDateFormatted: "15 de julio",
        panelUrl: "https://vinklo.es/panel",
      }),
    );
  });

  it("shareNudgeHtml", () => {
    const html = shareNudgeHtml({ daysLeft: 30, guestUrl: "https://vinklo.es/b/ana-y-luis", panelUrl: "https://vinklo.es/panel" });
    expectApprovedDesign(html);
    // Todo correo a la pareja lleva también al panel (acceso rápido, 2026-10-08).
    expect(html).toContain('href="https://vinklo.es/panel"');
  });

  it("coupleNotificationHtml", () => {
    expectApprovedDesign(
      coupleNotificationHtml({
        guestName: "Marta",
        amountFormatted: "150,00 €",
        method: "card",
        panelUrl: "https://vinklo.es/panel",
      }),
    );
  });

  it("weeklyDigestHtml", () => {
    expectApprovedDesign(
      weeklyDigestHtml({
        partnerNames: "Ana y Luis",
        weekItems: [{ guestName: "Marta", amountFormatted: "50,00 €" }],
        weekTotalFormatted: "50,00 €",
        allTotalFormatted: "1.200,00 €",
        panelUrl: "https://vinklo.es/panel",
      }),
    );
  });

  it("vendorSetupNoticeHtml", () => {
    expectApprovedDesign(
      vendorSetupNoticeHtml({
        vendorName: "Catering Rao",
        panelUrl: "https://vinklo.es/panel",
        ibanChanged: false,
      }),
    );
  });

  it("vendorInviteHtml", () => {
    expectApprovedDesign(
      vendorInviteHtml({
        vendorName: "Catering Rao",
        partnerNames: "Ana y Luis",
        inviteUrl: "https://vinklo.es/v/token123",
      }),
    );
  });
});

describe("escapeHtml: los datos del usuario nunca inyectan HTML", () => {
  const XSS = `<script>alert(1)</script>"&'`;
  const XSS_ESCAPED = "&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;&#39;";

  it("guestReceiptHtml escapa guestName, partnerNames y message", () => {
    const html = guestReceiptHtml({
      guestName: XSS,
      partnerNames: XSS,
      totalFormatted: "150,00 €",
      feeFormatted: "3,80 €",
      nCubiertos: 1,
      message: XSS,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(XSS_ESCAPED);
    // El <title> también debe llevar la versión escapada.
    expect(html).toMatch(/<title>[^<]*&lt;script&gt;/);
  });

  it("trancheReminderHtml escapa vendorName y trancheLabel", () => {
    const html = trancheReminderHtml({
      vendorName: XSS,
      trancheLabel: XSS,
      amountFormatted: "1,00 €",
      dueDateFormatted: "1 de enero",
      panelUrl: "https://vinklo.es/panel",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(XSS_ESCAPED);
  });

  it("coupleNotificationHtml escapa guestName y amountFormatted", () => {
    const html = coupleNotificationHtml({
      guestName: XSS,
      amountFormatted: XSS,
      method: "bizum_manual",
      panelUrl: "https://vinklo.es/panel",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(XSS_ESCAPED);
  });

  it("weeklyDigestHtml escapa partnerNames, cada fila y los totales", () => {
    const html = weeklyDigestHtml({
      partnerNames: XSS,
      weekItems: [{ guestName: XSS, amountFormatted: XSS }],
      weekTotalFormatted: XSS,
      allTotalFormatted: XSS,
      panelUrl: "https://vinklo.es/panel",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(XSS_ESCAPED);
  });

  it("vendorInviteHtml escapa vendorName y partnerNames; el href lleva la URL escapada", () => {
    const url = 'https://vinklo.es/v/token?x="><script>alert(1)</script>';
    const html = vendorInviteHtml({
      vendorName: XSS,
      partnerNames: XSS,
      inviteUrl: url,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(XSS_ESCAPED);
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("vendorSetupNoticeHtml escapa vendorName", () => {
    const html = vendorSetupNoticeHtml({
      vendorName: XSS,
      panelUrl: "https://vinklo.es/panel",
      ibanChanged: true,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(XSS_ESCAPED);
  });

  it("panelUrl con comillas queda escapado dentro del href del CTA", () => {
    const html = coupleNotificationHtml({
      guestName: "Marta",
      amountFormatted: "10,00 €",
      method: "card",
      panelUrl: 'https://vinklo.es/panel?x="onmouseover="alert(1)',
    });
    expect(html).toContain("&quot;onmouseover=&quot;alert(1)");
    expect(html).not.toContain('"onmouseover="alert(1)');
  });
});

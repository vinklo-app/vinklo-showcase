import { describe, expect, it } from "vitest";

import { buildContributionCheckoutParams } from "./checkout";
import { serviceFeeCents, totalChargeCents } from "./fees";

const BASE_INPUT = {
  weddingSlug: "maria-y-jorge",
  stripeAccountId: "acct_123ABC",
  contributionCents: 15000,
  feeCents: serviceFeeCents(15000), // 380
  guestName: "Ana",
  appUrl: "https://vinklo.example",
};

describe("buildContributionCheckoutParams", () => {
  it("puts the full fee in application_fee_amount and routes funds to the couple", () => {
    const params = buildContributionCheckoutParams(BASE_INPUT);

    expect(params.mode).toBe("payment");
    expect(params.payment_intent_data?.application_fee_amount).toBe(380);
    expect(params.payment_intent_data?.transfer_data?.destination).toBe(
      "acct_123ABC",
    );
  });

  it("offers card and Klarna as payment methods", () => {
    const params = buildContributionCheckoutParams(BASE_INPUT);
    expect(params.payment_method_types).toEqual(["card", "klarna"]);
  });

  it("line items sum to the guest total (contribution + fee), all in EUR", () => {
    const params = buildContributionCheckoutParams(BASE_INPUT);
    const items = params.line_items ?? [];

    expect(items).toHaveLength(2);
    const amounts = items.map((item) => item.price_data?.unit_amount ?? 0);
    expect(amounts).toEqual([15000, 380]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(totalChargeCents(15000));
    for (const item of items) {
      expect(item.price_data?.currency).toBe("eur");
      expect(item.quantity).toBe(1);
    }
  });

  it("labels the fee line 'Gastos de gestión' and personalizes the cubierto", () => {
    const params = buildContributionCheckoutParams(BASE_INPUT);
    const [cubierto, fee] = params.line_items ?? [];

    expect(cubierto?.price_data?.product_data?.name).toBe("Cubierto de Ana");
    expect(fee?.price_data?.product_data?.name).toBe("Gastos de gestión");
  });

  it("builds success and cancel URLs from the wedding slug", () => {
    const params = buildContributionCheckoutParams(BASE_INPUT);

    expect(params.success_url).toBe(
      "https://vinklo.example/b/maria-y-jorge/gracias?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(params.cancel_url).toBe(
      "https://vinklo.example/b/maria-y-jorge",
    );
  });

  it("keeps fee and application_fee_amount consistent for other amounts", () => {
    const fee = serviceFeeCents(30000); // 665
    const params = buildContributionCheckoutParams({
      ...BASE_INPUT,
      contributionCents: 30000,
      feeCents: fee,
    });

    expect(params.payment_intent_data?.application_fee_amount).toBe(665);
    const amounts = (params.line_items ?? []).map(
      (item) => item.price_data?.unit_amount ?? 0,
    );
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(totalChargeCents(30000));
  });
});

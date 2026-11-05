import { describe, expect, it } from "vitest";

import {
  buildPremiumCheckoutParams,
  PREMIUM_LAUNCH_LIMIT,
  PREMIUM_LAUNCH_PRICE_CENTS,
  PREMIUM_PRICE_CENTS,
} from "./premium";

const BASE_INPUT = {
  weddingId: "wed_123ABC",
  weddingSlug: "maria-y-jorge",
  appUrl: "https://vinklo.example",
};

describe("buildPremiumCheckoutParams", () => {
  it("charges the launch price (79€) when launch is true", () => {
    const params = buildPremiumCheckoutParams({ ...BASE_INPUT, launch: true });
    const items = params.line_items ?? [];

    expect(items).toHaveLength(1);
    expect(items[0]?.price_data?.unit_amount).toBe(PREMIUM_LAUNCH_PRICE_CENTS);
    expect(PREMIUM_LAUNCH_PRICE_CENTS).toBe(7900);
  });

  it("charges the normal price (99€) when launch is false", () => {
    const params = buildPremiumCheckoutParams({ ...BASE_INPUT, launch: false });
    const items = params.line_items ?? [];

    expect(items).toHaveLength(1);
    expect(items[0]?.price_data?.unit_amount).toBe(PREMIUM_PRICE_CENTS);
    expect(PREMIUM_PRICE_CENTS).toBe(9900);
  });

  it("exports the launch limit as 20", () => {
    expect(PREMIUM_LAUNCH_LIMIT).toBe(20);
  });

  it("is a single line item in EUR with the expected product copy", () => {
    const params = buildPremiumCheckoutParams({ ...BASE_INPUT, launch: true });
    const [item] = params.line_items ?? [];

    expect(item?.quantity).toBe(1);
    expect(item?.price_data?.currency).toBe("eur");
    expect(item?.price_data?.product_data?.name).toBe(
      "Premium Boda — vinklo",
    );
    expect(item?.price_data?.product_data?.description).toBe(
      "Pago único para toda la boda",
    );
  });

  it("mode is payment", () => {
    const params = buildPremiumCheckoutParams({ ...BASE_INPUT, launch: true });
    expect(params.mode).toBe("payment");
  });

  it("sets metadata.type and metadata.wedding_id on the session", () => {
    const params = buildPremiumCheckoutParams({ ...BASE_INPUT, launch: true });

    expect(params.metadata).toEqual({
      type: "premium",
      wedding_id: "wed_123ABC",
    });
  });

  it("mirrors the same metadata on payment_intent_data so both webhook event shapes resolve it", () => {
    const params = buildPremiumCheckoutParams({ ...BASE_INPUT, launch: false });

    expect(params.payment_intent_data?.metadata).toEqual({
      type: "premium",
      wedding_id: "wed_123ABC",
    });
  });

  it("builds success and cancel URLs from the app URL", () => {
    const params = buildPremiumCheckoutParams({ ...BASE_INPUT, launch: true });

    expect(params.success_url).toBe(
      "https://vinklo.example/panel?premium=ok&session_id={CHECKOUT_SESSION_ID}",
    );
    expect(params.cancel_url).toBe("https://vinklo.example/panel");
  });
});

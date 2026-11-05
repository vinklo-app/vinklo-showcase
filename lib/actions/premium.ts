"use server";

import { RSVP_MVP } from "@/lib/product-scope";

/**
 * Server action de la boda: alta de cobros Premium (checkout a la cuenta
 * PLATAFORMA de Stripe, no a la cuenta conectada de la pareja).
 */
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { buildPremiumCheckoutParams, PREMIUM_LAUNCH_LIMIT } from "@/lib/premium";

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
}

/**
 * Crea una Checkout Session de pago único para "Premium Boda" en la cuenta
 * de la plataforma (sin stripeAccount: NO es un destination charge). Precio
 * de lanzamiento (79 €) para las primeras PREMIUM_LAUNCH_LIMIT bodas
 * Premium; 99 € en adelante. Pensada como action de un <form> en /panel;
 * los fallos redirigen a /panel?premium=error.
 */
export async function startPremiumCheckout(): Promise<void> {
  if (RSVP_MVP) redirect("/panel");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: wedding } = await supabase
    .from("weddings")
    .select("id, slug, plan")
    .limit(1)
    .maybeSingle();

  if (!wedding) {
    redirect("/onboarding");
  }
  if (wedding.plan === "premium") {
    redirect("/panel");
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    redirect("/panel?premium=sin-claves");
  }

  const admin = createAdminClient();
  const { count, error: countError } = await admin
    .from("weddings")
    .select("id", { count: "exact", head: true })
    .eq("plan", "premium");
  if (countError) {
    redirect("/panel?premium=error");
  }
  const launch = (count ?? 0) < PREMIUM_LAUNCH_LIMIT;

  let checkoutUrl: string | null = null;
  try {
    const stripe = getStripe();
    const params = buildPremiumCheckoutParams({
      weddingId: wedding.id,
      weddingSlug: wedding.slug,
      appUrl: appUrl(),
      launch,
    });
    const session = await stripe.checkout.sessions.create(params);
    checkoutUrl = session.url;
  } catch {
    checkoutUrl = null;
  }

  if (!checkoutUrl) {
    redirect("/panel?premium=error");
  }
  redirect(checkoutUrl);
}

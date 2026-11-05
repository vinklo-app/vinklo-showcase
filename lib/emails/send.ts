/**
 * Thin Resend wrapper for transactional email.
 *
 * Graceful no-op when RESEND_API_KEY is missing (local dev, preview envs;
 * in production lib/env.ts also reports it to Sentry): logs a warning and returns { skipped: true } instead of throwing, so
 * callers (e.g. the Stripe webhook) never fail because email is unconfigured.
 */
import { Resend } from "resend";

import { checkEnv } from "@/lib/env";

/** Single place to change the sender identity. */
export const EMAIL_FROM = "vinklo <hola@vinklo.es>";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export type SendEmailResult =
  | { skipped: true }
  | { skipped: false; id: string | null };

let resendSingleton: Resend | null = null;

function getResend(apiKey: string): Resend {
  if (resendSingleton === null) {
    resendSingleton = new Resend(apiKey);
  }
  return resendSingleton;
}

/**
 * Sends one HTML email via Resend from EMAIL_FROM.
 *
 * - Missing RESEND_API_KEY → warn + { skipped: true } (never throws).
 * - Resend API error → throws, so callers can decide (webhook wraps each
 *   send in its own try/catch).
 */
export async function sendEmail({
  to,
  subject,
  html,
}: SendEmailInput): Promise<SendEmailResult> {
  // checkEnv avisa (console.error + Sentry, una vez por proceso) si en
  // producción falta RESEND_API_KEY: el salto ya no es silencioso.
  const apiKey = checkEnv().env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      `RESEND_API_KEY is not set — skipping email "${subject}" to ${to}.`,
    );
    return { skipped: true };
  }

  const { data, error } = await getResend(apiKey).emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Resend failed to send "${subject}": ${error.message}`);
  }

  return { skipped: false, id: data?.id ?? null };
}

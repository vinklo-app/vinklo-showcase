import * as Sentry from "@sentry/nextjs";

import { sentryBaseOptions } from "@/lib/observability/sentry-scrub";

Sentry.init({ dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN, ...sentryBaseOptions });

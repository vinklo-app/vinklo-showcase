import type { ReactNode } from "react";

import { InvitationRenderer } from "@/components/invitation/renderer";
import { demoCoverDocument } from "@/components/landing/demo-wedding";
import { FLIGHT_PALETTES } from "@/components/landing/flight-palettes";

/**
 * Portadas del móvil de «El vuelo», pintadas en el SERVIDOR (una por paleta):
 * así el cliente no arrastra el renderer ni el contrato (zod) a su bundle y
 * solo alterna cuál se ve. */

export function flightCovers(): Record<string, ReactNode> {
  return Object.fromEntries(
    FLIGHT_PALETTES.map((palette) => [palette, <InvitationRenderer key={palette} document={{ ...demoCoverDocument(), palette }} mode="preview" plan="free" />]),
  ) as Record<string, ReactNode>;
}


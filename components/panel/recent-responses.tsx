import type { RsvpStatus } from "@/lib/guests";

export interface RecentGuest {
  id: string;
  name: string;
  rsvp_status: RsvpStatus;
  rsvp_companions: number;
}

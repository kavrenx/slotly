import "server-only";
import { getDatabase } from "../../server/db/client";
import { getIdentityEnv } from "../../server/config/env";
import { getMailDelivery } from "../../server/mail/server";
import { handleGuestBooking } from "./http";

export function guestBookingRoute(request: Request, publicId: string, operation: "code" | "confirm") {
  const env = getIdentityEnv();
  return handleGuestBooking({ database: getDatabase(), secret: env.BETTER_AUTH_SECRET, sendMail: getMailDelivery().sendMail }, request, publicId, operation, env.APP_URL);
}

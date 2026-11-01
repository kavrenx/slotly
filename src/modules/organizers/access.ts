import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../server/db/schema";
import type { OrganizerAuth } from "../identity/auth";

export class AuthenticationRequired extends Error {}
export class IdentityUnavailable extends Error {}

export async function getOrganizerContext(auth: OrganizerAuth, database: NodePgDatabase<typeof schema>, headers: Headers) {
  try {
    const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!session?.user.emailVerified) throw new AuthenticationRequired();
    const [organizer] = await database.select({
      id: schema.organizers.id, displayName: schema.organizers.displayName,
    }).from(schema.organizers).where(eq(schema.organizers.userId, session.user.id)).limit(1);
    if (!organizer) throw new AuthenticationRequired();
    return { ...organizer, email: session.user.email };
  } catch (error) {
    if (error instanceof AuthenticationRequired) throw error;
    console.error("[identity] Не удалось проверить сессию; детали скрыты.");
    throw new IdentityUnavailable("Служба входа временно недоступна.");
  }
}

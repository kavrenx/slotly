import { eq } from "drizzle-orm";
import type { Transaction } from "../../server/db/types";
import { organizers } from "../../server/db/schema";
import { DomainError } from "../../shared/domain-error";

// Future booking writes must use this same lock, before reading the schedule.
export async function lockOrganizer(tx: Transaction, organizerId: string, mode: "update" | "share" = "update") {
  const [owner] = await tx.select({ id: organizers.id }).from(organizers).where(eq(organizers.id, organizerId)).for(mode);
  if (!owner) throw new DomainError("NOT_FOUND", 404);
}

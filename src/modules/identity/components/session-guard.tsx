"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../client";
import { identity as t } from "@/i18n/messages/ru/identity";

// The server authorizes every page and mutation. This only clears an already
// open view after expiry, focus revalidation or a sign-out in another tab.
export function SessionGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, isPending, error, refetch } = authClient.useSession();
  const invalid = !isPending && ((!data && !error) || error?.status === 401 || Boolean(data && !data.user.emailVerified));
  const expiresAt = data?.session.expiresAt ? new Date(data.session.expiresAt).getTime() : null;
  useEffect(() => {
    if (!invalid) return;
    router.replace("/login"); router.refresh();
  }, [invalid, router]);
  useEffect(() => {
    if (expiresAt === null || !Number.isFinite(expiresAt)) return;
    const timer = window.setTimeout(() => { void refetch(); }, Math.min(Math.max(expiresAt - Date.now() + 100, 0), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [expiresAt, refetch]);
  return invalid ? <p role="status" className="text-sm text-muted">{t.sessionEnded}</p> : children;
}

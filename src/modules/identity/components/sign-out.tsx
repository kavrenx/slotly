"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../client";

export function SignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div>
    <button disabled={pending} className="rounded-xl border border-line px-4 py-2 text-sm disabled:opacity-60" onClick={async () => {
      setPending(true); setFailed(false);
      try {
        const result = await authClient.signOut();
        if (result.error) { setFailed(true); return; }
        router.replace("/login"); router.refresh();
      } catch { setFailed(true); } finally { setPending(false); }
    }}>{pending ? "Выходим…" : "Выйти"}</button>
    {failed && <p role="alert" className="mt-2 text-sm text-red-900">Не удалось выйти. Попробуйте ещё раз.</p>}
  </div>;
}

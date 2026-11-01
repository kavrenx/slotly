"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, type ComponentProps } from "react";

// Next patches pushState to preserve its route tree. Native fragment navigation
// loses that state; Link hash navigation in 16.4.3 can reuse a hash-bearing cache
// URL. Use the supported History API for same-document section navigation.
export function SectionLink({ section, ...props }: Omit<ComponentProps<"a">, "href" | "onClick"> & { section: string }) {
  const pathname = usePathname(), search = useSearchParams().toString();
  useEffect(() => {
    let frame = 0;
    const restore = () => {
      if (window.location.hash !== `#${section}`) return;
      cancelAnimationFrame(frame);
      // Run after the restored page commits and Next finishes its own scrolling.
      frame = requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ behavior: "instant" }));
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("popstate", restore); };
  }, [pathname, section]);
  return <a {...props} href={`${pathname}${search ? `?${search}` : ""}#${section}`} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.currentTarget.target === "_blank") return;
    const target = document.getElementById(section);
    if (!target) return;
    event.preventDefault();
    const href = event.currentTarget.href;
    if (href !== window.location.href) window.history.pushState(null, "", href);
    target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    target.focus({ preventScroll: true });
  }} />;
}

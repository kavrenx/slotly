"use client";

import { useEffect, useRef, type RefObject } from "react";

type Motion = { x: number; y: number };
const neutral = (): Motion => ({ x: 0, y: 0 });

export function usePreviewTilt(wrapper: RefObject<HTMLDivElement | null>, card: RefObject<HTMLDivElement | null>) {
  const position = useRef(neutral());
  useEffect(() => {
    const surface = wrapper.current;
    const element = card.current;
    if (!surface || !element) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const fine = matchMedia("(hover: hover) and (pointer: fine)");
    let target = neutral();
    let frame = 0;
    let lastTime = 0;

    function paint() {
      const current = position.current;
      element!.style.setProperty("--tilt-x", `${current.x.toFixed(4)}deg`);
      element!.style.setProperty("--tilt-y", `${current.y.toFixed(4)}deg`);
    }
    function tick(time: number) {
      // Time-based damping stays equally soft on 60 Hz and high-refresh displays.
      const delta = lastTime ? Math.min(time - lastTime, 64) : 16;
      lastTime = time;
      const alpha = 1 - Math.exp(-delta / 170);
      let remaining = 0;
      for (const key of Object.keys(target) as (keyof Motion)[]) {
        position.current[key] += (target[key] - position.current[key]) * alpha;
        remaining = Math.max(remaining, Math.abs(target[key] - position.current[key]));
      }
      paint();
      if (remaining > 0.002) frame = requestAnimationFrame(tick);
      else { position.current = { ...target }; paint(); frame = 0; lastTime = 0; }
    }
    function animate() {
      if (!frame) frame = requestAnimationFrame(tick);
    }
    function leave() { target = neutral(); animate(); }
    function move(event: PointerEvent) {
      if (event.pointerType !== "mouse" || reduced.matches || !fine.matches) return;
      // Measure the stationary wrapper, never the tilted card; its edges cannot feed back into the motion.
      const rect = surface!.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      target = { x: (0.5 - y) * 3.6, y: (x - 0.5) * 4.8 };
      animate();
    }
    function preferenceChanged() {
      cancelAnimationFrame(frame); frame = 0; lastTime = 0;
      position.current = neutral(); target = neutral(); paint();
    }
    surface.addEventListener("pointermove", move, { passive: true });
    surface.addEventListener("pointerleave", leave);
    window.addEventListener("resize", leave);
    reduced.addEventListener("change", preferenceChanged);
    fine.addEventListener("change", preferenceChanged);
    if (Math.abs(position.current.x) + Math.abs(position.current.y) > 0) leave();
    return () => {
      cancelAnimationFrame(frame);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", leave);
      window.removeEventListener("resize", leave);
      reduced.removeEventListener("change", preferenceChanged);
      fine.removeEventListener("change", preferenceChanged);
    };
  }, [wrapper, card]);
}

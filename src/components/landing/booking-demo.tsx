"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { landing } from "@/i18n/messages/ru/landing";
import { Icon } from "./icon";

const DemoContext = createContext({ replay: 0, start: () => {} });

export function BookingDemo({ children }: { children: ReactNode }) {
  const [replay, setReplay] = useState(0);
  return <DemoContext.Provider value={{ replay, start: () => setReplay(value => value + 1) }}>{children}</DemoContext.Provider>;
}

export const useBookingDemo = () => useContext(DemoContext);

export function DemoButton() {
  const { start } = useBookingDemo();
  return <button type="button" onClick={start} className="landing-button landing-button-secondary"><Icon name="play" />{landing.demo}</button>;
}

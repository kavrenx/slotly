import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Slotly — Your time. Your rules.",
  description: "Бесплатный инструмент для организации времени и встреч. Slotly в разработке.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}

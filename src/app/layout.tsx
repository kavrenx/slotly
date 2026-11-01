import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Slotly — Your time. Your rules.",
  description: "Бесплатный инструмент для организации времени и встреч. Slotly в разработке.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Each document needs scripts bearing its own CSP nonce, including public pages.
  await connection();
  return <html lang="ru"><body>{children}</body></html>;
}

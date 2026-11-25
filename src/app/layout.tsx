import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Po drodze – planer postojów",
  description: "Podaj start i cel podróży samochodem, a zaproponujemy ciekawe postoje co kilka godzin jazdy – z priorytetem dla MOP-ów.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl">
      <body className="antialiased">{children}</body>
    </html>
  );
}

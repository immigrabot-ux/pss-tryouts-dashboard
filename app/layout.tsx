import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PSS Tryouts — Admin",
  description: "Peace Soccer School Fall 2026 tryouts management.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-pss-black text-white antialiased">
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Swiss Draw",
  description: "Swiss-system tournament operations console",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

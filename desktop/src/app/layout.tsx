import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./fonts.css";
import "./globals.css";
import "../styles/workspace-design.css";

export const metadata: Metadata = {
  title: "Noteriv",
  description: "A modern markdown editor",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

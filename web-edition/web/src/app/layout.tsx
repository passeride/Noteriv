import type { Metadata, Viewport } from "next";
import "@noteriv/ui/styles/katex.css";
import "./globals.css";
import ErrorReporting from "@/components/ErrorReporting";
import LocaleSync from "@/components/LocaleSync";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { DEFAULT_LOCALE, LOCALE_BOOT_SCRIPT } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Noteriv",
  description: "Noteriv — modern markdown notes, in your browser",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  // iOS "Add to Home Screen": open full screen, with the app's own name under the icon.
  appleWebApp: { capable: true, title: "Noteriv", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1e1e2e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The server renders the default language; the head script sets `lang` (and holds the paint) when the browser or
  // the user's choice says otherwise, hence suppressHydrationWarning. The i18n module keeps `lang` up to date after.
  return (
    <html lang={DEFAULT_LOCALE} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOCALE_BOOT_SCRIPT }} />
      </head>
      <body>
        <LocaleSync />
        <ErrorReporting />
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}

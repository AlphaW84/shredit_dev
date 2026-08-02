import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getRequestLocale } from "@/lib/request-locale";
import { getRequestTheme } from "@/lib/request-theme";
import { ThemeProvider } from "@/lib/theme-provider";

export const metadata: Metadata = {
  title: "Shredit - Read once. Shred forever.",
  description: "Encrypted one-time plaintext notes. No account required.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon", sizes: "16x16 32x32" },
      { url: "/shredit-mark.svg", type: "image/svg+xml", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      {
        url: "/icons/shredit-180.png",
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  initialScale: 1,
  viewportFit: "cover",
  width: "device-width",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [locale, theme] = await Promise.all([
    getRequestLocale(),
    getRequestTheme(),
  ]);
  return (
    <html lang={locale} data-theme={theme}>
      <body>
        <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getRequestLocale } from "@/lib/request-locale";
import { getRequestTheme } from "@/lib/request-theme";
import { ThemeProvider } from "@/lib/theme-provider";

export const metadata: Metadata = {
  title: "Shredit - Read once. Shred forever.",
  description: "Encrypted one-time plaintext notes. No account required.",
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

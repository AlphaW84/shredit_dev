"use client";

import { OpenNoteGate, ShreditShell, TorLink } from "@/components/shredit-ui";
import { Locale } from "@/lib/messages";
import type { PublicRuntimeConfig } from "@/lib/public-config";
import { useLocale } from "@/lib/use-locale";

export default function NotePageClient({
  publicConfig,
  initialLocale,
}: {
  publicConfig: PublicRuntimeConfig;
  initialLocale: Locale;
}) {
  const [locale, setLocale] = useLocale(initialLocale);
  return (
    <ShreditShell
      locale={locale}
      onLocaleChange={setLocale}
      publicConfig={publicConfig}
    >
      <main id="main-content" className="app-stage note-stage" tabIndex={-1}>
        <OpenNoteGate locale={locale} />
        <TorLink locale={locale} onionUrl={publicConfig.onionUrl} />
      </main>
    </ShreditShell>
  );
}

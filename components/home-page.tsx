"use client";

import { Locale } from "@/lib/messages";
import type { PublicRuntimeConfig } from "@/lib/public-config";
import { NoteComposer, ShreditShell, TorLink } from "@/components/shredit-ui";
import { useLocale } from "@/lib/use-locale";

export default function HomePage({
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
      <main id="main-content" className="app-stage" tabIndex={-1}>
        <NoteComposer locale={locale} publicConfig={publicConfig} />
        <TorLink locale={locale} onionUrl={publicConfig.onionUrl} />
      </main>
    </ShreditShell>
  );
}

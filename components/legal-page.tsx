"use client";

import { Locale, messages } from "@/lib/messages";
import type { PublicRuntimeConfig } from "@/lib/public-config";
import { ShreditShell } from "@/components/shredit-ui";
import { useLocale } from "@/lib/use-locale";

type Kind = keyof (typeof messages)["en"]["legal"];

export default function LegalPage({
  kind,
  publicConfig,
  initialLocale,
}: {
  kind: Kind;
  publicConfig: PublicRuntimeConfig;
  initialLocale: Locale;
}) {
  const [locale, setLocale] = useLocale(initialLocale);
  const data = messages[locale].legal[kind];
  const contact =
    kind === "abuse"
      ? publicConfig.abuseContact
      : kind === "security"
        ? publicConfig.securityContact
        : undefined;
  return (
    <ShreditShell
      locale={locale}
      onLocaleChange={setLocale}
      publicConfig={publicConfig}
    >
      <main id="main-content" className="legal-layout" tabIndex={-1}>
        <article className="legal-content">
          <div className="workspace-bar">
            <div className="workspace-bar-group">
              <span className="workspace-label">Shredit</span>
              <span className="workspace-divider" aria-hidden="true" />
              <span>{data.title}</span>
            </div>
          </div>
          <div className="legal-document">
            <p className="section-kicker">Shredit / {data.title}</p>
            <h1>{data.title}</h1>
            <p className="legal-intro">{data.intro}</p>
            {contact && (
              <p className="legal-public-contact">
                <a href={contact}>{contact}</a>
              </p>
            )}
            {data.sections.map(([heading, body], index) => (
              <section key={heading}>
                <span className="legal-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2>{heading}</h2>
                  <p>{body}</p>
                </div>
              </section>
            ))}
          </div>
        </article>
      </main>
    </ShreditShell>
  );
}

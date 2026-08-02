import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BuildInfoFooter,
  CreateResult,
  ExpirySelect,
  GeneratedPasswordField,
  NoteComposer,
  NoteViewer,
  UnavailableNoteState,
  OpenNoteGate,
  ShreditShell,
} from "@/components/shredit-ui";
import { messages } from "@/lib/messages";
import { ThemeProvider } from "@/lib/theme-provider";

const globalStyles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

function assertSameShape(left: unknown, right: unknown, path = "messages") {
  expect(typeof right, path).toBe(typeof left);
  if (Array.isArray(left)) {
    expect(Array.isArray(right), path).toBe(true);
    expect((right as unknown[]).length, path).toBe(left.length);
    left.forEach((value, index) =>
      assertSameShape(value, (right as unknown[])[index], `${path}[${index}]`),
    );
    return;
  }
  if (!left || typeof left !== "object") return;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  expect(Object.keys(rightRecord).sort(), path).toEqual(
    Object.keys(leftRecord).sort(),
  );
  for (const key of Object.keys(leftRecord))
    assertSameShape(leftRecord[key], rightRecord[key], `${path}.${key}`);
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(collectStrings);
  return [];
}

describe("UI localization contract", () => {
  it("keeps EN and zh-CN message structures in sync without Russian UI copy", () => {
    assertSameShape(messages.en, messages["zh-CN"]);
    expect(collectStrings(messages).join("\n")).not.toMatch(/[А-Яа-яЁё]/u);
    expect(messages["zh-CN"].homeTitle).not.toBe(messages.en.homeTitle);
    expect(messages["zh-CN"].legal.privacy.title).toBe("隐私");
  });

  it("uses typographic ellipses instead of ASCII three dots in UI messages", () => {
    expect(collectStrings(messages).join("\n")).not.toContain("...");
  });

  it("renders the five localized expiry choices through ExpirySelect", () => {
    const markup = renderToStaticMarkup(
      <ExpirySelect locale="zh-CN" value="7d" onChange={() => undefined} />,
    );
    expect((markup.match(/role="radio"/g) ?? []).length).toBe(5);
    expect(markup).toContain('aria-label="1 小时"');
    expect(markup).toContain('aria-label="7 天"');
    expect(markup).toContain('aria-label="永不过期"');
  });

  it("keeps the footer wordmark visible while hiding only repository metadata", () => {
    expect(typeof ExpirySelect).toBe("function");
    expect(typeof GeneratedPasswordField).toBe("function");
    const publicConfig = {
      clearnetUrl: "https://shredit.dev",
      commit: "abcdef0",
      repositoryUrl: "",
      securityContact: "mailto:security@shredit.dev",
      abuseContact: "mailto:abuse@shredit.dev",
    };
    const markupWithoutRepository = renderToStaticMarkup(
      <BuildInfoFooter locale="en" publicConfig={publicConfig} />,
    );
    const longCommit = "a".repeat(64);
    const markupWithRepository = renderToStaticMarkup(
      <BuildInfoFooter
        locale="en"
        publicConfig={{
          ...publicConfig,
          commit: longCommit,
          repositoryUrl: "https://example.com/shredit",
        }}
      />,
    );

    expect(markupWithoutRepository).toContain(
      '<span class="brand-wordmark">shredit',
    );
    expect(markupWithoutRepository).not.toContain("footer-version");
    expect(markupWithoutRepository).not.toContain("View source");
    expect(markupWithoutRepository).not.toContain("/commit/");
    expect(markupWithoutRepository).toContain("Privacy");
    expect(markupWithRepository).toContain('class="footer-version"');
    expect(markupWithRepository).toContain(longCommit);
    expect(markupWithRepository).toContain(
      `href="https://example.com/shredit/commit/${longCommit}"`,
    );
    expect(markupWithRepository).toContain(
      `aria-label="Current commit: ${longCommit}"`,
    );
    expect(markupWithRepository).toContain(`title="${longCommit}"`);
    expect(markupWithRepository).toContain(`>${longCommit.slice(0, 12)}</a>`);
    expect(markupWithRepository).not.toContain(`>${longCommit}</a>`);
    expect(globalStyles).not.toContain(".footer-brand > span:last-child");
    expect(globalStyles).toMatch(
      /\.footer-version\s*\{[^}]*display:\s*none;/su,
    );
    expect(globalStyles).toMatch(
      /\.footer-meta a\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;/su,
    );
    expect(globalStyles).toMatch(
      /\.footer-meta a\s*\{[^}]*min-height:\s*var\(--control-height\);[^}]*justify-content:\s*center;/su,
    );
  });

  it("renders the localized OpenNoteGate loading status with a pending tone", () => {
    const markup = renderToStaticMarkup(<OpenNoteGate locale="zh-CN" />);
    const workspaceBar = markup.match(
      /<div class="workspace-bar">([\s\S]*?)<div class="lifecycle-content/,
    )?.[1];

    expect(workspaceBar).toBeDefined();
    expect(workspaceBar).toContain('class="status-dot pending"');
    expect(workspaceBar).toContain(messages["zh-CN"].checking);
    expect(workspaceBar).not.toContain(messages["zh-CN"].readyBody);
  });

  it("does not add a redundant tab stop to the note viewer", () => {
    const markup = renderToStaticMarkup(
      <NoteViewer locale="en" text="One-time note" />,
    );

    expect(markup).toContain('<div class="note-viewer">One-time note</div>');
    expect(markup).not.toMatch(/class="note-viewer"[^>]*tabindex=/u);
  });

  it("keeps note lifecycle states on the shared panel frame", () => {
    const states = [
      renderToStaticMarkup(<OpenNoteGate locale="en" />),
      renderToStaticMarkup(<UnavailableNoteState locale="en" />),
      renderToStaticMarkup(<NoteViewer locale="en" text="One-time note" />),
    ];

    for (const markup of states) {
      expect(markup).toMatch(
        /<section class="task-panel lifecycle-panel[^>]*>/u,
      );
      expect(markup).toMatch(/class="workspace-bar(?:\s[^"]*)?"/u);
      expect(markup).toContain('class="workspace-privacy"');
    }

    expect(globalStyles).toMatch(
      /\.lifecycle-panel \.workspace-bar\s*\{[^}]*min-height:\s*44px;/su,
    );
    expect(globalStyles).toMatch(
      /\.lifecycle-panel \.lifecycle-content,[\s\S]*?\.lifecycle-panel \.viewer-content\s*\{[^}]*min-height:\s*max\(456px,\s*calc\(100svh - 238px\)\);/su,
    );
  });

  it("keeps legal routes on the shared desktop shell rhythm", () => {
    expect(globalStyles).toMatch(
      /@media \(min-width: 901px\) \{\s*\.app-stage,\s*\.legal-layout\s*\{[^}]*padding-top:\s*var\(--space-4\);[^}]*padding-bottom:\s*var\(--space-2\);/su,
    );
    expect(globalStyles).toMatch(/\.legal-content\s*\{\s*max-width:\s*none;/su);
    expect(globalStyles).toMatch(
      /\.legal-content section p\s*\{[^}]*max-width:\s*720px;/su,
    );
  });

  it("renders the create controls in the frozen product order with a conditional password field", () => {
    const markup = renderToStaticMarkup(
      <NoteComposer
        locale="en"
        publicConfig={{
          clearnetUrl: "https://shredit.dev",
          onionUrl: "http://example.onion",
          commit: "abcdef0",
          repositoryUrl: "",
          securityContact: "mailto:security@shredit.dev",
          abuseContact: "mailto:abuse@shredit.dev",
        }}
      />,
    );
    const orderedMarkers = [
      "Read once. Shred forever.",
      "Checking browser encryption…",
      "<textarea",
      "Expiration",
      "Protect with a password",
      "anti-abuse-slot",
      "Create note",
      "Anonymous by design.*",
      "Using the onion mirror through Tor",
    ];
    let cursor = -1;
    for (const marker of orderedMarkers) {
      const next = markup.indexOf(marker, cursor + 1);
      expect(next, marker).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(markup).not.toContain('id="note-password"');
  });

  it("renders distinct clearnet/onion links and an expiry confirmation", () => {
    const markup = renderToStaticMarkup(
      <CreateResult
        locale="en"
        result={{
          clearnetLink: "https://shredit.dev/n/example#v1.key",
          onionLink: "http://example.onion/n/example#v1.key",
          expiresAt: "2026-08-02T12:00:00.000Z",
        }}
        onCreateAnother={() => undefined}
      />,
    );
    expect(markup).toContain("Clearnet link");
    expect(markup).toContain("Onion link");
    expect(markup).toContain("Both links open the same note");
    expect(markup).toContain("Expires");
  });

  it("keeps the ready state on the composer's shared workspace frame", () => {
    const markup = renderToStaticMarkup(
      <CreateResult
        locale="en"
        result={{
          clearnetLink: "https://shredit.dev/n/example#v1.key",
          expiresAt: null,
        }}
        onCreateAnother={() => undefined}
      />,
    );
    const rail = markup.match(
      /<aside class="workspace-rail result-rail">([\s\S]*?)<\/aside>/u,
    )?.[1];

    expect(markup).toContain('class="workspace-main"');
    expect(markup).toContain('class="workspace-privacy"');
    expect(rail).toBeDefined();
    expect(rail).toContain('class="rail-section result-summary"');
    expect(rail).toContain('class="rail-section result-caution"');
    expect(rail).toContain('class="rail-action result-actions"');
    expect(rail).not.toContain("result-action-section");
    expect(globalStyles).toContain("scrollbar-gutter: stable;");
    expect(globalStyles).toMatch(
      /\.composer-panel,\s*\.result-panel\s*\{[\s\S]*?min-height:\s*640px;/u,
    );
  });

  it("keeps the slogan and Tor link without duplicating the workspace privacy boundary", () => {
    const publicConfig = {
      clearnetUrl: "https://shredit.dev",
      onionUrl: "http://example.onion",
      commit: "abcdef0",
      repositoryUrl: "https://example.com/shredit",
      securityContact: "mailto:security@shredit.dev",
      abuseContact: "mailto:abuse@shredit.dev",
    };
    const markup = renderToStaticMarkup(
      <ShreditShell
        locale="en"
        onLocaleChange={() => undefined}
        publicConfig={publicConfig}
      >
        <main>Task</main>
      </ShreditShell>,
    );
    expect(markup).toContain("Read once. Shred forever.");
    expect(markup).toContain('class="brand-symbol"');
    expect(markup).toContain('src="/shredit-mark.svg"');
    expect(markup).toContain("Tor mirror");
    expect(markup).not.toContain("advanced traffic correlation");
  });

  it("renders a localized skip link to the main content", () => {
    const publicConfig = {
      clearnetUrl: "https://shredit.dev",
      commit: "abcdef0",
      repositoryUrl: "",
      securityContact: "mailto:security@shredit.dev",
      abuseContact: "mailto:abuse@shredit.dev",
    };
    const renderShell = (locale: "en" | "zh-CN") =>
      renderToStaticMarkup(
        <ShreditShell
          locale={locale}
          onLocaleChange={() => undefined}
          publicConfig={publicConfig}
        >
          <main id="main-content">Task</main>
        </ShreditShell>,
      );
    const englishMarkup = renderShell("en");
    const chineseMarkup = renderShell("zh-CN");
    const skipText = (markup: string) =>
      markup.match(
        /<a class="skip-link" href="#main-content">([^<]+)<\/a>/u,
      )?.[1];

    expect(skipText(englishMarkup)).toBeTruthy();
    expect(skipText(chineseMarkup)).toBeTruthy();
    expect(skipText(englishMarkup)).not.toBe(skipText(chineseMarkup));
    expect(skipText(chineseMarkup)).toMatch(/\p{Script=Han}/u);
  });

  it("renders a localized theme toggle for both theme states", () => {
    const publicConfig = {
      clearnetUrl: "https://shredit.dev",
      commit: "abcdef0",
      repositoryUrl: "",
      securityContact: "mailto:security@shredit.dev",
      abuseContact: "mailto:abuse@shredit.dev",
    };
    const renderTheme = (theme: "dark" | "light", locale: "en" | "zh-CN") =>
      renderToStaticMarkup(
        <ThemeProvider initialTheme={theme}>
          <ShreditShell
            locale={locale}
            onLocaleChange={() => undefined}
            publicConfig={publicConfig}
          >
            <main>Task</main>
          </ShreditShell>
        </ThemeProvider>,
      );

    expect(renderTheme("dark", "en")).toContain(
      'role="switch" aria-label="Light theme" aria-checked="false"',
    );
    expect(renderTheme("dark", "en")).toContain('title="Use light theme"');
    expect(renderTheme("light", "en")).toContain('aria-checked="true"');
    expect(renderTheme("light", "en")).toContain('title="Use dark theme"');
    expect(renderTheme("dark", "zh-CN")).toContain(
      `aria-label="${messages["zh-CN"].themeLabel}"`,
    );
  });

  it("keeps theme-specific focus and theme-toggle colors on their owners", () => {
    expect(globalStyles).toMatch(
      /\.skip-link\s*\{[^}]*color:\s*var\(--color-focus-text\)/su,
    );
    expect(globalStyles).toMatch(
      /\.icon-button\.theme-toggle\s*\{[^}]*color:\s*var\(--theme-toggle-icon\)/su,
    );
  });
});

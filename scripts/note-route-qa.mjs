import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.TARGET_URL ?? "http://127.0.0.1:3232";
const evidenceDir = path.resolve(
  "_codex/evidence/precision-split/note-route-qa",
);
const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
];
const locales = ["en", "zh-CN"];
const analyticsPattern =
  /google-analytics\.com|googletagmanager\.com|mc\.yandex\.(?:ru|com)|yastatic\.net\/s3\/metrika/iu;

function fileName(locale, viewport, state) {
  return `${state}-${locale}-${viewport.width}x${viewport.height}.png`;
}

function redactUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname
    .replace(/^\/n\/[^/]+/u, "/n/[redacted]")
    .replace(/^\/api\/v1\/notes\/[^/]+/u, "/api/v1/notes/[redacted]");
  return `${url.origin}${url.pathname}`;
}

async function readFrame(page, state) {
  return page.evaluate((currentState) => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        top: Number(box.top.toFixed(2)),
        right: Number(box.right.toFixed(2)),
        bottom: Number(box.bottom.toFixed(2)),
        left: Number(box.left.toFixed(2)),
        width: Number(box.width.toFixed(2)),
        height: Number(box.height.toFixed(2)),
      };
    };
    const panel = document.querySelector(".task-panel");
    return {
      state: currentState,
      theme: document.documentElement.dataset.theme,
      heading: document.querySelector(".task-panel h1")?.textContent ?? null,
      panelClass: panel?.className ?? null,
      selectors: {
        panel: rect(".task-panel"),
        bar: rect(".workspace-bar"),
        content: rect(".lifecycle-content, .viewer-content"),
        actions: rect(".viewer-actions"),
        privacy: rect(".workspace-privacy"),
        footer: rect(".site-footer"),
      },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      },
    };
  }, state);
}

function frameFailures(frame, viewport, diagnostics) {
  const failures = [];
  if (!frame.panelClass?.split(/\s+/u).includes("lifecycle-panel"))
    failures.push("panel is missing lifecycle-panel");
  for (const key of ["panel", "bar", "content", "privacy"]) {
    if (!frame.selectors[key]) failures.push(`${key}: missing`);
  }
  if (frame.document.scrollWidth > frame.document.clientWidth)
    failures.push(
      `horizontal overflow: ${frame.document.scrollWidth} > ${frame.document.clientWidth}`,
    );
  if (
    viewport.width >= 901 &&
    frame.document.scrollHeight > frame.document.clientHeight
  )
    failures.push(
      `desktop/tablet vertical overflow: ${frame.document.scrollHeight} > ${frame.document.clientHeight}`,
    );
  if (diagnostics.consoleErrors.length)
    failures.push(`console errors: ${diagnostics.consoleErrors.length}`);
  if (diagnostics.pageErrors.length)
    failures.push(`page errors: ${diagnostics.pageErrors.length}`);
  if (diagnostics.failedRequests.length)
    failures.push(`failed requests: ${diagnostics.failedRequests.length}`);
  if (diagnostics.analyticsCompleted.length)
    failures.push(
      `completed analytics requests: ${diagnostics.analyticsCompleted.length}`,
    );
  return failures;
}

function nearlyEqual(left, right, tolerance = 1) {
  return Math.abs(left - right) <= tolerance;
}

function compareRect(reference, current, selector, properties, label) {
  const failures = [];
  const left = reference.selectors[selector];
  const right = current.selectors[selector];
  if (!left || !right) return [`${label}.${selector}: missing`];
  for (const property of properties) {
    if (!nearlyEqual(left[property], right[property]))
      failures.push(
        `${label}.${selector}.${property}: ${left[property]} != ${right[property]}`,
      );
  }
  return failures;
}

function continuityFailures(report) {
  const failures = [];
  for (const locale of locales) {
    for (const viewport of viewports) {
      const matching = (kind) =>
        report.cases.find(
          (item) =>
            item.kind === kind &&
            item.locale === locale &&
            item.viewport.width === viewport.width,
        );
      const unavailable = matching("unavailable")?.frame;
      const gate = matching("gate")?.frame;
      const viewer = matching("viewer")?.frame;
      const compose = report.baselines.find(
        (item) =>
          item.locale === locale && item.viewport.width === viewport.width,
      )?.frame;
      const group = `${locale}-${viewport.width}x${viewport.height}`;
      if (!unavailable || !gate || !viewer || !compose) {
        failures.push(`${group}: incomplete frame family`);
        continue;
      }

      for (const [state, frame] of [
        ["gate", gate],
        ["viewer", viewer],
      ]) {
        for (const selector of ["panel", "bar", "privacy", "footer"]) {
          failures.push(
            ...compareRect(
              unavailable,
              frame,
              selector,
              ["top", "right", "bottom", "left", "width", "height"],
              `${group}.${state}`,
            ),
          );
        }
      }

      for (const selector of ["panel", "bar", "privacy", "footer"]) {
        const properties =
          selector === "bar"
            ? ["top", "bottom", "left", "height"]
            : ["right", "left", "width", "height"];
        if (viewport.width < 901 && selector === "panel")
          properties.splice(properties.indexOf("height"), 1);
        if (viewport.width >= 901 && selector !== "bar")
          properties.push("top", "bottom");
        failures.push(
          ...compareRect(
            compose,
            unavailable,
            selector,
            properties,
            `${group}.compose-to-note`,
          ),
        );
      }
    }
  }
  return failures;
}

async function createContext(browser, viewport, locale, diagnostics) {
  const context = await browser.newContext({
    viewport,
    locale,
    serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    window.__PLAYWRIGHT_QA__ = true;
  });
  context.on("response", (response) => {
    if (analyticsPattern.test(response.url()))
      diagnostics.analyticsCompleted.push(redactUrl(response.url()));
  });
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (analyticsPattern.test(url)) {
      diagnostics.analytics.push(redactUrl(url));
      await route.abort("blockedbyclient");
      return;
    }
    if (new URL(url).hostname !== "127.0.0.1") {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return context;
}

function attachDiagnostics(page, diagnostics) {
  page.on("console", (message) => {
    if (message.type() === "error")
      diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (!analyticsPattern.test(request.url())) {
      diagnostics.failedRequests.push({
        url: redactUrl(request.url()),
        error: request.failure()?.errorText,
      });
    }
  });
}

async function runUnavailable(browser, viewport, locale, report) {
  const diagnostics = {
    analytics: [],
    analyticsCompleted: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
  };
  const context = await createContext(browser, viewport, locale, diagnostics);
  try {
    const page = await context.newPage();
    attachDiagnostics(page, diagnostics);
    await page.goto(`${baseUrl}/n/does-not-exist-${locale}`, {
      waitUntil: "networkidle",
    });
    await page.locator(".unavailable-panel").waitFor({ timeout: 30000 });
    const frame = await readFrame(page, "unavailable");
    await page.screenshot({
      path: path.join(evidenceDir, fileName(locale, viewport, "unavailable")),
      fullPage: true,
    });
    report.cases.push({
      kind: "unavailable",
      locale,
      viewport,
      frame,
      diagnostics,
      failures: frameFailures(frame, viewport, diagnostics),
    });
  } finally {
    await context.close();
  }
}

async function runRealNote(browser, viewport, locale, report) {
  const diagnostics = {
    analytics: [],
    analyticsCompleted: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
  };
  const context = await createContext(browser, viewport, locale, diagnostics);
  try {
    const page = await context.newPage();
    attachDiagnostics(page, diagnostics);
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await page
      .locator(
        ".anti-abuse-ready, .turnstile-widget, .anti-abuse-slot .notice-error",
      )
      .first()
      .waitFor({ timeout: 30000 });
    report.baselines.push({
      locale,
      viewport,
      frame: await readFrame(page, "compose"),
    });
    await page
      .locator("#note-text")
      .fill(`Route QA ${locale} ${viewport.width}`);
    await page
      .locator('.composer-form button.primary-button[type="submit"]')
      .click();
    await page.locator("#result-title").waitFor({ timeout: 90000 });
    const noteUrl = await page
      .locator(".result-actions a")
      .getAttribute("href");
    if (!noteUrl) throw new Error("result link was not rendered");

    await page.goto(noteUrl, { waitUntil: "networkidle" });
    await page.locator(".gate-panel").waitFor({ timeout: 30000 });
    await page
      .locator(".gate-form button.primary-button:not(:disabled)")
      .waitFor({
        timeout: 30000,
      });
    const gateFrame = await readFrame(page, "gate-ready");
    await page.screenshot({
      path: path.join(evidenceDir, fileName(locale, viewport, "gate")),
      fullPage: true,
    });
    report.cases.push({
      kind: "gate",
      locale,
      viewport,
      frame: gateFrame,
      diagnostics,
      failures: frameFailures(gateFrame, viewport, diagnostics),
    });

    await page
      .locator(".gate-form button.primary-button:not(:disabled)")
      .click();
    await page.locator("#viewer-title").waitFor({ timeout: 30000 });
    const viewerFrame = await readFrame(page, "viewer");
    const viewerText = await page.locator(".note-viewer").textContent();
    await page.screenshot({
      path: path.join(evidenceDir, fileName(locale, viewport, "viewer")),
      fullPage: true,
    });
    report.cases.push({
      kind: "viewer",
      locale,
      viewport,
      frame: viewerFrame,
      viewerText,
      diagnostics,
      failures: [
        ...frameFailures(viewerFrame, viewport, diagnostics),
        viewerText?.includes(`Route QA ${locale} ${viewport.width}`)
          ? null
          : "viewer text did not round-trip",
      ].filter(Boolean),
    });
  } finally {
    await context.close();
  }
}

fs.mkdirSync(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = {
  status: "MEASURED",
  target: baseUrl,
  baselines: [],
  cases: [],
  continuityFailures: [],
};
try {
  for (const locale of locales) {
    for (const viewport of viewports) {
      await runUnavailable(browser, viewport, locale, report);
      await runRealNote(browser, viewport, locale, report);
    }
  }
} finally {
  await browser.close();
}

report.continuityFailures = continuityFailures(report);
report.status =
  report.cases.some((item) => item.failures.length) ||
  report.continuityFailures.length
    ? "FAIL"
    : "PASS";
fs.writeFileSync(
  path.join(evidenceDir, "note-route-matrix.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
if (report.status !== "PASS") process.exitCode = 1;

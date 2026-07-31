import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.TARGET_URL ?? "http://127.0.0.1:3232";
const evidenceDir = path.resolve(
  "_codex/evidence/precision-split/state-continuity",
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

function readLayout(page, state) {
  return page.evaluate((currentState) => {
    const selectors = [
      ".site-header",
      ".app-stage",
      ".task-panel",
      ".workspace-main",
      ".workspace-bar",
      ".composer-main, .result-main",
      ".editor-area, .result-content",
      ".workspace-rail",
      ".rail-section",
      ".rail-feedback",
      ".rail-action",
      ".workspace-privacy",
      ".site-footer",
    ];
    const rect = (element) => {
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
    const grouped = (selector) =>
      [...document.querySelectorAll(selector)].map(rect);
    const content = document.querySelector(".editor-area, .result-content");
    const bar = document.querySelector(".workspace-bar");
    const privacy = document.querySelector(".workspace-privacy");
    const style = (element) => {
      if (!element) return null;
      const computed = getComputedStyle(element);
      return {
        paddingTop: computed.paddingTop,
        paddingRight: computed.paddingRight,
        paddingBottom: computed.paddingBottom,
        paddingLeft: computed.paddingLeft,
        minHeight: computed.minHeight,
      };
    };
    return {
      state: currentState,
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      },
      styles: {
        content: style(content),
        bar: style(bar),
        privacy: style(privacy),
      },
      selectors: Object.fromEntries(
        selectors.map((selector) => [selector, grouped(selector)]),
      ),
      theme: document.documentElement.dataset.theme,
    };
  }, state);
}

function nearlyEqual(left, right, tolerance = 1) {
  return Math.abs(left - right) <= tolerance;
}

function compareFrame(compose, result, viewport) {
  const failures = [];
  const sharedSelectors = [
    ".site-header",
    ".app-stage",
    ".workspace-main",
    ".workspace-bar",
    ".composer-main, .result-main",
    ".editor-area, .result-content",
    ".workspace-rail",
    ".workspace-privacy",
    ".site-footer",
  ];
  for (const selector of sharedSelectors) {
    const left = compose.selectors[selector][0];
    const right = result.selectors[selector][0];
    if (!left || !right) {
      failures.push(`${selector}: missing frame`);
      continue;
    }
    for (const edge of ["left", "right", "width"]) {
      if (!nearlyEqual(left[edge], right[edge]))
        failures.push(`${selector}.${edge}: ${left[edge]} != ${right[edge]}`);
    }
    if (viewport.width >= 901 || selector === ".workspace-bar") {
      if (!nearlyEqual(left.height, right.height))
        failures.push(`${selector}.height: ${left.height} != ${right.height}`);
    }
  }
  for (const key of ["content", "bar", "privacy"]) {
    const left = compose.styles[key];
    const right = result.styles[key];
    for (const side of [
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
    ]) {
      if (left[side] !== right[side])
        failures.push(`styles.${key}.${side}: ${left[side]} != ${right[side]}`);
    }
  }
  const composeAction = compose.selectors[".rail-action"][0];
  const resultAction = result.selectors[".rail-action"][0];
  if (
    composeAction &&
    resultAction &&
    !nearlyEqual(composeAction.height, resultAction.height)
  )
    failures.push(
      `rail-action.height: ${composeAction.height} != ${resultAction.height}`,
    );
  if (
    viewport.width >= 901 &&
    result.document.scrollHeight > result.document.clientHeight
  )
    failures.push(
      `vertical overflow: ${result.document.scrollHeight} > ${result.document.clientHeight}`,
    );
  if (result.document.scrollWidth > result.document.clientWidth)
    failures.push(
      `horizontal overflow: ${result.document.scrollWidth} > ${result.document.clientWidth}`,
    );
  return failures;
}

fs.mkdirSync(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { status: "MEASURED", target: baseUrl, cases: [] };
try {
  for (const locale of locales) {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport,
        locale,
        serviceWorkers: "block",
      });
      const analytics = [];
      await context.addInitScript(() => {
        window.__PLAYWRIGHT_QA__ = true;
      });
      await context.route("**/*", async (route) => {
        const url = route.request().url();
        if (analyticsPattern.test(url)) {
          analytics.push(url);
          await route.abort("blockedbyclient");
          return;
        }
        if (new URL(url).hostname !== "127.0.0.1") {
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      });
      const page = await context.newPage();
      const diagnostics = {
        consoleErrors: [],
        pageErrors: [],
        failedRequests: [],
      };
      page.on("console", (message) => {
        if (message.type() === "error")
          diagnostics.consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) =>
        diagnostics.pageErrors.push(error.message),
      );
      page.on("requestfailed", (request) => {
        if (!analyticsPattern.test(request.url()))
          diagnostics.failedRequests.push({
            url: request.url(),
            error: request.failure()?.errorText,
          });
      });
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
      await page.waitForSelector(
        ".anti-abuse-ready, .turnstile-widget, .anti-abuse-slot .notice-error",
      );
      const compose = await readLayout(page, "compose");
      await page.screenshot({
        path: path.join(
          evidenceDir,
          `compose-${locale}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
      });
      await page
        .locator("#note-text")
        .fill(`State continuity ${locale} ${viewport.width}`);
      await page
        .locator('.composer-form button.primary-button[type="submit"]')
        .click();
      await page
        .locator("#result-title")
        .waitFor({ state: "visible", timeout: 90000 });
      const result = await readLayout(page, "result");
      await page.screenshot({
        path: path.join(
          evidenceDir,
          `result-${locale}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
      });
      report.cases.push({
        locale,
        viewport,
        compose,
        result,
        analytics,
        diagnostics,
        failures: compareFrame(compose, result, viewport),
      });
      await context.close();
    }
  }
} finally {
  await browser.close();
}

report.status = report.cases.some((item) => item.failures.length)
  ? "FAIL"
  : "PASS";
fs.writeFileSync(
  path.join(evidenceDir, "state-continuity-matrix.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
if (report.status !== "PASS") process.exitCode = 1;

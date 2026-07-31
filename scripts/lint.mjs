import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignored = new Set(["node_modules", ".next", ".git", "_codex", "scripts"]);
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".css"]);
const forbiddenClaims = [
  "Absolutely anonymous",
  "zero trace",
  "unbreakable",
  "guaranteed privacy",
  "independent audit completed",
];
const findings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (extensions.has(path.extname(entry.name).toLowerCase())) {
      const source = fs.readFileSync(absolute, "utf8");
      for (const claim of forbiddenClaims)
        if (source.includes(claim))
          findings.push(
            `${path.relative(root, absolute)} contains forbidden claim: ${claim}`,
          );
      if (/console\.(log|debug)\s*\(/.test(source))
        findings.push(
          `${path.relative(root, absolute)} contains console logging`,
        );
    }
  }
}

walk(root);
if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log("Shredit lint: PASS");

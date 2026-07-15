import { chromium } from "@playwright/test";

const BASE = "http://localhost:8080";
const routes = [
  "/old-home", "/queue", "/library", "/report", "/dna-viral", "/backup",
  "/import", "/validation", "/lexicon", "/cohorts", "/cta-deep", "/dna-v2",
  "/temporal", "/micro-events", "/patterns", "/combinacoes", "/costs",
  "/cta-audit", "/verbal-intelligence", "/system-xray", "/data-readiness",
  "/master-readiness-report", "/master-system-report", "/login",
];

const browser = await chromium.launch();
const page = await browser.newPage();

const report = [];

for (const route of routes) {
  const entry = { route, consoleErrors: [], pageErrors: [], failedRequests: [], title: "" };
  const onConsole = (msg) => {
    if (msg.type() === "error") entry.consoleErrors.push(msg.text().slice(0, 300));
  };
  const onPageError = (err) => entry.pageErrors.push(String(err).slice(0, 300));
  const onResponse = (res) => {
    const url = res.url();
    if (res.status() >= 400 && !url.includes("localhost:8080")) {
      entry.failedRequests.push(`${res.status()} ${res.request().method()} ${url.slice(0, 180)}`);
    }
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);

  try {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    entry.title = await page.title();
    const body = await page.locator("body").innerText().catch(() => "");
    entry.textSample = body.replace(/\s+/g, " ").slice(0, 200);
    entry.blank = body.trim().length < 30;
  } catch (e) {
    entry.pageErrors.push("NAV FAIL: " + String(e).slice(0, 200));
  }

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("response", onResponse);
  report.push(entry);
  console.log(`done ${route} — errors:${entry.consoleErrors.length} pageErr:${entry.pageErrors.length} failedReq:${entry.failedRequests.length}${entry.blank ? " BLANK PAGE" : ""}`);
}

await browser.close();

console.log("\n===== FULL REPORT =====");
for (const e of report) {
  const issues = e.consoleErrors.length + e.pageErrors.length + e.failedRequests.length;
  if (issues === 0 && !e.blank) continue;
  console.log(`\n--- ${e.route} ${e.blank ? "(PAGINA VAZIA!)" : ""}`);
  for (const c of [...new Set(e.consoleErrors)].slice(0, 5)) console.log("  [console] " + c);
  for (const p of [...new Set(e.pageErrors)].slice(0, 5)) console.log("  [pageerror] " + p);
  for (const f of [...new Set(e.failedRequests)].slice(0, 8)) console.log("  [req] " + f);
}
console.log("\nOK (sem problemas): " + report.filter(e => !e.blank && e.consoleErrors.length + e.pageErrors.length + e.failedRequests.length === 0).map(e => e.route).join(", "));

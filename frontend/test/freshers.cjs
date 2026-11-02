// "Freshers only" switch: hides other jobs, remembered after reload, off shows everything.
// Build the frontend in jobs mode first, then: node frontend/test/freshers.cjs
const { chromium } = require("playwright");
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "../out");
const T = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const now = new Date().toISOString();
const job = (id, text) => ({ id, fingerprint: id, source: "Premium Membership", text, apply_link: null, post_url: null, posted_at: now, added_at: now });
const jobs = [
  job("f1", "Zeta hiring SDE Intern\nBatch 2026 · Bangalore"),
  job("f2", "Kappa hiring Data Analyst\nFreshers can apply · 0-1 years"),
  job("e1", "Senior Backend Engineer\n5+ years experience · Pune"),
  job("e2", "Data Engineer\nExperience: 3-5 years"),
];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 1200 } });
  await ctx.route("https://jatin-29.github.io/general/**", (r) => { let p = new URL(r.request().url()).pathname.replace(/^\/general/, ""); if (p.endsWith("/")) p += "index.html"; const f = path.join(OUT, p); fs.existsSync(f) ? r.fulfill({ contentType: T[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) }) : r.fulfill({ status: 404, body: "" }); });
  await ctx.route(/githubusercontent|api\.github\.com/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ updated_at: now, jobs }) }));
  const pg = await ctx.newPage();
  await pg.goto("https://jatin-29.github.io/general/");
  await pg.locator("#jobs article").first().waitFor();
  const cards = () => pg.locator("#jobs article").count();
  assert.equal(await cards(), 4);
  assert.equal(await pg.getByText("🎓 Freshers", { exact: true }).count(), 2); // tags on the two fresher posts

  await pg.getByRole("button", { name: /Freshers only/ }).click();
  await pg.waitForTimeout(300);
  assert.equal(await cards(), 2);
  assert.match(await pg.locator("#jobs").innerText(), /2 fresher jobs/);
  assert.equal(await pg.getByRole("button", { name: /^All jobs/ }).getAttribute("aria-label"), "All jobs: 2");
  console.log("  ✓ Freshers only: 2 of 4 shown, counters follow");

  await pg.reload();
  await pg.locator("#jobs article").first().waitFor();
  await pg.waitForTimeout(300);
  assert.equal(await cards(), 2);
  assert.equal(await pg.getByRole("button", { name: /Freshers only/ }).getAttribute("aria-pressed"), "true");
  console.log("  ✓ remembered after reload");

  await pg.getByRole("button", { name: /Freshers only/ }).click();
  await pg.waitForTimeout(300);
  assert.equal(await cards(), 4);
  console.log("  ✓ switching it off shows all 4 again");
  await b.close();
  console.log("All freshers checks passed.");
})().catch((e) => { console.error(e); process.exit(1); });

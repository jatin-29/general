// A long WhatsApp post (one long line, sender's name in front) shows in full behind "Read more".
// Build the frontend in jobs mode first, then: node frontend/test/whatsapp-card.cjs
const { chromium } = require("playwright");
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "../out");
const T = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const now = new Date().toISOString();
const post = "Akshat Jain: Responsibilities and Duties: 1. Help create new electronic component categories on the website 2. Write product descriptions 3. Keep the catalogue up to date. Apply at https://example.com/apply LAST LINE MARKER";
const jobs = [{ id: "w1", fingerprint: "w1", source: "WhatsApp · EP1 Badmosi", text: post, apply_link: null, post_url: null, posted_at: now, added_at: now }];

(async () => {
  const b = await chromium.launch();
  for (const viewport of [{ width: 1300, height: 1100 }, { width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport });
  await ctx.route("https://jatin-29.github.io/general/**", (r) => { let p = new URL(r.request().url()).pathname.replace(/^\/general/, ""); if (p.endsWith("/")) p += "index.html"; const f = path.join(OUT, p); fs.existsSync(f) ? r.fulfill({ contentType: T[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) }) : r.fulfill({ status: 404, body: "" }); });
  await ctx.route(/githubusercontent|api\.github\.com/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ updated_at: now, jobs }) }));
  const pg = await ctx.newPage();
  await pg.goto("https://jatin-29.github.io/general/");
  const card = pg.locator("#jobs article").first();
  await card.waitFor();
  const title = await card.locator("h3").innerText();
  assert.ok(!title.startsWith("Akshat Jain"), `sender still in title: ${title}`);
  assert.ok(title.endsWith("…"), `long title should end with …: ${title}`);
  await card.getByRole("button", { name: "Read more" }).click();
  const all = await card.innerText();
  assert.ok(all.includes("LAST LINE MARKER") && all.includes("Keep the catalogue up to date"), all);
  console.log(`  ✓ ${viewport.width}px: no sender name, short title with …, full text behind Read more`);
  await ctx.close();
  }
  await b.close();
  console.log("All WhatsApp card checks passed.");
})().catch((e) => { console.error(e); process.exit(1); });

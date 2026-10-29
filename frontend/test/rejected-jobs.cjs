// Jobs marked Rejected leave the list and the counts, and can be brought back from "N rejected hidden".
// Build the frontend in jobs mode first (see .github/workflows/pages.yml for the env), then: node frontend/test/rejected-jobs.cjs
const { chromium } = require("playwright");
const assert = require("assert/strict");
const fs = require("fs"), path = require("path");
const OUT = path.resolve(__dirname, "../out");
const T = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const job = (id, text) => ({ id, fingerprint: id, source: "Premium Membership", text, apply_link: null, post_url: null, posted_at: "2026-10-29T06:00:00Z", added_at: "2026-10-29T06:00:00Z" });
const DATA = JSON.stringify({ updated_at: "2026-10-29T08:00:00Z", jobs: [job("aaa111aaa111", "HR Recruiter at AcquireX"), job("bbb222bbb222", "Business Analyst Trainee at BrowseInfo"), job("ccc333ccc333", "SDE Intern at Zeta")] });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 1400 } });
  await ctx.route("https://jatin-29.github.io/general/**", (r) => { let p = new URL(r.request().url()).pathname.replace(/^\/general/, ""); if (p.endsWith("/")) p += "index.html"; const f = path.join(OUT, p); fs.existsSync(f) ? r.fulfill({ contentType: T[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) }) : r.fulfill({ status: 404, body: "" }); });
  await ctx.route(/githubusercontent|api\.github\.com/, (r) => r.fulfill({ contentType: "application/json", body: DATA }));
  const pg = await ctx.newPage();
  await pg.goto("https://jatin-29.github.io/general/");
  await pg.evaluate(() => localStorage.setItem("tracker_v1", JSON.stringify({ ccc333ccc333: { status: "rejected", note: "", followUp: "", appliedOn: "", updated: 1 } })));
  await pg.reload();
  const cards = () => pg.locator("#jobs article").evaluateAll((a) => a.map((x) => x.querySelector("h3, h2, .font-display")?.textContent?.trim()));
  await pg.getByText("1 rejected hidden").waitFor();
  assert.equal(await pg.locator("#jobs article").count(), 2);
  await pg.getByRole("button", { name: "All jobs: 2" }).waitFor();
  console.log("  ✓ already-rejected job hidden; All jobs = 2; '1 rejected hidden' shown");

  // reject one from its card
  const first = pg.locator("#jobs article").first();
  await first.locator("select").selectOption("rejected");
  await pg.getByText("2 rejected hidden").waitFor();
  assert.equal(await pg.locator("#jobs article").count(), 1);
  await pg.getByText("Marked rejected and removed from your list").waitFor();
  console.log("  ✓ marking Rejected removes the card (with a message)");

  // open the hidden list, and bring one back
  await pg.getByRole("button", { name: "2 rejected hidden" }).click();
  await pg.getByRole("heading", { name: "Rejected" }).waitFor();
  assert.equal(await pg.locator("#jobs article").count(), 2);
  await pg.locator("#jobs article").first().locator("select").selectOption("applied");
  await pg.waitForTimeout(300);
  assert.equal(await pg.locator("#jobs article").count(), 1);
  await pg.getByRole("button", { name: "Back to openings" }).click();
  await pg.getByRole("heading", { name: "Latest openings" }).waitFor();
  assert.equal(await pg.locator("#jobs article").count(), 2);
  await pg.getByText("1 rejected hidden").waitFor();
  console.log("  ✓ 'rejected hidden' list shows them; changing the status brings a job back");
  // survives a reload (saved in this browser)
  await pg.reload();
  await pg.getByText("1 rejected hidden").waitFor();
  assert.equal(await pg.locator("#jobs article").count(), 2);
  console.log("  ✓ stays hidden after reload");
  await b.close();
  console.log("All rejected-job checks passed.");
})().catch((e) => { console.error(e); process.exit(1); });

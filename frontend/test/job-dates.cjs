// Jobs grouped by the day they were posted, with a calendar to pick one day.
// Build the frontend in jobs mode first (see .github/workflows/pages.yml), then: node frontend/test/job-dates.cjs
const { chromium } = require("playwright");
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "../out");
const T = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const now = new Date();
const at = (daysAgo, hour) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, 15).toISOString();
const job = (id, text, daysAgo, hour) => ({ id, fingerprint: id, source: "Premium Membership", text, apply_link: null, post_url: null, posted_at: at(daysAgo, hour), added_at: at(0, 0) });
const jobs = [
  job("t1", "SDE Intern at Zeta", 0, 9), job("t2", "Data Analyst at Kappa", 0, 8),
  job("y1", "HR Recruiter at AcquireX", 1, 18),
  ...Array.from({ length: 3 }, (_, i) => job(`o${i}`, `Backend Engineer ${i} at Old Co`, 3, 10 + i)),
];
const DATA = JSON.stringify({ updated_at: now.toISOString(), jobs });

(async () => {
  const b = await chromium.launch();
  for (const vp of [{ width: 1300, height: 1300 }, { width: 390, height: 900 }]) {
    const ctx = await b.newContext({ viewport: vp });
    await ctx.route("https://jatin-29.github.io/general/**", (r) => { let p = new URL(r.request().url()).pathname.replace(/^\/general/, ""); if (p.endsWith("/")) p += "index.html"; const f = path.join(OUT, p); fs.existsSync(f) ? r.fulfill({ contentType: T[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) }) : r.fulfill({ status: 404, body: "" }); });
    await ctx.route(/githubusercontent|api\.github\.com/, (r) => r.fulfill({ contentType: "application/json", body: DATA }));
    const pg = await ctx.newPage();
    await pg.goto("https://jatin-29.github.io/general/");
    await pg.getByTestId("day-heading").first().waitFor();
    const headings = await pg.getByTestId("day-heading").allInnerTexts();
    assert.equal(headings.length, 3, headings.join(" | "));
    assert.match(headings[0], /^Today\s*2 jobs$/);
    assert.match(headings[1], /^Yesterday\s*1 job$/);
    assert.match(headings[2], /^\w{3}, \d{1,2} \w{3} \d{4}\s*3 jobs$/);
    const mobile = vp.width < 1024;
    if (mobile) await pg.getByRole("button", { name: /Pick a date/ }).click();
    const old = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
    const label = old.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    if (old.getMonth() !== now.getMonth()) await pg.getByRole("button", { name: "Previous month" }).locator("visible=true").click();
    await pg.getByRole("button", { name: `${label}: 3 jobs` }).locator("visible=true").click();
    await pg.waitForTimeout(300);
    assert.equal(await pg.locator("#jobs article").count(), 3);
    assert.deepEqual(await pg.getByTestId("day-heading").allInnerTexts().then((h) => h.map((x) => x.replace(/\s+/g, " "))), [`${label} 3 jobs`]);
    await pg.getByRole("button", { name: "All dates" }).locator("visible=true").click();
    await pg.waitForTimeout(300);
    assert.equal(await pg.locator("#jobs article").count(), 6);
    console.log(`  ✓ ${mobile ? "phone" : "desktop"}: grouped by day (Today 2, Yesterday 1, ${label} 3); picking a day shows only its jobs`);
    await pg.screenshot({ path: path.join(process.env.SHOTS || "/tmp", `dates-${mobile ? "phone" : "desk"}.png`) });
    await ctx.close();
  }
  await b.close();
  console.log("All job date checks passed.");
})().catch((e) => { console.error(e); process.exit(1); });

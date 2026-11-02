// The jobs page opens on today's jobs; ‹ › step through days that have jobs; the calendar picks any day;
// search and the "All jobs" counter look at every date. Build the frontend in jobs mode first, then:
// node frontend/test/job-dates.cjs
const { chromium } = require("playwright");
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "../out");
const T = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const now = new Date();
const at = (daysAgo, hour) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, 15).toISOString();
const job = (id, text, daysAgo, hour) => ({ id, fingerprint: id, source: "Premium Membership", text, apply_link: null, post_url: null, posted_at: at(daysAgo, hour), added_at: at(0, 0) });
const older = [job("y1", "HR Recruiter at AcquireX", 1, 18), ...Array.from({ length: 3 }, (_, i) => job(`o${i}`, `Backend Engineer ${i} at Old Co`, 3, 10 + i))];
const withToday = [job("t1", "SDE Intern at Zeta", 0, 9), job("t2", "Data Analyst at Kappa", 0, 8), ...older];
const label = (d) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const old = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);

async function page(b, vp, jobs) {
  const ctx = await b.newContext({ viewport: vp });
  await ctx.route("https://jatin-29.github.io/general/**", (r) => { let p = new URL(r.request().url()).pathname.replace(/^\/general/, ""); if (p.endsWith("/")) p += "index.html"; const f = path.join(OUT, p); fs.existsSync(f) ? r.fulfill({ contentType: T[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) }) : r.fulfill({ status: 404, body: "" }); });
  await ctx.route(/githubusercontent|api\.github\.com/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ updated_at: now.toISOString(), jobs }) }));
  const pg = await ctx.newPage();
  await pg.goto("https://jatin-29.github.io/general/");
  return pg;
}

(async () => {
  const b = await chromium.launch();
  for (const vp of [{ width: 1300, height: 1300 }, { width: 390, height: 900 }]) {
    const mobile = vp.width < 1024;
    const pg = await page(b, vp, withToday);
    const cards = () => pg.locator("#jobs article").count();
    const title = () => pg.getByTestId("day-title").innerText();
    await pg.getByTestId("day-title").waitFor();
    await pg.waitForTimeout(300);
    assert.equal(await title(), "Today");
    assert.equal(await cards(), 2);
    assert.equal(await pg.getByRole("button", { name: "Next day" }).isDisabled(), true);

    await pg.getByRole("button", { name: "Previous day" }).click();
    assert.equal(await title(), "Yesterday");
    assert.equal(await cards(), 1);
    await pg.getByRole("button", { name: "Previous day" }).click(); // skips the empty day in between
    assert.equal(await title(), label(old));
    assert.equal(await cards(), 3);
    assert.equal(await pg.getByRole("button", { name: "Previous day" }).isDisabled(), true);
    await pg.getByRole("button", { name: "Back to today" }).click();
    assert.equal(await title(), "Today");

    await pg.getByRole("button", { name: /^All jobs/ }).click();
    await pg.waitForTimeout(300);
    assert.equal(await cards(), 6);
    assert.equal((await pg.getByTestId("day-heading").allInnerTexts()).length, 3);
    await pg.getByRole("button", { name: "Show today only" }).click();
    assert.equal(await cards(), 2);

    await pg.getByLabel("Search").fill("Backend");
    await pg.waitForTimeout(300);
    assert.equal(await cards(), 3); // search looks at every date
    await pg.getByLabel("Search").fill("");

    if (mobile) await pg.getByRole("button", { name: "Pick a date" }).click(); // tap the date in the day bar
    if (old.getMonth() !== now.getMonth()) await pg.getByRole("button", { name: "Previous month" }).locator("visible=true").click();
    await pg.getByRole("button", { name: `${label(old)}: 3 jobs` }).locator("visible=true").click();
    await pg.waitForTimeout(300);
    assert.equal(await title(), label(old));
    assert.equal(await cards(), 3);
    console.log(`  ✓ ${mobile ? "phone" : "desktop"}: opens on Today (2); ‹ goes to Yesterday (1) then ${label(old)} (3); All jobs shows every date; search spans dates; calendar picks a day`);
    await pg.context().close();
  }

  const pg = await page(b, { width: 1300, height: 1300 }, older); // nothing posted yet today
  await pg.getByText("No new jobs yet today").waitFor();
  await pg.getByRole("button", { name: "See Yesterday · 1 job" }).click();
  assert.equal(await pg.getByTestId("day-title").innerText(), "Yesterday");
  console.log("  ✓ quiet day: \"No new jobs yet today\" with a button to the latest day");
  await b.close();
  console.log("All job date checks passed.");
})().catch((e) => { console.error(e); process.exit(1); });

// Resume builder: always exactly one A4 page, and the ATS check reads it back.
// Build the frontend first (NEXT_PUBLIC_BASE_PATH=/general), then: node frontend/test/resume-one-page.cjs
const { chromium } = require("playwright");
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "../out");
const BASE = "https://jatin-29.github.io/general";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain" };
const pages = (pdf) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;

const base = {
  name: "Ananya Gupta", email: "ananya@example.com", phone: "+91 99887 76655", location: "Noida, India", headline: "Final-year B.Tech IT student",
  summary: "", college: "Amity University", degree: "B.Tech in Information Technology", batch: "2026", cgpa: "8.9",
  skills: "Java, Spring Boot, MySQL, Git, Python, React, Docker, AWS", linkedin: "linkedin.com/in/ananya", github: "github.com/ananya", portfolio: "", resumeLink: "",
  experience: [{ company: "Infosys", role: "Java Intern", start: "Jun 2025", end: "Aug 2025", location: "Pune", bullets: "Built REST endpoints for an HR portal used by 2,000 staff\nWrote unit tests raising coverage from 45% to 80%" }],
  projects: [{ name: "Library Manager", tech: "Spring Boot, MySQL", link: "", bullets: "Built issue/return flows with automatic fines for 300 students" }],
  education: [{ school: "DPS Noida", degree: "Class XII (CBSE)", year: "2022", score: "93%" }], achievements: "Top 5% in Flipkart GRiD 2025", certifications: "",
};
const point = (i) => `Improved the data pipeline step ${i} by rewriting the batch jobs in Spark, cutting nightly run time by ${10 + i}% and saving about ${i * 3} hours a week for the analytics team`;
const long = {
  ...base,
  summary: "Backend-focused engineering student who enjoys building reliable APIs and data pipelines, looking for SDE internships and graduate roles.",
  experience: Array.from({ length: 4 }, (_, i) => ({ company: `Company ${i + 1}`, role: "Software Engineering Intern", start: "May 2025", end: "Jul 2025", location: "Bengaluru", bullets: Array.from({ length: 5 }, (_, j) => point(j + 1)).join("\n") })),
  projects: Array.from({ length: 5 }, (_, i) => ({ name: `Project ${i + 1}`, tech: "Python, FastAPI, PostgreSQL", link: `github.com/ananya/p${i + 1}`, bullets: Array.from({ length: 4 }, (_, j) => point(j + 2)).join("\n") })),
  achievements: Array.from({ length: 6 }, (_, i) => `Ranked ${i + 10} in a national coding contest with 20,000 participants`).join("\n"),
  certifications: "AWS Cloud Practitioner\nGoogle Data Analytics\nNPTEL Java (Elite)\nMeta Front-End Developer",
};
const huge = { ...long, experience: Array.from({ length: 8 }, (_, i) => ({ ...long.experience[0], company: `Company ${i + 1}` })), projects: Array.from({ length: 8 }, (_, i) => ({ ...long.projects[0], name: `Project ${i + 1}` })) };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  await ctx.route(`${BASE}/**`, (r) => {
    let p = new URL(r.request().url()).pathname.replace(/^\/general/, "");
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(OUT, p);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "not found" });
    r.fulfill({ contentType: TYPES[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
  });
  await ctx.route(/githubusercontent|api\.github\.com/, (r) => r.fulfill({ status: 404, body: "{}" }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  async function open(profile) {
    await page.goto(`${BASE}/resume/`);
    await page.evaluate((p) => { localStorage.setItem("profile_v1", JSON.stringify(p)); localStorage.removeItem("resume_opts"); }, profile);
    await page.reload();
    await page.getByTestId("ats-score").waitFor();
    await page.waitForTimeout(800);
    return { status: await page.getByTestId("fit-status").textContent(), score: Number(await page.getByTestId("ats-score").textContent()), pdf: await page.pdf({ format: "A4", printBackground: true }), checks: await page.getByLabel("ATS check").innerText() };
  }

  let r = await open(base);
  assert.equal(pages(r.pdf), 1);
  assert.match(r.status, /^✓ One page, text 10\.2pt\.$/);
  assert.ok(r.score >= 85, `score ${r.score}`);
  await page.getByText("Show every check").click();
  const all = await page.getByLabel("ATS check").innerText();
  for (const s of ["Name: Ananya Gupta", "Email: ananya@example.com", "Phone: +91 99887 76655", "Education: Amity University · 2026 · CGPA 8.9", "Experience: all 1 read", "Projects: all 1 read", "Fits on one page"]) assert.ok(all.includes(s), `missing "${s}" in:\n${all}`);
  console.log(`  ✓ short profile: one page at full size, ATS score ${r.score}, everything read back`);

  r = await open(long);
  assert.equal(pages(r.pdf), 1);
  assert.match(r.status, /One page\. To fit: /);
  console.log(`  ✓ long profile: one page (${r.status.replace("✓ One page. To fit: ", "")}) score ${r.score}`);

  r = await open(huge);
  assert.equal(pages(r.pdf), 1);
  assert.doesNotMatch(r.status, /Too long/);
  console.log(`  ✓ very long profile: still one page (${r.status.replace("✓ One page. To fit: ", "")})`);

  const weak = { ...base, experience: [{ ...base.experience[0], bullets: "Worked on the HR portal 🚀\nI helped the team" }] };
  r = await open(weak);
  for (const s of ["start with an action verb", "Uses I / my / we", "too short"]) assert.ok(r.checks.includes(s), `missing "${s}"`);
  assert.ok(!(await page.locator("#print-root [data-resume-sheet]").textContent()).includes("🚀"), "emoji printed");
  console.log(`  ✓ weak points and "I" are flagged, emoji left out of the PDF (score ${r.score})`);

  const projects = { ...base, projects: [{ ...base.projects[0], bullets: "Collects job posts from Telegram every 15 minutes\nEncrypted the job list with AES-256" }] };
  r = await open(projects);
  assert.ok(!r.checks.includes("start with an action verb"), r.checks);
  console.log("  ✓ \"Collects…\", \"Encrypted…\" count as action verbs");

  assert.deepEqual(errors, []);
  await browser.close();
  console.log("All resume builder checks passed.");
})().catch((e) => { console.error(e); process.exit(1); });

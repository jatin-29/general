// Checks "Fill from my resume" on the built site (npm run build first, with NEXT_PUBLIC_BASE_PATH=/general):
// uploads sample resumes on My profile, accepts the review, and checks what lands in the profile.
// Run: node frontend/test/resume-import.cjs
const { chromium } = require("playwright");
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { JAKE, FRESHER, DOCX } = require("./resume-fixtures.cjs");

const OUT = path.resolve(__dirname, "../out");
const BASE = "https://jatin-29.github.io/general";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain", ".json": "application/json", ".zip": "application/zip" };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oh-resume-"));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
  await ctx.route(`${BASE}/**`, (r) => {
    let p = new URL(r.request().url()).pathname.replace(/^\/general/, "");
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(OUT, p);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "not found" });
    r.fulfill({ contentType: TYPES[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // sample files
  const maker = await browser.newPage();
  for (const [name, html] of [["jake.pdf", JAKE], ["fresher.pdf", FRESHER]]) {
    await maker.setContent(html);
    await maker.pdf({ path: path.join(tmp, name), format: "A4" });
  }
  fs.writeFileSync(path.join(tmp, "priya.docx"), DOCX);

  async function importResume(file, start = {}) {
    await page.goto(`${BASE}/profile/`);
    await page.evaluate((p) => { localStorage.clear(); localStorage.setItem("profile_v1", JSON.stringify(p)); }, start);
    await page.reload();
    await page.getByLabel("Resume file").setInputFiles(file);
    const dialog = page.getByRole("dialog", { name: "Check what was found in your resume" });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: /^Use \d+ selected$/ }).click();
    await dialog.waitFor({ state: "detached" });
    await page.waitForTimeout(600); // profile autosaves after a short pause
    return page.evaluate(() => JSON.parse(localStorage.getItem("profile_v1")));
  }
  const ok = (m) => console.log(`  ✓ ${m}`);

  // 1. Overleaf / Jake's template
  let p = await importResume(path.join(tmp, "jake.pdf"));
  assert.equal(p.name, "Jatin Maggo");
  assert.equal(p.email, "jatin.maggo@gmail.com");
  assert.equal(p.phone, "+91 98765 43210");
  assert.equal(p.linkedin, "linkedin.com/in/jatin-maggo");
  assert.equal(p.github, "github.com/jatin-29");
  assert.deepEqual([p.college, p.degree, p.batch, p.cgpa], ["Delhi Technological University", "Bachelor of Technology in Computer Science", "2026", "8.42"]);
  assert.deepEqual(p.education, [{ school: "Delhi Public School, R.K. Puram", degree: "Class XII (CBSE)", year: "2022", score: "92.4%" }]);
  assert.deepEqual(p.experience.map((x) => [x.company, x.role, x.start, x.end, x.location, x.bullets.split("\n").length]), [["Acme Technologies", "Software Engineering Intern", "May 2025", "Jul 2025", "Bengaluru, India", 2]]);
  assert.deepEqual(p.projects.map((x) => [x.name, x.tech]), [["OpeningsHub", "Next.js, FastAPI, Python"], ["Chess Engine", "C++"]]);
  assert.equal(p.skills, "Python, Java, C++, JavaScript, SQL, React, Next.js, FastAPI, Django, Git, Docker, AWS, Linux");
  assert.equal(p.achievements, "4 star on CodeChef (max rating 1950)\nWinner, Smart India Hackathon 2024");
  ok("Overleaf-style PDF: contact, links, education, internship, projects, skills, achievements");

  // 2. Indian fresher layout with a marks table
  p = await importResume(path.join(tmp, "fresher.pdf"));
  assert.deepEqual([p.name, p.email, p.phone, p.location], ["Rahul Kumar Sharma", "rahul.sharma@example.com", "9876501234", "Delhi"]);
  assert.deepEqual([p.college, p.degree, p.batch, p.cgpa], ["Netaji Subhas University of Technology", "B.Tech (ECE)", "2025", "7.9"]);
  assert.deepEqual(p.education.map((e) => [e.degree, e.school, e.year, e.score]), [["Class XII (CBSE)", "Kendriya Vidyalaya", "2021", "88%"], ["Class X (CBSE)", "Kendriya Vidyalaya", "2019", "91%"]]);
  assert.deepEqual(p.experience.map((x) => [x.company, x.role, x.start, x.end]), [["XYZ Analytics Pvt. Ltd.", "Data Analyst Intern", "June 2024", "August 2024"]]);
  assert.deepEqual(p.projects.map((x) => [x.name, x.tech]), [["Smart Attendance System", "Python, OpenCV"]]);
  assert.equal(p.skills, "C, C++, Python, MS Excel, Power BI");
  assert.match(p.summary, /^To work in a challenging environment/);
  assert.equal(p.certifications.split("\n").length, 2);
  ok("Fresher PDF: marks table (B.Tech, XII, X), objective, numbered project, certifications");

  // 3. Word file, and what you already typed stays unless you tick it
  p = await importResume(path.join(tmp, "priya.docx"), { name: "Priya S.", headline: "Data person" });
  assert.equal(p.name, "Priya S."); // already filled: left alone by default
  assert.deepEqual([p.email, p.phone, p.location, p.linkedin], ["priya.singh@example.com", "+91-91234-56789", "Pune, Maharashtra", "linkedin.com/in/priya-singh-123"]);
  assert.deepEqual([p.college, p.degree, p.batch, p.cgpa], ["Symbiosis Institute of Computer Studies", "MCA", "2025", "8.1"]);
  assert.deepEqual(p.education.map((e) => [e.degree, e.school]), [["BCA", "Fergusson College"]]);
  assert.equal(p.skills, "SQL, Tableau, Python, Excel");
  assert.deepEqual(p.projects.map((x) => [x.name, x.tech]), [["Sales Dashboard", "Tableau, SQL"]]);
  ok("Word .docx: table, hyperlink, and your own entries kept");

  // 4. Round trip: a resume made by the site's Resume builder reads back into the same profile
  const mine = {
    name: "Ananya Gupta", email: "ananya@example.com", phone: "+91 99887 76655", location: "Noida, India", headline: "Final-year B.Tech IT student",
    college: "Amity University", degree: "B.Tech in Information Technology", batch: "2026", cgpa: "8.9", skills: "Java, Spring Boot, MySQL, Git",
    linkedin: "linkedin.com/in/ananya", github: "github.com/ananya", summary: "", portfolio: "", resumeLink: "",
    experience: [{ company: "Infosys", role: "Java Intern", start: "Jun 2025", end: "Aug 2025", location: "Pune", bullets: "Built REST endpoints for an HR portal\nWrote unit tests raising coverage to 80%" }],
    projects: [{ name: "Library Manager", tech: "Spring Boot, MySQL", link: "", bullets: "Issue and return books with fines" }],
    education: [], achievements: "Top 5% in Flipkart GRiD 2025", certifications: "",
  };
  await page.goto(`${BASE}/resume/`);
  await page.evaluate((p) => localStorage.setItem("profile_v1", JSON.stringify(p)), mine);
  await page.reload();
  await page.waitForTimeout(800);
  await page.pdf({ path: path.join(tmp, "builder.pdf"), format: "A4" });
  p = await importResume(path.join(tmp, "builder.pdf"));
  for (const k of ["name", "email", "phone", "location", "headline", "college", "degree", "batch", "cgpa", "skills", "linkedin", "github", "achievements"]) assert.equal(p[k], mine[k], k);
  assert.deepEqual(p.experience.map((x) => [x.company, x.role, x.start, x.end, x.bullets]), mine.experience.map((x) => [x.company, x.role, x.start, x.end, x.bullets]));
  assert.deepEqual(p.projects.map((x) => [x.name, x.tech, x.bullets]), mine.projects.map((x) => [x.name, x.tech, x.bullets]));
  ok("Round trip: a PDF from the site's Resume builder reads back into the same profile");

  // 5. A scanned / image-only file is refused politely
  await page.goto(`${BASE}/profile/`);
  await page.getByLabel("Resume file").setInputFiles({ name: "photo.doc", mimeType: "application/msword", buffer: Buffer.from("x") });
  await page.getByText("Old .doc files can't be read").waitFor();
  ok("Unsupported file: clear message");

  assert.deepEqual(errors, []);
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("All resume import checks passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// End-to-end check: loads the real extension in Chromium and fills look-alike pages served at the real
// job-site addresses (Google Forms, Workday, Greenhouse). Run: node extension/test/e2e.cjs
const { chromium } = require("playwright");
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EXT = path.resolve(__dirname, "..");
const SITE = "https://jatin-29.github.io/general/profile/";

const PROFILE = {
  name: "Jatin Maggo", email: "jatin@example.com", phone: "+91 98765 43210", location: "New Delhi, India",
  college: "Delhi Technological University", degree: "B.Tech in Computer Science", batch: "2026", cgpa: "8.4",
  skills: "Python, React, SQL", linkedin: "linkedin.com/in/jatin", github: "github.com/jatin-29", portfolio: "",
  education: [{ school: "DPS", degree: "Class XII (CBSE)", year: "2022", score: "92%" }, { school: "DPS", degree: "Class X (CBSE)", year: "2020", score: "95%" }],
  experience: [], gender: "Male", dob: "2003-05-14", address: "12 MG Road", state: "Delhi", country: "India", pincode: "110001",
  experienceYears: "0", expectedCtc: "6 LPA", noticePeriod: "Immediate", relocate: "Yes",
  answers: [{ q: "hear about", a: "LinkedIn" }, { q: "previously worked", a: "No" }, { q: "authorized to work", a: "Yes" }],
};

const page = (body, script = "") => `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}<script>${script}</script></body></html>`;

const SITE_PAGE = page("<h1>My profile</h1>", `localStorage.setItem("profile_v1", ${JSON.stringify(JSON.stringify(PROFILE))});`);

const GFORM = page(`
<form><div role="list">
 <div role="listitem"><div role="heading" id="q1">Full Name <span>*</span></div><input type="text" aria-labelledby="q1" aria-required="true" id="name"></div>
 <div role="listitem"><div role="heading" id="q2">Email Address</div><input type="email" aria-labelledby="q2" id="email"></div>
 <div role="listitem"><div role="heading" id="q3">Contact Number (WhatsApp)</div><input type="text" aria-labelledby="q3" id="phone"></div>
 <div role="listitem"><div role="heading" id="q4">College Name</div><input type="text" aria-labelledby="q4" id="college"></div>
 <div role="listitem"><div role="heading" id="q5">Gender</div><div role="radiogroup" aria-labelledby="q5" id="gender">
   <div role="radio" data-value="Male" aria-label="Male" aria-checked="false">Male</div>
   <div role="radio" data-value="Female" aria-label="Female" aria-checked="false">Female</div></div></div>
 <div role="listitem"><div role="heading" id="q6">Year of Passing</div>
   <div role="listbox" aria-expanded="false" aria-labelledby="q6" id="year"><div role="option" data-value="" aria-selected="true" class="sel">Choose</div>
     <div class="pop" style="display:none"><div role="option" data-value="2025">2025</div><div role="option" data-value="2026">2026</div></div></div></div>
 <div role="listitem"><div role="heading" id="q7">12th Percentage</div><input type="text" aria-labelledby="q7" id="p12"></div>
 <div role="listitem"><div role="heading" id="q11">Class 10 board</div><input type="text" aria-labelledby="q11" id="b10"></div>
 <div role="listitem"><div role="heading" id="q8">How did you hear about this opening?</div><input type="text" aria-labelledby="q8" id="hear"></div>
 <div role="listitem"><div role="heading" id="q9">Why do you want to join us? *</div><textarea aria-labelledby="q9" id="why" aria-required="true"></textarea></div>
 <div role="listitem"><div role="heading" id="q10">Date of Birth</div><input type="date" aria-labelledby="q10" id="dob"></div>
</div></form>`, `
document.querySelectorAll("[role=radio]").forEach((r) => r.addEventListener("click", () =>
  r.parentElement.querySelectorAll("[role=radio]").forEach((x) => x.setAttribute("aria-checked", String(x === r)))));
const lb = document.getElementById("year"), pop = lb.querySelector(".pop"), sel = lb.querySelector(".sel");
lb.addEventListener("click", (e) => {
  const o = e.target.closest(".pop [role=option]");
  if (o) { sel.textContent = o.textContent; sel.dataset.value = o.dataset.value; pop.style.display = "none"; return; }
  pop.style.display = pop.style.display === "none" ? "block" : "none";
});`);

const WORKDAY = page(`
<div data-automation-id="applyFlowPage">
 <div><label for="w1">Given Name(s)<abbr>*</abbr></label><input id="w1" data-automation-id="legalNameSection_firstName" aria-required="true"></div>
 <div><label for="w2">Family Name<abbr>*</abbr></label><input id="w2" data-automation-id="legalNameSection_lastName" aria-required="true"></div>
 <div><label for="w3">Address Line 1</label><input id="w3" data-automation-id="addressSection_addressLine1"></div>
 <div><label for="w4">City</label><input id="w4" data-automation-id="addressSection_city"></div>
 <div><label for="w5">Postal Code</label><input id="w5" data-automation-id="addressSection_postalCode"></div>
 <div><label id="l6">State</label><button aria-haspopup="listbox" aria-labelledby="l6" id="state">Select One</button></div>
 <div><label for="w7">Email Address</label><input id="w7" data-automation-id="email"></div>
 <div><label id="l8">Phone Device Type</label><button aria-haspopup="listbox" aria-labelledby="l8" id="device">Select One</button></div>
 <div><label for="w9">Phone Number<abbr>*</abbr></label><input id="w9" data-automation-id="phone-number" aria-required="true"></div>
 <div><label for="w10">Phone Extension</label><input id="w10"></div>
 <fieldset><legend>Have you previously worked for Acme?</legend><label><input type="radio" name="prev" value="true"> Yes</label><label><input type="radio" name="prev" value="false"> No</label></fieldset>
 <div><h3>Resume/CV</h3><input type="file" data-automation-id="file-upload-input-ref" style="display:none" id="cv"><button type="button">Select files</button></div>
</div>
<ul role="listbox" id="popup" style="display:none"></ul>`, `
window.state = {};
document.querySelectorAll("input:not([type=radio]):not([type=file])").forEach((i) => i.addEventListener("input", () => (state[i.id] = i.value)));
const lists = { state: ["Delhi", "Haryana", "Karnataka"], device: ["Landline", "Mobile"] };
let openFor = null;
document.querySelectorAll("button[aria-haspopup]").forEach((b) => b.addEventListener("click", () => {
  openFor = b;
  const ul = document.getElementById("popup");
  ul.innerHTML = lists[b.id].map((x) => "<li role=option><div>" + x + "</div></li>").join("");
  ul.style.display = "block";
}));
document.getElementById("popup").addEventListener("click", (e) => {
  const li = e.target.closest("[role=option]");
  if (!li) return;
  openFor.textContent = li.textContent;
  e.currentTarget.style.display = "none";
});
document.getElementById("cv").addEventListener("change", (e) => (state.cv = e.target.files[0] && e.target.files[0].name));`);

const GREENHOUSE = page(`
<form id="application-form">
 <div><label for="first_name">First Name *</label><input id="first_name" name="job_application[first_name]" required></div>
 <div><label for="last_name">Last Name *</label><input id="last_name" required></div>
 <div><label for="email">Email *</label><input id="email" type="text" required></div>
 <div><label for="phone">Phone</label><input id="phone" type="tel"></div>
 <div><label for="resume">Resume/CV *</label><input id="resume" type="file" accept=".pdf,.doc,.docx"></div>
 <div><label for="cover_letter">Cover Letter</label><input id="cover_letter" type="file"></div>
 <div><label for="li">LinkedIn Profile</label><input id="li"></div>
 <div><label for="web">Website</label><input id="web" value="https://already.example"></div>
 <div><label for="auth">Are you legally authorized to work in India?</label><select id="auth"><option value="">Select...</option><option value="1">Yes</option><option value="0">No</option></select></div>
 <div><label for="gender">Gender</label><select id="gender"><option value="">Please select</option><option>Male</option><option>Female</option><option>Decline To Self Identify</option></select></div>
 <div><label id="country-label">Country</label><div class="select__control"><div class="select__placeholder">Select...</div><input role="combobox" aria-labelledby="country-label" aria-controls="country-list" id="country"></div><div id="country-list" role="listbox"></div></div>
 <div><label for="school">School</label><input id="school"></div>
 <div><label for="degree">Degree</label><select id="degree"><option value="">Select</option><option>Bachelor's Degree</option><option>B.Tech / B.E.</option><option>Master's Degree</option></select></div>
 <div><label for="ctc">Expected CTC (LPA)</label><input id="ctc" type="number"></div>
</form>`, `
const all = ["India", "Indonesia", "Ireland"];
const box = document.getElementById("country"), list = document.getElementById("country-list"), shown = document.querySelector(".select__placeholder");
box.addEventListener("input", () => {
  list.innerHTML = all.filter((c) => c.toLowerCase().startsWith(box.value.toLowerCase()) && box.value).map((c) => "<div role=option>" + c + "</div>").join("");
});
list.addEventListener("click", (e) => {
  const o = e.target.closest("[role=option]");
  if (!o) return;
  shown.textContent = o.textContent;
  box.value = "";
  list.innerHTML = "";
});`);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-ext-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1000, height: 1400 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const serve = (pattern, html) => ctx.route(pattern, (r) => r.fulfill({ contentType: "text/html", body: html }));
  await serve(SITE + "**", SITE_PAGE);
  await serve("https://docs.google.com/forms/**", GFORM);
  await serve("https://acme.wd3.myworkdayjobs.com/**", WORKDAY);
  await serve("https://job-boards.greenhouse.io/**", GREENHOUSE);

  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  const fillActiveTab = () => sw.evaluate(async () => { const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return self.fillTab(tab.id); });
  const ok = (name) => console.log(`  ✓ ${name}`);

  // 1. Your site hands the profile to the extension.
  const site = await ctx.newPage();
  await site.goto(SITE);
  await site.waitForFunction(() => document.documentElement.dataset.ohExtension);
  await site.waitForTimeout(500);
  const stored = await sw.evaluate(() => chrome.storage.local.get("profile"));
  assert.equal(stored.profile.name, "Jatin Maggo");
  await site.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("profile_v1"));
    localStorage.setItem("profile_v1", JSON.stringify({ ...p, cgpa: "8.6" }));
    window.dispatchEvent(new Event("openingshub:profile"));
  });
  await site.waitForTimeout(300);
  assert.equal((await sw.evaluate(() => chrome.storage.local.get("profile"))).profile.cgpa, "8.6");
  ok("site → extension sync (and live updates)");
  const pdf = Buffer.from("%PDF-1.4\n% test resume\n").toString("base64");
  await sw.evaluate((data) => chrome.storage.local.set({ resume: { name: "Jatin_Resume.pdf", type: "application/pdf", size: 24, data } }), pdf);

  // 2. Google Form, using the ⚡ button on the page.
  const gf = await ctx.newPage();
  await gf.goto("https://docs.google.com/forms/d/e/test/viewform");
  await gf.waitForSelector("#oh-autofill-host", { state: "attached" });
  await gf.mouse.click(1000 - 60, 1400 - 37); // the ⚡ Autofill pill sits bottom-right
  await gf.waitForFunction(() => document.getElementById("why").style.outlineColor, null, { timeout: 8000 }); // set at the end of a run
  const g = await gf.evaluate(() => ({
    name: document.getElementById("name").value, email: email.value, phone: phone.value, college: college.value, p12: p12.value, b10: b10.value, hear: hear.value, why: why.value, dob: dob.value,
    gender: document.querySelector("#gender [aria-checked=true]")?.dataset.value, year: document.querySelector("#year .sel").dataset.value, whyOutline: why.style.outlineColor,
  }));
  assert.deepEqual(g, {
    name: "Jatin Maggo", email: "jatin@example.com", phone: "9876543210", college: "Delhi Technological University", p12: "92%", b10: "CBSE",
    hear: "LinkedIn", why: "", dob: "2003-05-14", gender: "Male", year: "2026", whyOutline: "rgb(245, 158, 11)",
  });
  ok("Google Form: text, radio, dropdown, date, 12th %, board, saved answer; 'why' left for you (yellow)");

  // 3. Workday, using the keyboard-shortcut/popup path (fill every frame of the tab).
  const wd = await ctx.newPage();
  await wd.goto("https://acme.wd3.myworkdayjobs.com/en-US/careers/job/apply");
  await wd.bringToFront();
  const wr = await fillActiveTab();
  const w = await wd.evaluate(() => ({ ...state, stateBtn: document.getElementById("state").textContent, device: document.getElementById("device").textContent, prev: document.querySelector("input[name=prev]:checked")?.value, ext: w10.value }));
  assert.deepEqual(w, {
    w1: "Jatin", w2: "Maggo", w3: "12 MG Road", w4: "New Delhi", w5: "110001", w7: "jatin@example.com", w9: "9876543210", cv: "Jatin_Resume.pdf",
    stateBtn: "Delhi", device: "Mobile", prev: "false", ext: "",
  });
  assert.equal(wr.resume, true);
  assert.equal(wr.needs, 0);
  ok(`Workday: names, address, dropdowns, phone, saved Yes/No answer, resume upload (${wr.filled} fields)`);

  // 4. Greenhouse, with the button again.
  const gh = await ctx.newPage();
  await gh.goto("https://job-boards.greenhouse.io/acme/jobs/123");
  await gh.waitForSelector("#oh-autofill-host", { state: "attached" });
  await gh.mouse.click(1000 - 60, 1400 - 37);
  await gh.waitForFunction(() => document.getElementById("resume").files.length, null, { timeout: 8000 }); // attached near the end of a run
  const h = await gh.evaluate(() => ({
    first: first_name.value, last: last_name.value, email: email.value, phone: phone.value, li: li.value, web: web.value,
    auth: auth.value, gender: gender.value, school: school.value, degree: degree.value, ctc: ctc.value,
    resume: resume.files[0]?.name, cover: cover_letter.files.length, country: document.querySelector(".select__placeholder").textContent,
  }));
  assert.deepEqual(h, {
    first: "Jatin", last: "Maggo", email: "jatin@example.com", phone: "9876543210", li: "https://linkedin.com/in/jatin", web: "https://already.example",
    auth: "1", gender: "Male", school: "Delhi Technological University", degree: "B.Tech / B.E.", ctc: "6",
    resume: "Jatin_Resume.pdf", cover: 0, country: "India",
  });
  ok("Greenhouse: selects, type-to-search country, number box, resume (not cover letter), existing answers kept");

  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("All extension checks passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

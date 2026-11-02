// Which posts count as fresher-friendly. Run: node --experimental-strip-types frontend/test/fresher-rules.mjs
import assert from "assert/strict";
const { isFresherText } = await import(new URL("../lib/fresher.ts", import.meta.url));

const fresher = [
  "Zeta is hiring SDE Intern | Batch 2026 | Bangalore",
  "Amazon hiring SDE-1 (0-1 years)",
  "Freshers and experienced can apply (0-5 years)",
  "HR Recruiter, Noida, Experience: 0 - 1 yrs",
  "Off campus drive for 2025 & 2026 batch",
  "Graduate Engineer Trainee (GET) at L&T",
  "Associate Software Engineer - Freshers",
  "Internship opportunity for final-year students, stipend 25k",
  "Data Analyst trainee, any graduate can apply",
  "Entry level QA role, no experience required",
];
const notFresher = [
  "Senior Backend Engineer, 5+ years experience, Bangalore",
  "Data Analyst | Experience: 2-4 years | Gurugram",
  "Product Manager with 3+ years of experience",
  "Team Lead - Java (6 yrs exp)",
  "Hiring Software Engineer at XYZ, Bangalore", // says nothing about experience
  "Freshers are not eligible. 2+ years experience required",
  "Senior Consultant internship mentor programme lead", // senior words beat a hint
];
for (const t of fresher) assert.equal(isFresherText(t), true, t);
for (const t of notFresher) assert.equal(isFresherText(t), false, t);
console.log(`All fresher rule checks passed (${fresher.length} fresher, ${notFresher.length} not).`);

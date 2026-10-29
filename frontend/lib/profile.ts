import { loadJSON, saveJSON } from "./store";

export interface Experience { company: string; role: string; start: string; end: string; location: string; bullets: string }
export interface Project { name: string; tech: string; link: string; bullets: string }
export interface Education { school: string; degree: string; year: string; score: string }
/** "If a form question contains q, answer a" (used by the Chrome extension). */
export interface Answer { q: string; a: string }

export interface Profile {
  name: string;
  email: string;
  phone: string;
  location: string;
  headline: string; // e.g. "Final-year B.Tech CSE student"
  summary: string;
  college: string;
  degree: string; // e.g. "B.Tech in Computer Science"
  batch: string; // graduation year
  cgpa: string;
  skills: string; // comma separated
  linkedin: string;
  github: string;
  portfolio: string;
  resumeLink: string; // e.g. a Google Drive link to the PDF, used in messages
  experience: Experience[];
  projects: Project[];
  education: Education[]; // other education (school, diploma...)
  achievements: string; // one per line
  certifications: string; // one per line
  // Extra details job forms ask for; the Chrome extension fills them in.
  gender: string;
  dob: string; // YYYY-MM-DD
  address: string;
  state: string;
  country: string;
  pincode: string;
  experienceYears: string;
  currentCtc: string;
  expectedCtc: string;
  noticePeriod: string;
  relocate: string; // "Yes" / "No" / ""
  answers: Answer[];
}

export const emptyProfile = (): Profile => ({
  name: "", email: "", phone: "", location: "", headline: "", summary: "",
  college: "", degree: "", batch: "", cgpa: "", skills: "",
  linkedin: "", github: "", portfolio: "", resumeLink: "",
  experience: [], projects: [], education: [], achievements: "", certifications: "",
  gender: "", dob: "", address: "", state: "", country: "", pincode: "",
  experienceYears: "", currentCtc: "", expectedCtc: "", noticePeriod: "", relocate: "", answers: [],
});

const KEY = "profile_v1";
export const loadProfile = (): Profile => ({ ...emptyProfile(), ...loadJSON<Partial<Profile>>(KEY, {}) });
export const saveProfile = (p: Profile) => {
  saveJSON(KEY, p);
  window.dispatchEvent(new Event("openingshub:profile")); // the Chrome extension picks up the change at once
};

export const skillList = (p: Profile) => p.skills.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
export const lines = (s: string) => s.split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
export const isProfileStarted = (p: Profile) => !!(p.name.trim() && (p.college.trim() || p.skills.trim()));

/** Pull "https://…" or bare "linkedin.com/in/x" into a clickable URL. */
export const asUrl = (s: string) => (!s ? "" : /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`);

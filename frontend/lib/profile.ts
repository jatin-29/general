import { loadJSON, saveJSON } from "./store";

export interface Experience { company: string; role: string; start: string; end: string; location: string; bullets: string }
export interface Project { name: string; tech: string; link: string; bullets: string }
export interface Education { school: string; degree: string; year: string; score: string }

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
}

export const emptyProfile = (): Profile => ({
  name: "", email: "", phone: "", location: "", headline: "", summary: "",
  college: "", degree: "", batch: "", cgpa: "", skills: "",
  linkedin: "", github: "", portfolio: "", resumeLink: "",
  experience: [], projects: [], education: [], achievements: "", certifications: "",
});

const KEY = "profile_v1";
export const loadProfile = (): Profile => ({ ...emptyProfile(), ...loadJSON<Partial<Profile>>(KEY, {}) });
export const saveProfile = (p: Profile) => saveJSON(KEY, p);

export const skillList = (p: Profile) => p.skills.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
export const lines = (s: string) => s.split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
export const isProfileStarted = (p: Profile) => !!(p.name.trim() && (p.college.trim() || p.skills.trim()));

/** Pull "https://…" or bare "linkedin.com/in/x" into a clickable URL. */
export const asUrl = (s: string) => (!s ? "" : /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`);

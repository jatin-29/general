import { asUrl, lines, skillList, type Profile } from "./profile";
import { loadJSON, saveJSON } from "./store";

export type Kind = "email" | "referral" | "followup";
export type Tone = "formal" | "friendly" | "short";
export interface Template { subject: string; body: string }
export type Templates = Record<Kind, Record<Tone, Template>>;

/* {placeholders}: name college degree batch cgpa skills project linkedin github portfolio resume phone email
   company role contact applied_on. A line whose placeholder has no value is left out. */
export const DEFAULT_TEMPLATES: Templates = {
  email: {
    formal: {
      subject: "Application for {role} at {company} – {name}",
      body: `Dear Hiring Team,

I am {name}, a {degree} student at {college} (graduating {batch}), and I would like to apply for the {role} position at {company}.

My key skills include {skills}.
Recently, I worked on {project}.

Resume: {resume}
LinkedIn: {linkedin}
GitHub: {github}

I would welcome the opportunity to discuss how I can contribute to {company}. Thank you for your time and consideration.

Best regards,
{name}
{phone}
{email}`,
    },
    friendly: {
      subject: "{role} at {company} – {name}",
      body: `Hi {contact},

I hope you're doing well! I'm {name}, a {degree} student at {college} ({batch} batch). I saw the {role} opening at {company} and I'd love to be considered.

I work with {skills}, and recently built {project}.

Resume: {resume}
LinkedIn: {linkedin}

Happy to share anything else you need. Thanks a lot!

{name}
{phone}`,
    },
    short: {
      subject: "{role} – {name} ({college}, {batch})",
      body: `Hi {contact},

I'd like to apply for the {role} role at {company}. I'm a {degree} student at {college} ({batch}) skilled in {skills}.

Resume: {resume}

Thanks,
{name}
{phone}`,
    },
  },
  referral: {
    formal: {
      subject: "Referral request – {role} at {company}",
      body: `Hello {contact},

I hope you are doing well. I am {name}, a {degree} student at {college} ({batch} batch). I noticed the {role} opening at {company} and I am very interested in it.

Would you be willing to refer me for this role? I would be happy to share my resume and any details that would help.

Resume: {resume}
LinkedIn: {linkedin}

Thank you for considering my request.
{name}`,
    },
    friendly: {
      subject: "Referral for {role} at {company}?",
      body: `Hi {contact}! 👋

I'm {name} from {college} ({batch} batch). I came across the {role} opening at {company} and it looks like a great fit for me ({skills}).

Would you be open to referring me? I can send my resume and anything else you need.

Resume: {resume}

Thanks a ton for your time! 🙏
{name}`,
    },
    short: {
      subject: "Referral – {role}, {company}",
      body: `Hi {contact}, I'm {name} ({college}, {batch}). Could you refer me for the {role} role at {company}? Resume: {resume}
Thank you!`,
    },
  },
  followup: {
    formal: {
      subject: "Following up – {role} application ({name})",
      body: `Dear {contact},

I applied for the {role} position at {company} on {applied_on} and wanted to follow up on my application. I remain very interested in the role and would be glad to provide any further information.

Resume: {resume}

Thank you for your time.
Best regards,
{name}
{phone}`,
    },
    friendly: {
      subject: "Quick follow-up on {role} at {company}",
      body: `Hi {contact},

Just following up on my application for the {role} role at {company} (sent on {applied_on}). I'm still very excited about it and happy to share anything else you need.

Thanks!
{name}`,
    },
    short: {
      subject: "Follow-up: {role}",
      body: `Hi {contact}, following up on my {role} application at {company} from {applied_on}. Still very interested. Thanks! – {name}`,
    },
  },
};

const KEY = "templates_v1";
export const loadTemplates = (): Templates => {
  const saved = loadJSON<Partial<Templates>>(KEY, {});
  return {
    email: { ...DEFAULT_TEMPLATES.email, ...saved.email },
    referral: { ...DEFAULT_TEMPLATES.referral, ...saved.referral },
    followup: { ...DEFAULT_TEMPLATES.followup, ...saved.followup },
  };
};
export const saveTemplates = (t: Templates) => saveJSON(KEY, t);

export interface FillContext { company: string; role: string; contact: string; appliedOn: string }

export function values(p: Profile, c: FillContext): Record<string, string> {
  const skills = skillList(p).slice(0, 6).join(", ");
  const proj = p.projects[0];
  return {
    name: p.name, college: p.college, degree: p.degree, batch: p.batch, cgpa: p.cgpa, skills,
    project: proj ? `${proj.name}${proj.tech ? ` (${proj.tech})` : ""}` : "",
    linkedin: asUrl(p.linkedin), github: asUrl(p.github), portfolio: asUrl(p.portfolio), resume: asUrl(p.resumeLink),
    phone: p.phone, email: p.email,
    company: c.company || "your company", role: c.role || "open", contact: c.contact || "there",
    applied_on: c.appliedOn ? new Date(c.appliedOn).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "recently",
  };
}

/** Replace {placeholders}; drop lines whose placeholder is empty (e.g. no GitHub). */
export function fill(text: string, v: Record<string, string>): string {
  return text
    .split("\n")
    .filter((line) => !(line.match(/\{(\w+)\}/g) ?? []).some((m) => !(v[m.slice(1, -1)] ?? "").trim()))
    .map((line) => line.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NOREPLY = /no-?reply|donotreply|example\.(com|org)/i;
/** HR / careers email addresses written in the job post. */
export function findEmails(text: string): string[] {
  const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(found.map((e) => e.replace(/[.,;:]+$/, "")))].filter((e) => !NOREPLY.test(e));
}

export const gmailUrl = (to: string, subject: string, body: string) =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
export const mailtoUrl = (to: string, subject: string, body: string) =>
  `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const linkedinPeople = (keywords: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
export const achievementsOf = (p: Profile) => lines(p.achievements);

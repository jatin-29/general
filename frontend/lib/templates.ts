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

/** Ready-made situations (picked in the Apply kit); "standard" uses your own editable templates above. */
export interface Scenario { id: string; label: string; t: Template }
export const SCENARIOS: Record<Kind, Scenario[]> = {
  referral: [
    { id: "stack", label: "Referral with skills & projects", t: {
      subject: "{role} at {company} – Referral Request",
      body: `Hi {contact},

I'm {name}, a {degree} student at {college} ({batch} batch). I came across the {role} opening at {company} and I'm excited about it.

What I work with:
{skills_list}

A few things I've built:
{projects_list}

Resume: {resume}

If you feel I'm a good fit, would you be open to referring me? I'd also be glad to hear a little about how the team works.

Thanks for your time,
{name}
{linkedin}`,
    } },
    { id: "alumni", label: "College alumni", t: {
      subject: "{college} student – referral for {role} at {company}?",
      body: `Hi {contact},

I'm {name}, currently in {degree} at {college} ({batch} batch) – the same college you studied at. I saw the {role} opening at {company} and wanted to reach out to a fellow alum.

I work with {skills}, and recently built {project}.

Resume: {resume}

Would you be comfortable referring me, or pointing me to the right person? Any advice on the process would also mean a lot.

Thank you!
{name}
{linkedin}`,
    } },
    { id: "post", label: "After their LinkedIn post", t: {
      subject: "Loved your post – {role} at {company}",
      body: `Hi {contact},

I read your recent post on LinkedIn and really liked it. It also made me look more closely at {company}, and I noticed the {role} opening.

I'm {name}, a {degree} student at {college} ({batch}), working with {skills}. Recently I built {project}.

Resume: {resume}

Would you be open to referring me for this role? Happy to share anything else that helps.

Thanks,
{name}`,
    } },
    { id: "intern", label: "Internship referral", t: {
      subject: "Internship referral – {role} at {company}",
      body: `Hi {contact},

I'm {name}, a {degree} student at {college} (graduating {batch}). I'm looking for an internship and the {role} role at {company} fits what I want to learn.

Skills: {skills}
Project: {project}
Resume: {resume}

Could you refer me, or let me know who handles intern hiring? It would really help me.

Thank you,
{name}
{phone}`,
    } },
    { id: "switch", label: "Career switch", t: {
      subject: "Moving into {role} – referral at {company}?",
      body: `Hi {contact},

I'm {name} ({degree}, {college}). I'm moving into {role} work and have been building skills in {skills}, including {project}.

I saw the {role} opening at {company}. Would you be open to referring me, or sharing what the team looks for in people coming from a different background?

Resume: {resume}

Thanks a lot,
{name}`,
    } },
  ],
  email: [
    { id: "explore", label: "No open job (just exploring)", t: {
      subject: "Exploring opportunities at {company} – {name}",
      body: `Hi {contact},

I'm {name}, a {degree} student at {college} ({batch} batch). I don't see a matching opening right now, but I'd love to work at {company} and wanted to introduce myself.

I work with {skills}. Recently I built {project}.

Resume: {resume}
LinkedIn: {linkedin}

If anything opens up for a fresher or intern, I'd be grateful if you kept me in mind.

Best regards,
{name}
{phone}`,
    } },
    { id: "founder", label: "Startup founder / CTO", t: {
      subject: "Want to help build {company} – {name}",
      body: `Hi {contact},

I've been following {company} and I'd love to help build it. I'm {name}, a {degree} student at {college} ({batch}), and I'm comfortable owning work end to end.

What I bring: {skills}
Something I shipped: {project}
GitHub: {github}
Resume: {resume}

If you're hiring for {role} (or anything nearby), could we have a 10-minute call?

Thanks,
{name}
{phone}`,
    } },
    { id: "manager", label: "Engineering manager / tech lead", t: {
      subject: "{role} on your team at {company}",
      body: `Hi {contact},

I saw that {company} is hiring for {role} and wanted to reach out to you directly, since it looks like your team.

I'm {name} ({degree}, {college}, {batch}). I work with {skills}, and recently built {project}.

Resume: {resume}
GitHub: {github}

If you think I could be a fit, I'd appreciate a referral or a quick chat.

Best,
{name}`,
    } },
    { id: "freelance", label: "Freelance project", t: {
      subject: "Can I help with a project at {company}?",
      body: `Hi {contact},

I'm {name}, a {degree} student at {college}, and I take on freelance work in {skills}.

Recent work: {project}
Portfolio: {portfolio}
GitHub: {github}

If {company} has a project I could help with, I'd be happy to share a quick plan and timeline.

Thanks,
{name}
{phone}`,
    } },
  ],
  followup: [
    { id: "feedback", label: "After a rejection – ask for feedback", t: {
      subject: "Thank you – and a request for feedback ({role})",
      body: `Hi {contact},

Thank you for considering me for the {role} role at {company}. I'm disappointed, but I really enjoyed the process.

If you have a minute, could you share one or two things I could improve? It would help me a lot. I'd also love to be considered for future openings.

Thanks again,
{name}`,
    } },
    { id: "event", label: "After meeting at an event", t: {
      subject: "Great meeting you – {name}",
      body: `Hi {contact},

It was great meeting you at the event – thanks for taking the time to talk. As we discussed, I'm interested in the {role} role at {company}.

I'm {name} ({degree}, {college}, {batch}), working with {skills}.

Resume: {resume}

Would you be open to referring me, or connecting me with the right person?

Best,
{name}
{linkedin}`,
    } },
  ],
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
    skills_list: skillList(p).slice(0, 6).map((x) => `• ${x}`).join("\n"),
    projects_list: p.projects.filter((x) => x.name).slice(0, 3).map((x) => `• ${x.name}${x.link ? ` – ${asUrl(x.link)}` : ""}${lines(x.bullets)[0] ? `: ${lines(x.bullets)[0]}` : ""}`).join("\n"),
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

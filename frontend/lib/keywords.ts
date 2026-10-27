/** Skill keywords for "Tailor resume to this job" (no AI: a dictionary match). */
const TERMS = [
  // languages
  "python", "java", "javascript", "typescript", "c++", "c#", "c", "go", "golang", "rust", "kotlin", "swift", "php", "ruby", "scala", "r", "matlab", "dart", "sql", "bash", "shell",
  // web / mobile
  "html", "css", "react", "react.js", "next.js", "angular", "vue", "node.js", "express", "django", "flask", "fastapi", "spring", "spring boot", "graphql", "rest", "rest api", "tailwind", "redux", "flutter", "react native", "android", "ios",
  // data / ai
  "machine learning", "deep learning", "nlp", "computer vision", "pandas", "numpy", "scikit-learn", "tensorflow", "pytorch", "keras", "llm", "generative ai", "data analysis", "data analytics", "data visualization", "statistics", "excel", "power bi", "tableau", "spark", "hadoop", "etl", "a/b testing",
  // infra
  "aws", "azure", "gcp", "docker", "kubernetes", "linux", "git", "github", "ci/cd", "jenkins", "terraform", "microservices", "devops", "mysql", "postgresql", "mongodb", "redis", "firebase", "kafka",
  // cs basics
  "data structures", "algorithms", "dsa", "oops", "oop", "dbms", "operating systems", "computer networks", "system design", "problem solving",
  // other roles
  "figma", "ui/ux", "seo", "digital marketing", "content writing", "sales", "salesforce", "sap", "jira", "agile", "scrum", "testing", "selenium", "automation testing", "manual testing", "product management",
  // soft
  "communication", "teamwork", "leadership", "presentation",
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, term: string) => new RegExp(`(?<![\\w+#.])${esc(term)}(?![\\w+#])`, "i").test(text);

/** Skills asked for in the job post. */
export function jobKeywords(jobText: string): string[] {
  const found = TERMS.filter((t) => t.length > 1 && has(jobText, t));
  // prefer the longer form ("spring boot" over "spring", "react native" over "react")
  return found.filter((t) => !found.some((o) => o !== t && o.includes(t) && has(jobText, o)));
}

/** Different spellings of the same skill. */
const ALIASES: Record<string, string[]> = {
  "react.js": ["react", "reactjs"], react: ["react.js", "reactjs"], "node.js": ["node", "nodejs"], "next.js": ["nextjs", "next"],
  golang: ["go"], go: ["golang"], oops: ["oop", "object oriented"], oop: ["oops", "object oriented"], dsa: ["data structures", "algorithms"],
  "data structures": ["dsa"], postgresql: ["postgres"], "rest api": ["rest", "restful"], rest: ["rest api", "restful"],
  "machine learning": ["ml"], "deep learning": ["dl"], "generative ai": ["genai", "gen ai"], "ui/ux": ["ui", "ux"], "ci/cd": ["cicd"],
  javascript: ["js"], typescript: ["ts"], kubernetes: ["k8s"], "scikit-learn": ["sklearn"], "power bi": ["powerbi"],
};

export function matchKeywords(jobText: string, resumeText: string) {
  const wanted = jobKeywords(jobText);
  const matched = wanted.filter((k) => [k, ...(ALIASES[k] ?? [])].some((a) => has(resumeText, a)));
  const missing = wanted.filter((k) => !matched.includes(k));
  return { wanted, matched, missing, score: wanted.length ? Math.round((matched.length / wanted.length) * 100) : null };
}

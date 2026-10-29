// OpeningsHub Autofill: fills job application forms (Google Forms, Workday, Greenhouse, Lever, career pages)
// with the details saved on your OpeningsHub "My profile" page. It never submits: you check and press Submit.
// Loaded as a content script on known job sites (adds the ⚡ button) and injected on demand everywhere else.
(() => {
  if (globalThis.__ohFill) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9%+]+/g, " ").trim();
  const compact = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9+]/g, "");
  const textOf = (n) => (n ? n.innerText || n.textContent || "" : "").replace(/\s+/g, " ").trim();
  const asUrl = (s) => (!s ? "" : /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`);

  // ---------------------------------------------------------------- your details, in the shapes forms ask for
  function details(p) {
    const words = (p.name || "").trim().split(/\s+/).filter(Boolean);
    const loc = (p.location || "").split(",").map((s) => s.trim()).filter(Boolean);
    const digits = (p.phone || "").replace(/\D/g, "");
    const national = digits.length > 10 ? digits.slice(-10) : digits;
    const country = p.country || (loc.length > 1 ? loc[loc.length - 1] : "");
    const code = digits.length > 10 ? `+${digits.slice(0, -10)}` : !country || /india/i.test(country) ? "+91" : "";
    const deg = (p.degree || "").match(/^(.+?)\s+in\s+(.+)$/i) || (p.degree || "").match(/^(.+?)\s*[-–(,]\s*(.+?)\)?$/);
    const edu = p.education || [];
    const twelfth = edu.find((e) => /\b(12th|xii|12|hsc|intermediate|senior secondary|higher secondary|puc)\b/i.test(`${e.degree} ${e.school}`)) || {};
    const tenth = edu.find((e) => e !== twelfth && /\b(10th|x|10|ssc|matric\w*|secondary)\b/i.test(`${e.degree} ${e.school}`)) || {};
    const board = (e) => {
      const m = (`${e.degree || ""} ${e.school || ""}`.match(/\b(cbse|icse|isc|igcse|ib|nios|[a-z]+ board)\b/i) || [""])[0];
      return m.length <= 5 ? m.toUpperCase() : m;
    };
    const current = (p.experience || []).find((x) => x.company && (!x.end || /present|current|now|till/i.test(x.end))) || {};
    return {
      fullName: words.join(" "),
      firstName: words.length > 1 ? words.slice(0, -1).join(" ") : words[0] || "",
      lastName: words.length > 1 ? words[words.length - 1] : "",
      email: p.email,
      phone: national,
      phoneFull: national && `${code}${national}`,
      countryCode: code,
      phoneType: national && "Mobile",
      address: p.address || p.location,
      city: loc[0] || "",
      state: p.state,
      country,
      pincode: p.pincode,
      dob: p.dob,
      gender: p.gender,
      college: p.college,
      degree: p.degree,
      degreeShort: deg ? deg[1] : p.degree,
      branch: deg ? deg[2] : "",
      batch: p.batch,
      cgpa: p.cgpa,
      tenthScore: tenth.score, tenthYear: tenth.year, tenthBoard: board(tenth), tenthSchool: tenth.school,
      twelfthScore: twelfth.score, twelfthYear: twelfth.year, twelfthBoard: board(twelfth), twelfthSchool: twelfth.school,
      skills: p.skills,
      linkedin: asUrl(p.linkedin),
      github: asUrl(p.github),
      portfolio: asUrl(p.portfolio),
      resumeLink: p.resumeLink,
      summary: p.summary,
      experience: p.experienceYears,
      currentCompany: current.company,
      currentRole: current.role,
      currentCtc: p.currentCtc,
      expectedCtc: p.expectedCtc,
      noticePeriod: p.noticePeriod,
      relocate: p.relocate,
    };
  }
  // Other values worth trying when a dropdown has no option for the first one.
  const ALTS = { degree: ["degreeShort"], countryCode: ["country"], phoneFull: ["phone"] };

  // ---------------------------------------------------------------- which detail a question asks for
  // Questions that are never filled from the profile (unless you added a saved answer for them).
  const NEVER = /father|mother|guardian|parent|spouse|emergency|\breferr|\breferen|recruiter|hiring manager|captcha|password|\botp\b|verification|preferred (first )?name|\bextension\b|preferred (job )?location|hear about|cover letter|\bwhy\b|year of study|current year|semester|middle name|signature|aadha+r|\bpan\b|passport|\buan\b|\bssn\b|social security|roll (no|number)|registration (no|number)|enrol+ment/;
  // [detail, pattern]: the first match wins, so specific questions come before general ones.
  const RULES = [
    ["phoneFull", /(phone|mobile|whats ?app|contact).*(country code|with code)|international (phone|number)/],
    ["countryCode", /country (phone )?code|dial(ling)? code|\bisd\b|phone code/],
    ["phoneType", /device type|phone type/],
    ["email", /e ?mail/],
    ["firstName", /first name|given name|fore ?name|\bfname\b/],
    ["lastName", /last name|surname|family name|\blname\b/],
    ["linkedin", /linked ?in/],
    ["github", /git ?hub/],
    ["resumeLink", /(resume|cv)\b.*\b(link|url|drive)|(link|url|drive)\b.*\b(resume|cv)\b/],
    ["portfolio", /portfolio|personal (web ?)?site|\bwebsite\b|\bblog\b/],
    ["phone", /phone|mobile|contact (no|num)|whats ?app|\bcell\b|\btel\b/],
    ["dob", /date of birth|\bdob\b|birth ?date|birthday|\bbday\b/],
    ["gender", /gender|\bsex\b/],
    ["batch", /graduat\w* (year|date)|year of (passing|graduation|completion)|pass(ing)? ?out|\bbatch\b|completion year/],
    ["cgpa", /cgpa|\bgpa\b|grade point|aggregate|percentage|\bmarks\b|\bscore\b/],
    ["branch", /branch|stream|speciali[sz]ation|\bmajor\b|field of study|discipline|department/],
    ["degree", /degree|qualification|\bcourse\b|programme|\bprogram\b/],
    ["college", /college|universit|institut|\bschool\b|alma mater/],
    ["noticePeriod", /notice period|how soon|when can you (join|start)|availability to join|joining (time|date)|earliest (start|joining)/],
    ["expectedCtc", /expected (ctc|salary|compensation|stipend|pay)|salary expectation|desired (salary|pay|ctc)/],
    ["currentCtc", /current (ctc|salary|compensation|stipend|pay)|present (ctc|salary)/],
    ["experience", /years of (work |relevant )?experience|total (work )?experience|experience in years|experience (years|yrs)|how many years|\bexperience\b.*\byears?\b/],
    ["currentCompany", /current (company|employer|organi[sz]ation)|present (company|employer)|company name|\bemployer\b/],
    ["currentRole", /current (role|designation|title|position)|\bdesignation\b|job title/],
    ["relocate", /relocat/],
    ["skills", /\bskills?\b|technolog|tech stack|programming languages/],
    ["pincode", /pin ?code|postal|\bzip\b/],
    ["address", /address|street/],
    ["state", /\bstate\b|province/],
    ["country", /\bcountry\b/],
    ["city", /\bcity\b|current location|\blocation\b|\btown\b|where are you (based|located)|place of residence/],
    ["summary", /about (yourself|you)|introduce yourself|\bsummary\b|\bbio\b|describe yourself/],
    ["fullName", /\bname\b|candidate|applicant/],
  ];

  /** 10th / 12th questions: "12th %", "Class X board", "HSC passing year"... */
  function schoolLevel(t) {
    const lvl = /\b(12 ?th|xii|class 12|std 12|hsc|intermediate|senior secondary|higher secondary|puc)\b/.test(t)
      ? "twelfth"
      : /\b(10 ?th|class 10|std 10|ssc|matric\w*|high school|class x)\b/.test(t) || /\bx\b.*(%|percent|marks|score|cgpa|board|school|year)/.test(t)
        ? "tenth"
        : "";
    if (!lvl) return undefined;
    if (/year|passing|pass ?out/.test(t)) return `${lvl}Year`;
    if (/board/.test(t)) return `${lvl}Board`;
    if (/school|institut|college|name/.test(t)) return `${lvl}School`;
    return `${lvl}Score`;
  }

  /** A detail name, { answer } for a saved answer, null = leave alone, undefined = this text says nothing. */
  function classify(t, answers) {
    if (!t) return undefined;
    for (const a of answers) if (t.includes(a.q)) return { answer: a.a };
    if (NEVER.test(t)) return null;
    const lvl = schoolLevel(t);
    if (lvl) return lvl;
    for (const [key, re] of RULES) if (re.test(t)) return key;
    return undefined;
  }

  // ---------------------------------------------------------------- reading the page
  const FIELD = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea, select, [role=listbox], [role=radiogroup], [role=combobox], button[aria-haspopup=listbox]";
  const LABELISH = "[role=heading], legend, label, h1, h2, h3, h4, h5, h6";

  /** The page plus any open shadow roots (some career sites are built from web components). */
  function roots() {
    const out = [document];
    const walk = (root) => {
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) { out.push(el.shadowRoot); walk(el.shadowRoot); }
    };
    walk(document);
    return out;
  }
  const all = (sel) => roots().flatMap((r) => [...r.querySelectorAll(sel)]);

  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  };

  /** The question around a field: the heading/label in the nearest box that holds only this field. */
  function questionText(unit, same = () => false) {
    let node = unit;
    for (let i = 0; i < 6 && node.parentElement; i++) {
      const p = node.parentElement;
      const others = [...p.querySelectorAll(FIELD)].some((f) => f !== unit && !unit.contains(f) && !f.contains(unit) && !same(f));
      if (others) break;
      node = p;
      const h = [...p.querySelectorAll(LABELISH)].find((x) => !unit.contains(x) && !/radio|checkbox/.test(x.control?.type || "") && textOf(x));
      if (h) return textOf(h);
    }
    if (node === unit) return "";
    const own = textOf(unit);
    return (own ? textOf(node).replace(own, "") : textOf(node)).slice(0, 200);
  }

  /** Everything that names a field, most trustworthy first. */
  function names(el, unit = el, same) {
    const root = el.getRootNode();
    const byId = (id) => (root.getElementById && root.getElementById(id)) || document.getElementById(id);
    const by = unit.getAttribute("aria-labelledby") || el.getAttribute("aria-labelledby");
    return [
      by && by.split(/\s+/).map((id) => textOf(byId(id))).join(" "),
      el.labels && [...el.labels].map(textOf).join(" "),
      unit.getAttribute("aria-label") || el.getAttribute("aria-label"),
      questionText(unit, same),
      el.getAttribute("placeholder"),
      el.getAttribute("data-automation-id"),
      el.getAttribute("name"),
      el.id,
      el.getAttribute("autocomplete"),
    ].map(norm).filter(Boolean);
  }

  // ---------------------------------------------------------------- changing the page
  /** Set a value the way typing does, so React / Angular forms notice it. */
  function setValue(el, v) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    el.focus();
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }
  function press(el) {
    const o = { bubbles: true, cancelable: true };
    el.dispatchEvent(new PointerEvent("pointerdown", o));
    el.dispatchEvent(new MouseEvent("mousedown", o));
    el.dispatchEvent(new PointerEvent("pointerup", o));
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.click();
  }
  const key = (el, k) => ["keydown", "keyup"].forEach((type) => el.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true })));
  const mark = (el, color) => {
    el.style.outline = `2px solid ${color}`;
    el.style.outlineOffset = "1px";
  };
  const GREEN = "#22c55e";
  const AMBER = "#f59e0b";

  /** Best option for any of the values: exact > starts with > is the start of > contains. */
  const isPlaceholder = (t) => !compact(t) || /^(select|choose|please|none|--)/i.test(t.trim());
  function best(options, values) {
    let top = null;
    for (const v of values) {
      const b = compact(v);
      if (!b) continue;
      for (const o of options) {
        if (isPlaceholder(o.text)) continue;
        const a = compact(o.text);
        const score = a === b ? 4 : a.startsWith(b) ? 3 : b.startsWith(a) ? 2 : b.length >= 3 && a.includes(b) ? 1 : 0;
        if (score > (top?.score || 0)) top = { ...o, score };
      }
      if (top) return top;
    }
    return null;
  }

  /** Shape a value for this particular box (dates, number-only boxes, length limits). */
  function fit(el, k, v) {
    v = String(v).trim();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (k === "dob") {
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return type === "date" ? "" : v;
      if (type === "date") return v;
      const hint = norm(`${el.getAttribute("placeholder") || ""} ${names(el).join(" ")}`);
      return /mm dd/.test(hint) ? `${m[2]}/${m[3]}/${m[1]}` : /yyyy mm/.test(hint) ? v : `${m[3]}/${m[2]}/${m[1]}`;
    }
    if (type === "number") v = (v.match(/\d+(\.\d+)?/) || [""])[0];
    if (el.maxLength > 0 && v.length > el.maxLength) v = v.slice(0, el.maxLength);
    return v;
  }

  // ---------------------------------------------------------------- one run
  let busy = false;

  async function run({ toast = false } = {}) {
    if (busy) return { busy: true, filled: 0, needs: 0 };
    busy = true;
    try {
      const { profile, resume } = await chrome.storage.local.get(["profile", "resume"]);
      if (!profile) return { noProfile: true, filled: 0, needs: 0 };
      const d = details(profile);
      const answers = (profile.answers || []).map((a) => ({ q: norm(a.q), a: a.a })).filter((a) => a.q && a.a);
      const pick = (texts) => {
        for (const t of texts) {
          const r = classify(t, answers);
          if (r !== undefined) return r;
        }
        return null;
      };
      const valuesFor = (r) => (typeof r === "object" ? [r.answer] : [d[r], ...(ALTS[r] || []).map((k) => d[k])]).filter(Boolean).map(String);

      let filled = 0;
      const later = [];
      const groups = new Map();
      for (const el of all(FIELD)) {
        if (el.disabled || el.readOnly || el.closest("[aria-hidden=true], #oh-autofill-host")) continue;
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (el.tagName === "INPUT" && type === "radio") {
          const id = el.name || el.closest("fieldset, [role=radiogroup]");
          if (id && (visible(el) || visible(el.labels?.[0]))) groups.set(id, [...(groups.get(id) || []), el]);
          continue;
        }
        if (el.tagName === "INPUT" && /checkbox|file|password|range|color/.test(type)) continue;
        if (!visible(el)) continue;
        const role = el.getAttribute("role");
        if (role === "radiogroup") {
          if (el.querySelector("input[type=radio]") || el.querySelector("[role=radio][aria-checked=true]")) continue;
          const opts = [...el.querySelectorAll("[role=radio]")].map((o) => ({ el: o, text: o.getAttribute("aria-label") || o.getAttribute("data-value") || textOf(o) }));
          const r = pick(names(el));
          const o = r && best(opts, valuesFor(r));
          if (o) { press(o.el); mark(el, GREEN); filled++; }
          continue;
        }
        if (role === "combobox" || role === "listbox" || el.matches("button[aria-haspopup=listbox]")) {
          if (role === "listbox" && !el.querySelector("[role=option][data-value]") && !el.hasAttribute("aria-expanded")) continue;
          later.push(el);
          continue;
        }
        if (el.tagName === "SELECT") {
          const cur = el.options[el.selectedIndex];
          if (cur && el.value && !isPlaceholder(cur.text)) continue;
          const r = pick(names(el));
          const opts = [...el.options].filter((o) => !o.disabled).map((o) => ({ el: o, text: o.text || o.value }));
          const o = r && best(opts, valuesFor(r));
          if (o) { setValue(el, o.el.value); mark(el, GREEN); filled++; }
          continue;
        }
        if (el.value.trim()) continue; // never overwrite what's already there
        const r = pick(names(el));
        if (!r) continue;
        const v = valuesFor(r)[0];
        const shaped = v && fit(el, typeof r === "string" ? r : "", v);
        if (shaped) { setValue(el, shaped); mark(el, GREEN); filled++; }
      }

      // Native radio buttons: one question per group.
      for (const radios of groups.values()) {
        if (radios.some((r) => r.checked)) continue;
        const box = radios[0].closest("fieldset, [role=radiogroup]") || radios[0];
        const same = (f) => radios.includes(f);
        const legend = box.querySelector?.("legend");
        const r = pick([legend && norm(textOf(legend)), ...names(radios[0], box, same).filter((t) => !radios.some((x) => norm(textOf(x.labels?.[0])) === t))].filter(Boolean));
        const opts = radios.map((x) => ({ el: x, text: textOf(x.labels?.[0]) || x.getAttribute("aria-label") || x.value }));
        const o = r && best(opts, valuesFor(r));
        if (o) { o.el.click(); mark(box === radios[0] ? o.el : box, GREEN); filled++; }
      }

      // Dropdowns that open a list (Google Forms, Workday, React selects): one at a time.
      for (const el of later) {
        if (!dropdownEmpty(el)) continue;
        const r = pick(names(el));
        const vals = r ? valuesFor(r) : [];
        if (vals.length && (await choose(el, vals))) { mark(el, GREEN); filled++; }
      }

      const resumeDone = await attachResume(resume);

      // Required boxes still empty: yours to answer.
      let needs = 0;
      for (const el of all(FIELD)) {
        if (!visible(el) || el.disabled || el.closest("#oh-autofill-host")) continue;
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (/radio|checkbox|file/.test(type) || el.getAttribute("role") === "radiogroup") continue;
        const required = el.required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(textOf(el.labels?.[0]));
        const empty = el.matches("input, textarea") ? !el.value.trim() : el.tagName === "SELECT" ? isPlaceholder(el.options[el.selectedIndex]?.text || "") : dropdownEmpty(el);
        if (required && empty) { mark(el, AMBER); needs++; }
      }

      const result = { filled, needs, resume: resumeDone };
      if (toast && (filled || needs || resumeDone)) showToast(result);
      return result;
    } finally {
      busy = false;
    }
  }

  function dropdownEmpty(t) {
    if (t.matches("input")) {
      if (t.value.trim()) return false;
      const shown = textOf(t.closest("[class*=control], [class*=container]") || t.parentElement);
      return !shown || isPlaceholder(shown) || /^(search|type)/i.test(shown);
    }
    const sel = t.querySelector("[role=option][aria-selected=true]");
    if (sel) return isPlaceholder(sel.getAttribute("data-value") || "") && isPlaceholder(textOf(sel));
    return isPlaceholder(textOf(t));
  }

  function optionsFor(t) {
    const ids = `${t.getAttribute("aria-controls") || ""} ${t.getAttribute("aria-owns") || ""}`.split(/\s+/).filter(Boolean);
    const scopes = ids.map((id) => document.getElementById(id)).filter(Boolean);
    let opts = scopes.flatMap((s) => [...s.querySelectorAll("[role=option]")]);
    if (!opts.length) opts = all("[role=option]");
    return opts.filter(visible).map((o) => ({ el: o, text: o.getAttribute("data-value") || o.getAttribute("aria-label") || textOf(o) }));
  }

  /** Open a dropdown, pick the matching option, or close it again if there is none. */
  async function choose(t, vals) {
    const typing = t.matches("input");
    t.scrollIntoView({ block: "center" });
    t.focus();
    if (typing) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(t, vals[0]);
      t.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      press(t);
    }
    let o = null;
    for (let i = 0; i < 10 && !o; i++) {
      await sleep(150);
      o = best(optionsFor(t), vals);
    }
    if (o) {
      press(o.el);
      await sleep(200);
      return true;
    }
    if (typing) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(t, "");
      t.dispatchEvent(new Event("input", { bubbles: true }));
    }
    key(t, "Escape");
    t.blur();
    await sleep(100);
    return false;
  }

  /** Put your resume PDF into the "Resume / CV" upload box. */
  async function attachResume(resume) {
    if (!resume?.data) return false;
    const inputs = all("input[type=file]").filter((i) => !i.disabled && !i.files?.length);
    const named = inputs.map((i) => ({ i, t: names(i).join(" ") }));
    let target = named.find((x) => /resume|\bcv\b|curriculum/.test(x.t) && !/cover/.test(x.t));
    if (!target && named.length === 1 && !/cover|photo|picture|image|transcript|certificate|marksheet|proof/.test(named[0].t)) target = named[0];
    if (!target) return false;
    const bytes = Uint8Array.from(atob(resume.data), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], resume.name, { type: resume.type || "application/pdf" }));
    target.i.files = dt.files;
    target.i.dispatchEvent(new Event("input", { bubbles: true }));
    target.i.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // ---------------------------------------------------------------- the ⚡ button and messages on the page
  const STYLE = `
    :host { all: initial; }
    .box { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; font: 600 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .row { display: flex; align-items: center; gap: 4px; }
    .go { border: 0; cursor: pointer; color: #fff; padding: 10px 16px; border-radius: 999px; font: inherit; font-weight: 800;
          background: linear-gradient(135deg, #ff8fb8, #c26bff 55%, #7c3aed); box-shadow: 0 8px 24px rgba(124, 58, 237, .35); }
    .go:hover { filter: brightness(1.06); transform: translateY(-1px); }
    .go:disabled { opacity: .7; cursor: progress; }
    .x { border: 0; cursor: pointer; width: 24px; height: 24px; border-radius: 999px; background: rgba(15, 23, 42, .55); color: #fff; font: inherit; }
    .msg { max-width: 280px; padding: 10px 12px; border-radius: 14px; background: #fff; color: #1e1b4b; box-shadow: 0 10px 30px rgba(30, 27, 75, .2); }
    .msg b { color: #16a34a; } .msg i { color: #b45309; font-style: normal; }
  `;
  let host = null;
  let box = null;

  function ensureBox() {
    if (host?.isConnected) return box;
    host = document.createElement("div");
    host.id = "oh-autofill-host";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>${STYLE}</style><div class="box"></div>`;
    box = shadow.querySelector(".box");
    document.documentElement.appendChild(host);
    return box;
  }

  function describe(r) {
    if (r.noProfile) return "Open <b>My profile</b> on your OpeningsHub site once, so the extension gets your details.";
    const parts = [`<b>Filled ${r.filled} field${r.filled === 1 ? "" : "s"}</b>${r.resume ? " + resume" : ""}.`];
    if (r.needs) parts.push(`<i>${r.needs} required field${r.needs === 1 ? " needs" : "s need"} you</i> (yellow).`);
    else if (!r.filled && !r.resume) parts.push("Nothing here matched your profile.");
    parts.push("Check everything, then submit.");
    return parts.join(" ");
  }

  function showToast(r, ms = 6000) {
    const b = ensureBox();
    const msg = document.createElement("div");
    msg.className = "msg";
    msg.innerHTML = `⚡ ${describe(r)}`;
    b.prepend(msg);
    setTimeout(() => msg.remove(), ms);
  }

  function mountButton() {
    const b = ensureBox();
    if (b.querySelector(".go")) return;
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<button class="x" title="Hide on this page">×</button><button class="go" title="Fill this form from your OpeningsHub profile">⚡ Autofill</button>`;
    const go = row.querySelector(".go");
    go.onclick = async () => {
      go.disabled = true;
      go.textContent = "Filling…";
      try {
        showToast(await run());
      } catch {
        showToast({ filled: 0, needs: 0 });
      } finally {
        go.disabled = false;
        go.textContent = "⚡ Autofill";
      }
    };
    row.querySelector(".x").onclick = () => row.remove();
    b.append(row);
  }

  /** Show the button once the page has a form (many job sites draw it late). */
  async function watchForForms() {
    const { showButton } = await chrome.storage.local.get("showButton");
    if (showButton === false) return;
    const hasForm = () => all(FIELD).filter((el) => visible(el) && !el.closest("#oh-autofill-host")).length >= 2;
    if (hasForm()) return mountButton();
    let timer = null;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => hasForm() && (obs.disconnect(), mountButton()), 600);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  globalThis.__ohFill = { run };
  if (!globalThis.__ohOnDemand) {
    watchForForms().catch(() => {});
    chrome.storage.onChanged.addListener((c) => {
      if (c.showButton?.newValue === false) host?.remove();
      if (c.showButton?.newValue === true) watchForForms().catch(() => {});
    });
  }
})();

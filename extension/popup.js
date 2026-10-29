import { fillTab } from "./inject.js";

const SITE = "https://jatin-29.github.io/general/profile/";
const MAX_RESUME = 5 * 1024 * 1024;
const $ = (id) => document.getElementById(id);

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const needYou = (n) => `${n} required field${n === 1 ? " needs" : "s need"} you (yellow).`;
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function say(text, kind = "") {
  $("result").hidden = false;
  $("result").className = `result ${kind}`;
  $("result").textContent = text;
}

async function render() {
  const { profile, syncedAt, resume, showButton } = await chrome.storage.local.get(["profile", "syncedAt", "resume", "showButton"]);
  $("who").textContent = profile?.name ? `${profile.name} · synced ${ago(syncedAt)}` : "Not connected";
  $("connect").hidden = !!profile;
  $("resume-name").textContent = resume ? `${resume.name} (${size(resume.size)})` : "No file yet";
  $("pick").textContent = resume ? "Change" : "Choose PDF";
  $("remove").hidden = !resume;
  $("show").checked = showButton !== false;
}

$("open-site").href = SITE;
$("edit").href = SITE;
chrome.commands.getAll().then((cmds) => {
  const k = cmds.find((c) => c.name === "fill-page")?.shortcut;
  $("keys").textContent = k || "not set (chrome://extensions/shortcuts)";
});

$("fill").onclick = async () => {
  const btn = $("fill");
  btn.disabled = true;
  btn.textContent = "Filling…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const r = await fillTab(tab.id);
    if (r.noProfile) say("Your details aren't here yet: open My profile on your site once, then try again.", "warn");
    else if (!r.filled && !r.resume) say(r.needs ? `Nothing matched your profile. ${needYou(r.needs)}` : "No form fields matched your profile on this page.", "warn");
    else say(`Filled ${r.filled} field${r.filled === 1 ? "" : "s"}${r.resume ? " + resume" : ""}.${r.needs ? ` ${needYou(r.needs)}` : ""} Check, then submit.`, r.needs ? "warn" : "");
  } catch {
    say("Chrome doesn't let extensions fill this page (chrome:// pages and the Web Store are off-limits).", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ Fill this page";
  }
};

$("pick").onclick = () => $("file").click();
$("file").onchange = async () => {
  const f = $("file").files?.[0];
  if (!f) return;
  if (f.size > MAX_RESUME) return say("That file is over 5 MB. Most forms want a smaller resume anyway.", "err");
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await chrome.storage.local.set({ resume: { name: f.name, type: f.type || "application/pdf", size: f.size, data: btoa(bin) } });
  say(`Saved ${f.name}. It goes into "Resume / CV" upload boxes.`);
  render();
};
$("remove").onclick = async () => {
  await chrome.storage.local.remove("resume");
  render();
};
$("show").onchange = () => chrome.storage.local.set({ showButton: $("show").checked });

render();

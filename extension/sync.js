// Runs on your OpeningsHub site: copies the details you saved on "My profile" into the extension.
// They stay in this browser; the extension never sends them anywhere.
(() => {
  const KEY = "profile_v1"; // same key the site uses (frontend/lib/profile.ts)
  let last = null;
  const sync = () => {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {}
    if (!raw || raw === last) return;
    try {
      chrome.storage.local.set({ profile: JSON.parse(raw), syncedAt: Date.now() });
      last = raw;
    } catch {} // extension was reloaded or updated: this old copy of the script just stops
  };
  // Lets the profile page show "Extension connected".
  document.documentElement.dataset.ohExtension = chrome.runtime.getManifest().version;
  window.dispatchEvent(new Event("openingshub:extension"));
  sync();
  window.addEventListener("openingshub:profile", () => setTimeout(sync, 0));
  setInterval(sync, 3000);
})();

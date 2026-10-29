import { fillTab } from "./inject.js";

// Keyboard shortcut (Alt+Shift+F by default): fill the page you're on.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "fill-page" || !tab?.id) return;
  try {
    const r = await fillTab(tab.id);
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: r.needs ? "#f59e0b" : "#22c55e" });
    await chrome.action.setBadgeText({ tabId: tab.id, text: String(r.filled) });
  } catch {
    await chrome.action.setBadgeText({ tabId: tab.id, text: "×" }).catch(() => {});
  }
});

self.fillTab = fillTab; // handy from the service worker console

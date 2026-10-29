// Fill every frame of a tab we're allowed into, and add up what happened.
export async function fillTab(tabId) {
  let target = { tabId, allFrames: true };
  const inject = async () => {
    await chrome.scripting.executeScript({ target, func: () => { globalThis.__ohOnDemand = true; } });
    await chrome.scripting.executeScript({ target, files: ["fill.js"] });
  };
  try {
    await inject();
  } catch {
    target = { tabId }; // some frames refused: the main page alone
    await inject();
  }
  const runs = await chrome.scripting.executeScript({ target, func: () => globalThis.__ohFill?.run({ toast: true }) });
  return runs.map((r) => r.result).filter(Boolean).reduce(
    (sum, r) => ({
      filled: sum.filled + (r.filled || 0),
      needs: sum.needs + (r.needs || 0),
      resume: sum.resume || !!r.resume,
      noProfile: sum.noProfile || !!r.noProfile,
    }),
    { filled: 0, needs: 0, resume: false, noProfile: false },
  );
}

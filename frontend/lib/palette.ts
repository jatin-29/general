/** Picks two accent colours from album art and applies them as CSS variables. */
export type RGB = [number, number, number];
export interface Palette {
  accent: RGB;
  light: RGB;
  dark: RGB;
  accent2: RGB;
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** From raw RGBA pixels: favour vivid, mid-brightness colours; ignore greys, near-black and near-white. */
export function paletteFromPixels(data: ArrayLike<number>): Palette | null {
  const buckets = Array.from({ length: 24 }, () => ({ w: 0, h: 0, s: 0 })); // 15° hue buckets
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const [h, s, l] = rgbToHsl([data[i], data[i + 1], data[i + 2]]);
    if (s < 0.25 || l < 0.12 || l > 0.9) continue;
    const w = s * (1 - Math.abs(l - 0.5));
    const bk = buckets[Math.floor(h / 15) % 24];
    bk.w += w; bk.h += h * w; bk.s += s * w;
  }
  const ranked = buckets.map((b, i) => ({ ...b, i })).filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  if (!ranked.length) return null;
  const hue = (b: (typeof ranked)[number]) => b.h / b.w;
  const first = ranked[0];
  const h1 = hue(first);
  const second = ranked.find((b) => {
    const d = Math.abs(hue(b) - h1);
    return Math.min(d, 360 - d) >= 50;
  });
  const h2 = second ? hue(second) : h1 + 150;
  const s1 = Math.min(0.9, Math.max(0.55, first.s / first.w));
  return {
    accent: hslToRgb(h1, s1, 0.6),
    light: hslToRgb(h1, s1, 0.72),
    dark: hslToRgb(h1, s1, 0.48),
    accent2: hslToRgb(h2, 0.75, 0.6),
  };
}

export async function paletteFromImage(url: string): Promise<Palette | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  await new Promise<void>((ok, fail) => {
    img.onload = () => ok();
    img.onerror = () => fail(new Error("image failed"));
    img.src = url;
  });
  const c = document.createElement("canvas");
  c.width = c.height = 40;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, 40, 40);
  return paletteFromPixels(ctx.getImageData(0, 0, 40, 40).data); // throws if the image is cross-origin tainted
}

const VARS: [string, keyof Palette][] = [
  ["--accent", "accent"],
  ["--accent-light", "light"],
  ["--accent-dark", "dark"],
  ["--accent-2", "accent2"],
];

export function applyPalette(p: Palette | null) {
  const root = document.documentElement.style;
  for (const [name, key] of VARS) {
    if (p) root.setProperty(name, (p[key] as RGB).join(" "));
    else root.removeProperty(name);
  }
}

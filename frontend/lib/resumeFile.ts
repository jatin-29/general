/** Read the text out of a resume (PDF, Word .docx or .txt) in the browser. The file never leaves the device. */

export interface ResumeText {
  lines: string[]; // in reading order; a wide gap inside a line becomes 3 spaces ("DTU   2022 – 2026")
  links: string[]; // web links behind clickable text (e.g. "LinkedIn")
}

/** A file we can't read; its message is meant for the user. */
export class UnsupportedFile extends Error {
  readonly friendly = true;
}

export async function readResume(file: File): Promise<ResumeText> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return readPdf(await file.arrayBuffer());
  if (name.endsWith(".docx")) return readDocx(await file.arrayBuffer());
  if (name.endsWith(".txt") || file.type === "text/plain") return { lines: (await file.text()).split(/\r?\n/).map(clean).filter(Boolean), links: [] };
  throw new UnsupportedFile(name.endsWith(".doc") ? "Old .doc files can't be read: save it as PDF or .docx" : "Use a PDF or Word (.docx) file");
}

/** Tidy one line: bullets to "• ", ligatures, odd spaces; keep wide gaps as 3 spaces. */
function clean(line: string) {
  return line
    .replace(/[  -  ]/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl").replace(/ﬀ/g, "ff")
    .replace(/^\s*[•●▪◦‣∙·➢➤►✓✔■*]\s*/, "• ")
    .replace(/ {3,}/g, "\u0000").replace(/ {2}/g, " ").replace(/\u0000/g, "   ")
    .trim();
}

// ------------------------------------------------------------------ PDF
async function readPdf(data: ArrayBuffer): Promise<ResumeText> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const lines: string[] = [];
  const links = new Set<string>();
  for (let n = 1; n <= Math.min(doc.numPages, 6); n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    // Text comes in pieces; put pieces on the same baseline back into one line, left to right.
    const rows: { y: number; parts: { x: number; w: number; s: string; h: number }[] }[] = [];
    for (const it of items) {
      if (!("str" in it) || !it.str.trim()) continue; // gaps are measured below, so a wide gap isn't lost in one long space
      const x = it.transform[4];
      const y = it.transform[5];
      const h = it.height || Math.abs(it.transform[3]) || 10;
      let row = rows.find((r) => Math.abs(r.y - y) < h * 0.45);
      if (!row) rows.push((row = { y, parts: [] }));
      row.parts.push({ x, w: it.width, s: it.str, h });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) {
      row.parts.sort((a, b) => a.x - b.x);
      let line = "";
      let end = -Infinity;
      for (const p of row.parts) {
        const gap = p.x - end;
        if (line && !/\s$/.test(line) && !/^\s/.test(p.s) && gap > p.h * 0.12) line += gap > p.h * 1.5 ? "   " : " ";
        line += p.s;
        end = p.x + p.w;
      }
      lines.push(line);
    }
    for (const a of await page.getAnnotations()) if (typeof a.url === "string") links.add(a.url);
  }
  await doc.destroy();
  return { lines: lines.map(clean).filter(Boolean), links: [...links] };
}

// ------------------------------------------------------------------ Word (.docx is a zip of XML files)
async function unzip(buf: ArrayBuffer, path: string): Promise<string | null> {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  let p = v.getUint32(eocd + 16, true);
  for (let k = v.getUint16(eocd + 10, true); k > 0; k--) {
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    if (name === path) {
      const local = v.getUint32(p + 42, true);
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const bytes = u8.slice(start, start + size);
      if (method === 0) return new TextDecoder().decode(bytes);
      if (method !== 8) return null;
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
      return new Response(stream).text();
    }
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return null;
}

async function readDocx(buf: ArrayBuffer): Promise<ResumeText> {
  const xml = await unzip(buf, "word/document.xml");
  if (!xml) throw new UnsupportedFile("That Word file couldn't be opened: save it as PDF and try again");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const textOf = (p: Element) => {
    let s = "";
    for (const el of Array.from(p.getElementsByTagName("*"))) {
      if (el.localName === "t") s += el.textContent ?? "";
      else if (el.localName === "tab") s += "   ";
      else if (el.localName === "br") s += "\n";
    }
    return s;
  };
  const lines: string[] = [];
  const walk = (parent: Element) => {
    for (const el of Array.from(parent.children)) {
      if (el.localName === "p") lines.push(...textOf(el).split("\n"));
      else if (el.localName === "tbl") {
        // a table row becomes one line: "B.Tech   DTU   2026   8.4"
        for (const tr of Array.from(el.getElementsByTagName("*")).filter((x) => x.localName === "tr")) {
          const cells = Array.from(tr.children).filter((c) => c.localName === "tc");
          lines.push(cells.map((c) => Array.from(c.children).filter((x) => x.localName === "p").map(textOf).join(" ")).join("   "));
        }
      } else if (el.localName === "sdt" || el.localName === "sdtContent" || el.localName === "body") walk(el);
    }
  };
  walk(doc.documentElement);
  const rels = (await unzip(buf, "word/_rels/document.xml.rels")) ?? "";
  const links = [...rels.matchAll(/Target="(https?:\/\/[^"]+)"[^>]*TargetMode="External"|TargetMode="External"[^>]*Target="(https?:\/\/[^"]+)"/g)].map((m) => (m[1] ?? m[2]).replace(/&amp;/g, "&"));
  return { lines: lines.map(clean).filter(Boolean), links };
}

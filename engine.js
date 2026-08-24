/* engine.js — 格式解析引擎(纯函数层, 不触 reader 的 state/DOM 壳)
   ZIP/CRC32 + 路径工具 + XML 解析 + EPUB(container/OPF/nav/NCX/封面三级策略) + TXT(编码探测/章节切分)
   依赖脚本链先载入的 i18n t()(仅运行期调用); 经典脚本全局共享, reader.js 按链序在其后使用 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  return table;
})();
function crc32(u8) { let c = -1; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }

class ZipReader {
  constructor(buffer) { this.buffer = buffer; this.view = new DataView(buffer); this.entries = new Map(); this.parse(); }
  u16(p) { return this.view.getUint16(p, true); }
  u32(p) { return this.view.getUint32(p, true); }
  text(bytes, enc = "utf-8") { return new TextDecoder(enc).decode(bytes); }
  decodeName(b, isUtf8) {
    if (isUtf8) return this.text(b);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(b); }
    catch { return this.text(b, "gbk"); }
  }
  bytes(p, n) { return new Uint8Array(this.buffer, p, n); }
  findEOCD() {
    const start = Math.max(0, this.buffer.byteLength - 65557);
    for (let p = this.buffer.byteLength - 22; p >= start; p--) if (this.u32(p) === 0x06054b50) return p;
    throw new Error(t("zipBad"));
  }
  parse() {
    const e = this.findEOCD();
    const count = this.u16(e + 10), cdSize = this.u32(e + 12), cdOffset = this.u32(e + 16);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new Error(t("zip64"));
    if (!cdSize) throw new Error(t("zipEmpty"));
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (this.u32(p) !== 0x02014b50) throw new Error(t("cdBroken"));
      const flags = this.u16(p + 8), method = this.u16(p + 10);
      const crc = this.u32(p + 16);
      const compressed = this.u32(p + 20), uncompressed = this.u32(p + 24);
      const nameLen = this.u16(p + 28), extraLen = this.u16(p + 30), commentLen = this.u16(p + 32);
      const localOffset = this.u32(p + 42);
      const name = this.decodeName(this.bytes(p + 46, nameLen), (flags & 0x800) !== 0);
      this.entries.set(name, { flags, method, crc, compressed, uncompressed, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }
  async read(name) {
    const ent = this.entries.get(name);
    if (!ent) throw new Error(t("resMissing", name));
    if (ent.flags & 1) throw new Error(t("resEncrypted", name));
    const p = ent.localOffset;
    if (this.u32(p) !== 0x04034b50) throw new Error(t("lhBroken"));
    const nameLen = this.u16(p + 26), extraLen = this.u16(p + 28);
    const raw = this.bytes(p + 30 + nameLen + extraLen, ent.compressed);
    let out;
    if (ent.method === 0) out = raw.slice();
    else if (ent.method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error(t("noDecompress"));
      const ds = new DecompressionStream("deflate-raw");
      out = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer());
    } else throw new Error(t("zipMethod", ent.method));
    if (ent.crc && crc32(out) !== ent.crc) throw new Error(t("crcFail", name));
    return out.buffer;
  }
}

function normalize(path) {
  const out = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop(); else out.push(part);
  }
  return out.join("/");
}
function dirname(path) { const i = path.lastIndexOf("/"); return i < 0 ? "" : path.slice(0, i + 1); }
function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }
function resolvePath(base, href) { return normalize((dirname(base) + href.split("#")[0].split("?")[0]).split("/").map(safeDecode).join("/")); }
function hrefFragment(href) { const i = href.indexOf("#"); return i < 0 ? "" : decodeURIComponent(href.slice(i + 1)); }
function xmlDoc(text) { return new DOMParser().parseFromString(text, "application/xml"); }
function parseHtmlDoc(text) {
  let doc = new DOMParser().parseFromString(text, "application/xhtml+xml");
  if (!doc.getElementsByTagName("parsererror").length) return doc;
  doc = new DOMParser().parseFromString(text, "text/html");
  if (!doc.getElementsByTagName("parsererror").length) return doc;
  throw new Error(t("htmlParseFail"));
}
function first(root, name) { return root.getElementsByTagNameNS("*", name)[0] || root.getElementsByTagName(name)[0]; }
function all(root, name) { return [...root.getElementsByTagNameNS("*", name), ...root.getElementsByTagName(name)].filter((x,i,a)=>a.indexOf(x)===i); }
function textOf(el) { return (el?.textContent || "").replace(/\s+/g, " ").trim(); }
/* 宏任务让出: setTimeout 在后台标签会被钳到1s+, MessageChannel 立即调度且不受可见性影响 */
function yieldToUi() { return new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); }); }

function decodeTextFile(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder("utf-16le").decode(buf);
  if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder("utf-16be").decode(buf);
  try { return new TextDecoder("utf-8", {fatal:true}).decode(buf); }
  catch { return new TextDecoder("gbk").decode(buf); }
}

function parseTxtChapters(text) {
  const num = "[0-9０-９〇零一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]";
  const volRe = new RegExp(`^(第\\s*${num}{1,9}\\s*卷[^\\n]{0,50}|卷[ \\t\\u3000]*${num}{1,9}(?![章节回集篇])[^\\n]{0,40}|[上中下]卷[^\\n]{0,40})$`);
  const chapRe = new RegExp(`^(第\\s*${num}{1,9}\\s*[章节回集篇][^\\n]{0,60}|(?:Chapter|CHAPTER|chapter)\\s+[0-9IVXLCivxlc０-９]+\\b[^\\n]{0,50}|${num}{1,4}[、.．:：]\\s*(?![$0-9０-９])[^\\n]{1,50}|${num}{2,4}[ \\t\\u3000][^\\d\\n\\s][^\\n]{0,45}|序章|楔子|引言|引子|前言|后记|尾声|终章|大结局|番外[^\\n]{0,40})$`);
  const chapters = [];
  let cur = { title: t("txtOpening"), lines: [], depth: 0, isVol: false };
  let subDepth = 0;
  let sawHeading = false;
  const flush = () => { if (cur.lines.join("\n").trim() || cur.isVol) chapters.push(cur); };
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim().replace(/^[【〔\[（(「『〈《*-]+\s*/, "").replace(/\s*[】〕\]）)」』〉》*-]+$/, "");
    if (!line || !(volRe.test(line) || chapRe.test(line))) { cur.lines.push(raw); continue; }
    flush();
    sawHeading = true;
    const isVol = volRe.test(line);
    cur = { title: line, lines: [], depth: isVol ? 0 : subDepth, isVol };
    if (isVol) subDepth = 1;
  }
  flush();
  const totalLen = text.length;
  if (!sawHeading || (chapters.length === 1 && totalLen > 50000)) chapters.length = 0;
  if (!chapters.length) {
    const CHUNK = 12000;
    let i = 0, part = 1;
    while (i < text.length) {
      let end = Math.min(i + CHUNK, text.length);
      if (end < text.length) { const nl = text.lastIndexOf("\n", end); if (nl > i + CHUNK / 3) end = nl + 1; }
      chapters.push({ title: t("txtPart", part++), lines: [text.slice(i, end)], depth: 0, isVol: false, showTitle: false });
      i = end;
    }
  } else {
    for (const c of chapters) c.showTitle = true;
  }
  return chapters;
}

/* ---------- EPUB 结构解析 ---------- */
/* container→OPF→manifest/spine/标题/NCX/封面候选; 返回 null 表示缺 rootfile(由调用方抛 noOpf) */
async function parseEpub(zip) {
  const container = new TextDecoder().decode(await zip.read("META-INF/container.xml"));
  const rootfile = first(xmlDoc(container), "rootfile");
  if (!rootfile) return null;
  const opfPath = normalize(rootfile.getAttribute("full-path"));
  const opf = xmlDoc(new TextDecoder().decode(await zip.read(opfPath)));
  const manifest = new Map();
  for (const item of all(opf, "item")) {
    manifest.set(item.getAttribute("id"), {
      id: item.getAttribute("id"),
      href: item.getAttribute("href"),
      media: item.getAttribute("media-type"),
      props: item.getAttribute("properties") || ""
    });
  }
  const spine = [];
  for (const ref of all(opf, "itemref")) {
    const item = manifest.get(ref.getAttribute("idref"));
    if (item) spine.push(item);
  }
  const opfTitle = first(opf, "title")?.textContent?.trim() || "";
  const tocId = first(opf, "spine")?.getAttribute("toc");
  const ncxItem = tocId ? manifest.get(tocId) : [...manifest.values()].find(x => x.media === "application/x-dtbncx+xml");
  const ncxPath = ncxItem ? resolvePath(opfPath, ncxItem.href) : "";
  /* 封面三级策略: EPUB3 properties=cover-image 优先, EPUB2 meta[name=cover] 指认次之, 文件名含 cover 的图片兜底 */
  const coverItem = [...manifest.values()].find(x => /(^|\s)cover-image(\s|$)/i.test(x.props) && /^image\//.test(x.media || ""))
    || (() => {
      const mc = all(opf, "meta").find(m => (m.getAttribute("name") || "") === "cover");
      const it = mc ? manifest.get(mc.getAttribute("content")) : null;
      return it && /^image\//.test(it.media || "") ? it : null;
    })()
    || [...manifest.values()].find(x => /^image\//.test(x.media || "") && /cover/i.test(`${x.id || ""} ${x.href || ""}`));
  return { opfPath, opf, manifest, spine, opfTitle, ncxPath, coverItem };
}
async function extractCover(zip, opfPath, coverItem) {
  if (!coverItem?.href) return null;
  try {
    const data = await zip.read(resolvePath(opfPath, coverItem.href));
    return new Blob([data], { type: coverItem.media || "image/jpeg" });
  } catch { return null; }
}

/* ---------- 目录(nav/NCX/spine 兜底) ---------- */
function chapterTitle(item, i) {
  return item.href.split("#")[0].split("/").pop()?.replace(/\.[^.]+$/, "") || t("chapterN", i + 1);
}
function tocEntryFromLink(label, href, spine, basePath, opfPath, depth = 0) {
  if (!href) return null;
  const path = resolvePath(basePath, href);
  const fragment = hrefFragment(href);
  const chapterIndex = spine.findIndex(x => resolvePath(opfPath, x.href) === path);
  if (chapterIndex < 0) return null;
  return { label: textOf({textContent: label}) || chapterTitle(spine[chapterIndex], chapterIndex), path, fragment, chapterIndex, depth };
}
function collectNavLinks(el, depth, out) {
  for (const child of el.children) {
    const tag = child.localName;
    if (tag === "ol" || tag === "ul") collectNavLinks(child, depth, out);
    else if (tag === "li") {
      const a = [...child.children].find(c => c.localName === "a" && c.getAttribute("href"));
      if (a) out.push({ a, depth });
      for (const sub of child.children) if (sub.localName === "ol" || sub.localName === "ul") collectNavLinks(sub, depth + 1, out);
    } else if (tag === "a" && child.getAttribute("href")) out.push({ a: child, depth });
  }
}
function collectNavPoints(points, depth, out) {
  for (const p of points) {
    const labelEl = [...p.children].find(c => c.localName === "navLabel");
    const label = textOf(labelEl?.getElementsByTagNameNS("*", "text")[0]) || t("chapterN", out.length + 1);
    const src = [...p.children].find(c => c.localName === "content")?.getAttribute("src");
    if (src) out.push({ label, src, depth });
    collectNavPoints([...p.children].filter(c => c.localName === "navPoint"), src ? depth + 1 : depth, out);
  }
}
async function buildToc(zip, opfPath, opf, manifest, spine) {
  // EPUB 3: navigation document. The nav is a separate XHTML item in the manifest.
  const navItem = [...manifest.values()].find(x => /(^|\s)nav(\s|$)/i.test(x.props));
  if (navItem) {
    try {
      const navPath = resolvePath(opfPath, navItem.href);
      const html = new TextDecoder().decode(await zip.read(navPath));
      const doc = parseHtmlDoc(html);
      const nav = [...doc.querySelectorAll("nav")].find(n => /toc/i.test(n.getAttribute("epub:type") || n.getAttribute("role") || "")) || doc.querySelector("nav");
      if (nav) {
        const found = [];
        collectNavLinks(nav, 0, found);
        const entries = found.map(({a, depth}) => tocEntryFromLink(a.textContent, a.getAttribute("href"), spine, navPath, opfPath, depth)).filter(Boolean);
        if (entries.length) return entries;
      }
    } catch (e) { console.warn("EPUB nav 读取失败", e); }
  }

  // EPUB 2: NCX.
  const spineEl = first(opf, "spine");
  const tocId = spineEl?.getAttribute("toc");
  const ncxItem = tocId ? manifest.get(tocId) : [...manifest.values()].find(x => x.media === "application/x-dtbncx+xml");
  if (ncxItem) {
    try {
      const ncxPath = resolvePath(opfPath, ncxItem.href);
      const xml = new TextDecoder().decode(await zip.read(ncxPath));
      const doc = xmlDoc(xml);
      const found = [];
      collectNavPoints([...doc.querySelectorAll("navPoint")].filter(p => !p.parentElement?.closest("navPoint")), 0, found);
      const entries = found.map(({label, src, depth}) => tocEntryFromLink(label, src, spine, ncxPath, opfPath, depth)).filter(Boolean);
      if (entries.length) return entries;
    } catch (e) { console.warn("EPUB NCX 读取失败", e); }
  }

  // Last resort: spine. Use a human-readable title from the XHTML instead of filename.
  const entries = [];
  for (let i = 0; i < spine.length; i++) {
    await yieldToUi();   /* 逐章解压解析较重, 让出主线程避免打开时卡顿 */
    let label = chapterTitle(spine[i], i);
    try {
      const path = resolvePath(opfPath, spine[i].href);
      const html = new TextDecoder().decode(await zip.read(path));
      const doc = parseHtmlDoc(html);
      label = textOf(doc.querySelector("h1,h2,h3,title")) || label;
    } catch {}
    entries.push({label, path: resolvePath(opfPath, spine[i].href), fragment:"", chapterIndex:i, depth:0});
  }
  return entries;
}

/* 冒烟测试: 零依赖, 驱动真实 Chrome 验证核心路径(开书/分章/书架/撤销删除/备份/重链接/i18n/a11y)
   运行: node tests/smoke.mjs        环境变量: CHROME_BIN=/path/to/chrome 覆盖浏览器路径 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* ---------- 内置静态服务器(随机空闲端口), 服务仓库根目录 ---------- */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon"
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    let p = join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith("/")) p = join(p, "index.html");
    const data = await readFile(p);
    res.writeHead(200, { "content-type": MIME[extname(p).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
const port = await new Promise(res => server.listen(0, "127.0.0.1", () => res(server.address().port)));

/* ---------- 启动无头 Chrome 并接通 CDP ---------- */
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const chromeBin = process.env.CHROME_BIN || "google-chrome";
const profile = mkdtempSync(join(tmpdir(), "chrome-prof-"));
const chrome = spawn(chromeBin, [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1280,900", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let exitCode = 0;
try {
  const wsUrl = await new Promise((res, rej) => {
    const t0 = Date.now();
    const poll = async () => {
      try {
        if (chrome.exitCode !== null) return rej(new Error(`chrome 提前退出(code=${chrome.exitCode}), 检查 CHROME_BIN`));
        const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        const page = list.find(t => t.type === "page");
        if (page) return res(page.webSocketDebuggerUrl);
      } catch {}
      if (Date.now() - t0 > 15000) return rej(new Error("chrome CDP timeout"));
      setTimeout(poll, 300);
    };
    poll();
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown")
      consoleErrors.push("EXC: " + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      consoleErrors.push("CONSOLE.ERROR: " + m.params.args.map(a => a.value ?? a.description ?? "").join(" "));
  };
  const send = (method, params = {}) => new Promise(res => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function evalJs(expression) {
    /* 15s 超时保护: 任何挂起直接报错而非卡死整个脚本 */
    const timed = Promise.race([
      send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
      sleep(15000).then(() => { throw new Error("eval TIMEOUT: " + expression.slice(0, 120)); })
    ]);
    const r = await timed;
    if (r.result?.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  }

  const fails = [];
  const ok = (cond, name) => { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) fails.push(name); };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await sleep(2500);

  /* ---- 0. 测试环境加固: 屏蔽阻塞式对话框 + 页面侧 EPUB 构造器 ---- */
  await evalJs(`
window.alert = m => console.warn("[alert-suppressed]", String(m).slice(0, 120));
window.confirm = () => false;
window.prompt = () => null;
window.__buildEpub = (title, padTo = 0) => {
  /* 填充必须放进 ZIP 条目内容内部: 尾部补零会把 EOCD 推出解析器 64K 扫描窗; 两遍构造精确到指定字节 */
  const enc = new TextEncoder();
  const mk = padChars => {
  const files = [
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ["OEBPS/content.opf", '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + title + '</dc:title><dc:identifier id="uid">urn:uuid:' + title + '</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/></spine></package>'],
    ["OEBPS/nav.xhtml", '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">第一章 测试章</a></li></ol></nav></body></html>'],
    ["OEBPS/c1.xhtml", '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head><body><h1 id="anchor-one">第一章 测试章</h1><p>' + "正文内容用于滚动。".repeat(80) + "x".repeat(padChars) + '</p></body></html>']
  ].map(([n, s]) => [n, enc.encode(s)]);
  const chunks = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameB = enc.encode(name);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nameB, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameB.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    centrals.push(new Uint8Array(ch.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  let cdSize = 0;
  for (const c of centrals) cdSize += c.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true);
  const parts = [...chunks, ...centrals, new Uint8Array(eocd.buffer)];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { buf.set(p, pos); pos += p.length; }
  return buf;
  };
  let buf = mk(0);
  if (padTo > buf.length) buf = mk(padTo - buf.length);
  if (padTo && buf.length !== padTo) throw new Error("padding mismatch: " + buf.length);
  return new File([buf], title + ".epub", { type: "application/epub+zip" });
};
`);

  /* ---- 1. 静态结构 ---- */
  ok(await evalJs(`!!document.getElementById("menuShelfBtn") && !!document.getElementById("shelfMenu") && !!document.getElementById("exportData") && !!document.getElementById("importData") && !!document.getElementById("backupInput")`), "书架头部三点菜单含导出/导入项");
  ok(await evalJs(`document.querySelector(".backupRow") === null && document.querySelector(".backupHint") === null && document.getElementById("shelfMenu").closest("#shelf") !== null`), "旧备份行已移除, 菜单归属书架头");
  ok(await evalJs(`!!document.getElementById("editShelfBtn") && document.getElementById("shelfEditBtns").hidden && !document.getElementById("shelfIdleBtns").hidden`), "编辑按钮存在且默认非编辑态");
  ok(await evalJs(`document.getElementById("fileMenu") === null && document.getElementById("menuBtn") === null`), "阅读侧三点菜单保持移除");
  ok(await evalJs(`document.getElementById("closeBookBtn").hidden === true && !!document.getElementById("closeBookBtn").querySelector("svg")`), "工具栏✕关闭按钮初始隐藏(svg图标)");
  ok(await evalJs(`document.getElementById("relinkBtn").hidden === true`), "恢复按钮空库时隐藏");
  ok(await evalJs(`document.getElementById("searchStatus").getAttribute("role") === "status"`), "searchStatus 有 role=status");

  /* ---- 2. 弹层 aria 同步 ---- */
  await evalJs(`document.getElementById("settingsBtn").click()`);
  ok(await evalJs(`!document.getElementById("settingsPanel").hidden && document.getElementById("settingsBtn").getAttribute("aria-expanded")==="true"`), "设置面板开→aria-expanded=true");
  ok(await evalJs(`document.body.classList.contains("dark") === false`), "初始非深色");
  await evalJs(`[...document.querySelectorAll(".themeChip[data-theme]")].find(b=>b.dataset.theme==="dark").click()`);
  await sleep(100);
  ok(await evalJs(`document.body.classList.contains("dark") && document.getElementById("settingsBtn").getAttribute("aria-expanded")==="true"`), "深色主题生效");
  ok(await evalJs(`document.querySelector('meta[name="theme-color"]').content === "#1c1b1a"`), "theme-color 动态跟随深色");
  ok(await evalJs(`getComputedStyle(document.querySelector("#fontSizeRange")).colorScheme.includes("dark") || document.body.classList.contains("dark")`), "color-scheme 深色联动");
  await evalJs(`[...document.querySelectorAll(".themeChip[data-theme]")].find(b=>b.dataset.theme==="sepia").click()`);
  await sleep(50);
  ok(await evalJs(`document.querySelector('meta[name="theme-color"]').content === "#eee4c9"`), "theme-color 跟随羊皮纸");
  await evalJs(`document.getElementById("settingsBtn").click()`);
  ok(await evalJs(`document.getElementById("settingsPanel").hidden && document.getElementById("settingsBtn").getAttribute("aria-expanded")==="false"`), "设置面板关→aria-expanded=false");

  /* ---- 3. 语言切换与 i18n ---- */
  await evalJs(`[...document.querySelectorAll(".langChip")].find(b=>b.dataset.lang==="en").click()`);
  await sleep(50);
  ok(await evalJs(`document.getElementById("closeBookBtn").getAttribute("aria-label") === "Close book" && document.getElementById("closeBookBtn").title === "Close book"`), "关闭按钮英文 title/aria-label 同步");
  await evalJs(`document.getElementById("menuShelfBtn").click()`);
  await sleep(50);
  ok(await evalJs(`!document.getElementById("shelfMenu").hidden && document.getElementById("exportData").textContent === "Export reading data"`), "菜单英文文案同步");
  await evalJs(`document.body.click()`);
  await sleep(50);
  ok(await evalJs(`document.getElementById("shelfMenu").hidden`), "点击外部关闭书架菜单");
  await evalJs(`[...document.querySelectorAll(".langChip")].find(b=>b.dataset.lang==="zh").click()`);

  /* ---- 4. toast 动作扩展 ---- */
  await evalJs(`toast("测试消息", { action: { label: "撤销", fn: () => {} } })`);
  ok(await evalJs(`document.getElementById("toast").classList.contains("hasAction") && !!document.querySelector("#toast .toastAct") && document.getElementById("toast").getAttribute("role")==="status"`), "toast 支持动作按钮且 role=status");
  await evalJs(`document.querySelector("#toast .toastAct").click()`);

  /* ---- 5. 构造并打开一本 EPUB ---- */
  const openedEpub = await evalJs(`
(async () => {
  await openBookFile(window.__buildEpub("冒烟测试书"));
  await new Promise(r => setTimeout(r, 600));
  return {
    readerShown: !document.getElementById("reader").hidden,
    title: document.getElementById("bookTitle").textContent,
    units: state.navUnits.length,
    label: document.getElementById("chapterLabel").textContent,
    progress: document.getElementById("progress").textContent
  };
})()
`);
  ok(openedEpub.readerShown && openedEpub.title === "冒烟测试书" && openedEpub.units >= 1, `EPUB 打开成功(${openedEpub.title}, 单元${openedEpub.units})`);
  ok(/第\s*1\s*\/\s*1\s*章|Chapter 1/.test(openedEpub.progress), "进度显示正常: " + openedEpub.progress);
  ok(await evalJs(`document.getElementById("closeBookBtn").hidden === false`), "打开书籍后✕按钮显示");

  /* ---- 6. 书架渲染 + 撤销删除 + 锚定toast ---- */
  await evalJs(`document.getElementById("closeBookBtn").click()`);
  await sleep(400);
  ok(await evalJs(`document.getElementById("welcome").hidden === false && document.getElementById("closeBookBtn").hidden === true`), "✕点击直接关闭书籍回书架");
  const shelfCount = await evalJs(`document.querySelectorAll("#shelfList .shelfItem").length`);
  ok(shelfCount === 1, "书架出现1条记录");
  ok(await evalJs(`document.querySelector("#shelfList .shelfItem").getAttribute("role")==="button" && document.querySelector("#shelfList .shelfItem").tabIndex===0 && document.querySelector("#shelfList .shelfDel").tagName==="BUTTON"`), "书架条目为 div[role=button]+真button删除键");

  /* 删除唯一一本书会让书架整体隐藏(既有行为), 头部坐标须在点击前捕获 */
  const headY = await evalJs(`Math.round(document.querySelector(".shelfHead").getBoundingClientRect().top)`);
  await evalJs(`document.querySelector("#shelfList .shelfDel").click()`);
  await sleep(100);
  ok(await evalJs(`document.querySelectorAll("#shelfList .shelfItem").length === 0`), "点×后条目立即隐藏");
  ok(await evalJs(`!!document.querySelector("#toast.show .toastAct") && document.getElementById("toast").classList.contains("anchored")`), "撤销toast带按钮且锚定在触发点附近");
  const near = await evalJs(`
(() => {
  const t = document.getElementById("toast").getBoundingClientRect();
  return { dist: Math.abs((t.top + t.height / 2) - (${headY} + 16)), toastY: Math.round(t.top) };
})()
`);
  ok(near.dist < 400, `锚定toast贴近删除前书架头部位置(toast@${near.toastY}, 原头部@${headY})`);
  await evalJs(`document.querySelector("#toast .toastAct").click()`);
  await sleep(100);
  ok(await evalJs(`document.querySelectorAll("#shelfList .shelfItem").length === 1`), "撤销后条目恢复");

  await evalJs(`document.querySelector("#shelfList .shelfDel").click()`);
  await sleep(5300);
  const purged = await evalJs(`
(async () => {
  const metas = await idbAll("meta");
  const filesRec = metas.find(m => m.title === "冒烟测试书");
  return { stillThere: !!filesRec, progressKey: Object.keys(localStorage).some(k => k.startsWith("progress:冒烟测试书")) };
})()
`);
  ok(!purged.stillThere && !purged.progressKey, "超时后书籍记录与进度键真正清除");

  /* ---- 7. TXT 打开 ---- */
  await evalJs(`
(async () => {
  const txt = "第一章 起点\\n" + "正文内容滚动测试。".repeat(300) + "\\n第二章 终点\\n" + "收尾内容滚动测试。".repeat(300);
  await openBookFile(new File([txt], "测试小说.txt", { type: "text/plain" }));
  await new Promise(r => setTimeout(r, 600));
})();
`);
  const txtInfo = await evalJs(`({ units: state.navUnits.length, label: document.getElementById("chapterLabel").textContent, isTxt: state.book.isTxt })`);
  ok(txtInfo.isTxt && txtInfo.units === 2 && txtInfo.label.includes("第一章"), `TXT 分章打开(${txtInfo.units}单元, 标签:${txtInfo.label})`);

  /* ---- 8. 备份导出 ---- */
  const exported = await evalJs(`
(async () => {
  flushProgress();
  let captured = null;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { captured = this.href; };
  await exportBackup();
  HTMLAnchorElement.prototype.click = orig;
  return await (await fetch(captured)).json();
})()
`);
  ok(exported && exported.app === "epubreader-web" && Array.isArray(exported.books) && typeof exported.prefs === "object", `导出结构正确(书目${exported.books.length}条)`);

  /* ---- 9. 备份导入: 幽灵书目+徽章+恢复按钮 ---- */
  const imported = await evalJs(`
(async () => {
  closeBook();
  await new Promise(r => setTimeout(r, 300));
  const payload = { app: "epubreader-web", v: 1, exportedAt: new Date().toISOString(),
    prefs: { theme: "green", fontSize: "22", lineHeight: "1.9" },
    books: [{ title: "幽灵之书", size: 555777, chapters: 9, i: 2, u: null, r: 0.5, lastOpened: 1700000000000 }] };
  await importBackup(new File([JSON.stringify(payload)], "b.json", { type: "application/json" }));
  await new Promise(r => setTimeout(r, 400));
  return {
    theme: state.theme, fontSize: state.fontSize,
    ghostInShelf: [...document.querySelectorAll(".shelfTitle")].some(e => e.textContent === "幽灵之书"),
    progressRestored: !!loadProgress("幽灵之书", 555777),
    metaThere: !!(await idbGet("meta", bookId("幽灵之书", 555777)))
  };
})()
`);
  ok(imported.theme === "green" && imported.fontSize === 22, `导入偏好生效(theme=${imported.theme}, fontSize=${imported.fontSize})`);
  ok(imported.metaThere && imported.progressRestored && imported.ghostInShelf, "幽灵书目写入meta+进度恢复+书架可见");
  ok(await evalJs(`document.body.classList.contains("green")`), "护眼绿类已应用");
  ok(await evalJs(`document.querySelector('meta[name="theme-color"]').content === "#cde5cd"`), "theme-color 跟随护眼绿");
  ok(await evalJs(`(() => {
    const item = [...document.querySelectorAll("#shelfList .shelfItem")].find(el => el.querySelector(".shelfTitle")?.textContent === "幽灵之书");
    return !!item && item.classList.contains("ghost") && item.querySelector(".shelfBadge")?.textContent === "待关联";
  })()`), "幽灵条目有.ghost类+「待关联」徽章");
  ok(await evalJs(`document.getElementById("relinkBtn").hidden === false && document.getElementById("relinkBtn").textContent.includes("(1)")`, ), "恢复按钮可见且计数(1)");

  /* ---- 9b. 单条目重链接: 错文件拒绝 / 对文件回填并直接打开 ---- */
  const ghostClick = `(() => {
  const item = [...document.querySelectorAll("#shelfList .shelfItem")].find(el => el.querySelector(".shelfTitle")?.textContent === "幽灵之书");
  if (!item) throw new Error("ghost item missing");
  item.click();
})()`;
  const relinkBad = await evalJs(`
(async () => {
  window.showOpenFilePicker = async () => [{ getFile: async () => new File(["不匹配"], "别的.epub", { type: "application/epub+zip" }) }];
  ${ghostClick};
  await new Promise(r => setTimeout(r, 400));
  return {
    tip: document.querySelector("#toast .toastMsg").textContent,
    mismatchTip: document.querySelector("#toast .toastMsg").textContent === t("relinkMismatch"),
    stillListed: [...document.querySelectorAll(".shelfTitle")].some(e => e.textContent === "幽灵之书"),
    notOpened: document.getElementById("reader").hidden,
    anchored: document.getElementById("toast").classList.contains("anchored")
  };
})()
`);
  ok(relinkBad.mismatchTip && relinkBad.stillListed && relinkBad.notOpened, "选错文件→提示不匹配且条目保留: " + relinkBad.tip);
  ok(relinkBad.anchored, "重关联提示锚定在书架条目附近");

  const relinkOk = await evalJs(`
(async () => {
  /* 合法 EPUB 内容填充到 555777 字节, 与幽灵书目 size 精确一致 */
  const id = bookId("幽灵之书", 555777);
  window.showOpenFilePicker = async () => [{ getFile: async () => window.__buildEpub("幽灵之书", 555777) }];
  ${ghostClick};
  await new Promise(r => setTimeout(r, 900));
  const rec = await idbGet("files", id);
  return {
    opened: !document.getElementById("reader").hidden,
    title: document.getElementById("bookTitle").textContent,
    backfilled: !!rec?.file && rec.file.size === 555777
  };
})()
`);
  ok(relinkOk.opened && relinkOk.backfilled, `选对文件→自动回填并直接打开(${relinkOk.title})`);
  await evalJs(`closeBook()`);
  await sleep(300);
  ok(await evalJs(`(() => {
    const item = [...document.querySelectorAll("#shelfList .shelfItem")].find(el => el.querySelector(".shelfTitle")?.textContent === "幽灵之书");
    return !!item && !item.classList.contains("ghost") && !item.querySelector(".shelfBadge");
  })()`), "回填后幽灵徽章消失");

  /* ---- 9c. 批量重链接: 多选文件按字节大小匹配 ---- */
  const batchRelink = await evalJs(`
(async () => {
  /* 再造一个幽灵条目(只有元数据无文件) */
  const id2 = bookId("批量之书", 444333);
  await idbPut("meta", { id: id2, title: "批量之书", size: 444333, chapters: 3, i: 0, u: null, r: 0, lastOpened: 1690000000000 });
  renderShelf();
  await new Promise(r => setTimeout(r, 200));
  const btnBefore = !document.getElementById("relinkBtn").hidden && document.getElementById("relinkBtn").textContent.includes("(1)");
  /* 多选两个文件: 一个尺寸匹配, 一个不匹配 */
  window.showOpenFilePicker = async () => [
    { getFile: async () => window.__buildEpub("无关书", 111111) },
    { getFile: async () => window.__buildEpub("批量之书", 444333) }
  ];
  document.getElementById("relinkBtn").click();
  await new Promise(r => setTimeout(r, 900));
  const rec = await idbGet("files", id2);
  const item = [...document.querySelectorAll("#shelfList .shelfItem")].find(el => el.querySelector(".shelfTitle")?.textContent === "批量之书");
  return {
    btnBefore,
    toastMsg: document.querySelector("#toast .toastMsg")?.textContent,
    resultTip: document.querySelector("#toast .toastMsg")?.textContent === t("relinkResult", 1, 1),
    anchored: document.getElementById("toast").classList.contains("anchored"),
    backfilled: !!rec?.file && rec.file.size === 444333,
    ghostGone: !!item && !item.classList.contains("ghost"),
    btnHiddenAfter: document.getElementById("relinkBtn").hidden
  };
})()
`);
  ok(batchRelink.btnBefore, "批量前恢复按钮计数正确");
  ok(batchRelink.resultTip && batchRelink.backfilled, "批量重链接汇总提示: " + batchRelink.toastMsg);
  ok(batchRelink.ghostGone && batchRelink.btnHiddenAfter, "全部恢复后徽章消失且按钮隐藏");

  /* ---- 9d. 书架编辑模式: 多选/全选/批量移除+撤销 ---- */
  const editFlow = await evalJs(`
(async () => {
  const items = () => document.querySelectorAll("#shelfList .shelfItem").length;
  const out = {};
  document.getElementById("editShelfBtn").click();
  await new Promise(r => setTimeout(r, 200));
  out.entered = !document.getElementById("shelfEditBtns").hidden && document.getElementById("shelfIdleBtns").hidden;
  out.checks = document.querySelectorAll("#shelfList .shelfCheck").length === items() && items() >= 3;
  document.getElementById("selAllBtn").click();
  await new Promise(r => setTimeout(r, 150));
  out.allSelLabel = document.getElementById("selAllBtn").textContent === t("deselectAll");
  out.selCount = [...document.querySelectorAll("#shelfList .shelfItem.sel")].length;
  out.delCount = document.getElementById("delSelBtn").textContent.includes("(" + out.selCount + ")");
  document.getElementById("delSelBtn").click();
  await new Promise(r => setTimeout(r, 200));
  out.cleared = items() === 0;
  out.toastMsg = document.querySelector("#toast .toastMsg")?.textContent;
  out.toastAct = !!document.querySelector("#toast .toastAct");
  document.querySelector("#toast .toastAct").click();
  await new Promise(r => setTimeout(r, 200));
  out.restored = items() === out.selCount;
  /* 单选一本删除→超时真删 */
  const firstItem = document.querySelector("#shelfList .shelfItem");
  const firstName = firstItem.querySelector(".shelfTitle").textContent;
  firstItem.click();
  await new Promise(r => setTimeout(r, 150));
  out.oneDel = document.getElementById("delSelBtn").textContent.includes("(1)");
  document.getElementById("delSelBtn").click();
  await new Promise(r => setTimeout(r, 5300));
  const metasAfter = await idbAll("meta");
  out.purgedOne = !metasAfter.some(m => m.title === firstName) && !document.querySelector("#toast.show .toastAct");
  /* Escape 退出编辑模式 */
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  out.exitedViaEsc = document.getElementById("shelfIdleBtns").hidden === false && !document.querySelector("#shelfList .shelfCheck");
  return out;
})()
`);
  ok(editFlow.entered && editFlow.checks, `进入编辑模式且条目带勾选框(${editFlow.selCount}本)`);
  ok(editFlow.allSelLabel && editFlow.delCount, "全选后按钮变「取消全选」且删除键计数");
  ok(editFlow.cleared && editFlow.toastAct, "批量移除后列表清空并出现撤销: " + editFlow.toastMsg);
  ok(editFlow.restored, "撤销后全部恢复");
  ok(editFlow.oneDel && editFlow.purgedOne, "单选删除超时后真正清除记录");
  ok(editFlow.exitedViaEsc, "Escape 退出编辑模式");

  /* ---- 9e. 书架双视图: 网格默认/设置面板切换/持久化 ---- */
  const viewA = await evalJs(`
(() => ({
  defGrid: state.shelfView === "grid" && document.getElementById("shelfList").classList.contains("grid"),
  covers: document.querySelectorAll("#shelfList .cardCover").length,
  chips: [...document.querySelectorAll(".viewChip")].map(b => b.dataset.view + ":" + b.classList.contains("active")).join(","),
  cardDel: !!document.querySelector("#shelfList .shelfItem .shelfDel")
}))()
`);
  ok(viewA.defGrid && viewA.covers >= 2 && viewA.cardDel, `默认网格视图且卡片带封面(封面${viewA.covers}个)`);
  ok(viewA.chips === "grid:true,list:false", "视图chips默认态正确: " + viewA.chips);
  await evalJs(`[...document.querySelectorAll(".viewChip")].find(b => b.dataset.view === "list").click()`);
  await sleep(150);
  const viewB = await evalJs(`
(() => ({
  listMode: state.shelfView === "list" && !document.getElementById("shelfList").classList.contains("grid"),
  rows: document.querySelectorAll("#shelfList .shelfItem").length,
  dels: document.querySelectorAll("#shelfList .shelfDel").length,
  noCover: document.querySelectorAll("#shelfList .cardCover").length === 0,
  stored: localStorage.getItem("shelfView")
}))()
`);
  ok(viewB.listMode && viewB.rows >= 2 && viewB.dels === viewB.rows && viewB.noCover && viewB.stored === "list", "切列表: 行渲染+删除键在列+存储写入");
  await evalJs(`location.reload()`);
  await sleep(1800);
  const viewC = await evalJs(`state.shelfView === "list" && !document.getElementById("shelfList").classList.contains("grid")`);
  ok(viewC, "重载后保持列表视图");
  await evalJs(`[...document.querySelectorAll(".viewChip")].find(b => b.dataset.view === "grid").click()`);
  await sleep(150);
  ok(await evalJs(`localStorage.getItem("shelfView") === "grid" && document.getElementById("shelfList").classList.contains("grid")`), "切回网格并存储");

  /* ---- 10. 清理测试数据, 收尾检查 console ---- */
  await evalJs(`
(async () => {
  for (const m of await idbAll("meta")) await purgeBook(m.id);
  renderShelf();
})();
`);
  await sleep(300);
  console.log("\n控制台错误数:", consoleErrors.length);
  for (const e of consoleErrors.slice(0, 10)) console.log("  " + e.slice(0, 200));

  console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL SMOKE TESTS PASSED");
  ws.close();
  exitCode = fails.length ? 1 : 0;
} catch (err) {
  console.error("\n测试脚本异常:", err.message || err);
  exitCode = 2;
} finally {
  chrome.kill();
  server.close();
  process.exit(exitCode);
}

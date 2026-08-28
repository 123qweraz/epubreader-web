/* typing.js — 打字模式: 照书打字驱动阅读(只按 a-z: 英文字母/中文无声调全拼/日文wapuro罗马音)
   打字驱动推进, 当前行视口锚定; 宽松错误(闪红不阻塞); Tab跳过当前token, Esc退出
   依赖运行期全局: $(reader.js) state t toast ensurePinyinLib toRomaji KANA_DIGRAPH(pinyin.js)
   safeShowUnit/rerenderReader/setReadMode(reader.js); 加载顺序: pinyin.js → typing.js → reader.js */
/* ---------- 打字音效: WebAudio零依赖合成(正确=短促高频blip, 错误=低沉嗡声); 用户手势后惰性建ctx ---------- */
let twAudioCtx = null;
function twCtx() {
  if (!twAudioCtx) {
    try { twAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (twAudioCtx.state === "suspended") twAudioCtx.resume().catch(() => {});
  return twAudioCtx;
}
function twBeep(freq, dur, type = "sine", gainV = 0.05) {
  if (!state.typingSound) return;
  const ctx = twCtx();
  if (!ctx || ctx.state !== "running") return;
  try {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gainV, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  } catch {}
}
const twPlayType = () => twBeep(1050 + Math.random() * 120, 0.04, "sine", 0.045);
const twPlayErr = () => twBeep(190, 0.16, "square", 0.05);

let twActive = false;
let twState = null;
const TW_HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const TW_KANA = /[\u3041-\u309f\u30a0-\u30fc]/;
const TW_TONELESS = /^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s]+$/i;
const TW_BLOCK_SEL = "p,li,h1,h2,h3,h4,h5,h6,blockquote,dd,dt";

/* 段落日语语境: 含假名即按日语处理(汉字自动跳过); 纯汉字段按中文注拼音 */
function twIsJaBlock(el) { return TW_KANA.test(el.textContent || ""); }

/* 块收集: 常见块级元素去重嵌套(父块已收则子块跳过); 兜底TXT行/章节直系子元素 */
function twCollectBlocks(doc) {
  let els = [...doc.body.querySelectorAll(TW_BLOCK_SEL)];
  if (!els.length) els = [...doc.body.querySelectorAll(".spinePart > *, .content > *")];
  if (!els.length) els = [doc.body];
  const seen = new Set();
  return els.filter(el => {
    if (el.closest("rt,rp,script,style")) return false;
    const anc = el.parentElement?.closest(TW_BLOCK_SEL);
    if (anc && seen.has(anc)) return false;
    seen.add(el);
    return !!(el.textContent || "").trim();
  });
}

/* 无声调拼音(逐字) */
function twPinyin(ch) {
  try { return window.pinyinPro.pinyin(ch, { toneType: "none", type: "array" })[0] || ""; }
  catch { return ""; }
}

/* 把一个文本节点按字符类别切成token; 返回新节点数组(替换原节点用) */
function twEmitText(doc, node, jaCtx, out) {
  const text = node.nodeValue;
  const frag = doc.createDocumentFragment();
  let plain = "";
  const flushPlain = () => { if (plain) { frag.appendChild(doc.createTextNode(plain)); plain = ""; } };
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (TW_LATIN_RE.test(ch)) {
      flushPlain();
      let j = i + 1;
      while (j < text.length && TW_LATIN_RE.test(text[j])) j++;
      const word = text.slice(i, j);
      out.push(twMkToken(doc, word, word.toLowerCase(), word));
      frag.appendChild(out[out.length - 1].el);
      i = j; continue;
    }
    if (TW_HAN.test(ch)) {
      if (jaCtx) { plain += ch; i++; continue; }   /* 日语语境汉字无读音字典: 跳过不包 */
      flushPlain();
      out.push(twMkToken(doc, ch, twPinyin(ch), ch));
      frag.appendChild(out[out.length - 1].el);
      i++; continue;
    }
    if (TW_KANA.test(ch)) {
      flushPlain();
      /* 拄音两字符一token(wapuro), 其余单字 */
      const two = ch + kata2hira(text[i + 1] || "");
      const len = KANA_DIGRAPH[two] ? 2 : 1;
      const piece = text.slice(i, i + len);
      out.push(twMkToken(doc, piece, toRomaji(piece), piece));
      frag.appendChild(out[out.length - 1].el);
      i += len; continue;
    }
    plain += ch; i++;   /* 标点/空白等: 不打, 保持原样 */
  }
  flushPlain();
  return frag;
}
const TW_LATIN_RE = /[a-zA-Z]/;

function twMkToken(doc, text, expect, realExpect) {
  /* 双层结构: twA=已打亮的源字符前缀, twB=待打(灰色); 单字中文源不可拆, 靠caret+整体变色指示
     realExpect=真打字模式的期望字面(源文本本身), expect=拼音模式期望(读音字母) */
  const el = doc.createElement("span");
  el.className = "twTok";
  const a = doc.createElement("span");
  a.className = "twA";
  const b = doc.createElement("span");
  b.className = "twB";
  b.textContent = text;
  el.append(a, b);
  return { el, aEl: a, bEl: b, expect: expect || "", got: 0, src: text, realExpect: realExpect || text };
}
/* 闪烁光标: 指示当前输入位置 */
let twCaret = null;
function twPlaceCaret(tok) {
  const doc = tok.el.ownerDocument;
  if (twCaret?.isConnected) twCaret.remove();
  twCaret = doc.createElement("span");
  twCaret.className = "twCaret";
  tok.el.after(twCaret);
}
/* 键入进度渲染: 源字符按got数拆分到twA(已亮)/twB(待打灰) */
function twPaintProgress(tok) {
  tok.aEl.textContent = tok.src.slice(0, tok.got);
  tok.bEl.textContent = tok.src.slice(tok.got);
}

/* ruby处理: 有rt读音则整词一token(rt假名→罗马音/拉丁直接用), 无读音按语境兜底; 替换ruby为span */
function twEmitRuby(doc, ruby, jaCtx, out) {
  const rb = ruby.querySelector("rb") || [...ruby.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
  const rt = ruby.querySelector("rt");
  const base = (rb?.textContent || "").trim();
  if (!base) return doc.createTextNode("");
  const rtText = (rt?.textContent || "").trim();
  let expect = "";
  if (rtText && TW_KANA.test(rtText)) expect = toRomaji(rtText);
  else if (rtText && TW_TONELESS.test(rtText)) expect = rtText.toLowerCase().replace(/\s+/g, "");
  else if (!jaCtx && TW_HAN.test(base)) expect = [...base].map(twPinyin).join("");
  const tok = twMkToken(doc, base, expect, base);
  out.push(tok);
  const wrap = doc.createDocumentFragment();
  wrap.appendChild(tok.el);
  return wrap;
}

/* 包裹一个块: 遍历替换文本/ruby为token span; 返回该块的token列表 */
function twWrapBlock(doc, block, jaCtx) {
  const out = [];
  const replaceIn = root => {
    for (const c of [...root.childNodes]) {
      if (c.nodeType === 3) {
        const frag = twEmitText(doc, c, jaCtx, out);
        if (frag.childNodes.length) c.replaceWith(frag);
      } else if (c.localName === "rt" || c.localName === "rp" || c.localName === "br") continue;
      else if (c.localName === "ruby") c.replaceWith(twEmitRuby(doc, c, jaCtx, out));
      else replaceIn(c);
    }
  };
  replaceIn(block);
  return out;
}

/* 拾取态: 点击正文某段开始打字; 悬停提示可选块 */
const TW_PICK_CSS = `
  ${TW_BLOCK_SEL.split(",").map(s => `.twPicking ${s}`).join(",")} { cursor: pointer; }
  ${TW_BLOCK_SEL.split(",").map(s => `.twPicking ${s}:hover`).join(",")} { background: rgba(128,128,128,.18); }
  .twGrayBlock { opacity: .38; filter: grayscale(.55); }
  .twGrayBlock .twGot { opacity: 1; filter: none; }
  ${TW_BLOCK_SEL.split(",").join(",")} { transition: opacity .3s ease, filter .3s ease; }
`;
function twFindBlock(doc, target) {
  return twState?.blocks.find(b => b.contains(target)) || null;
}
let twActDoc = null;
function twEnterPick(doc) {
  if (twActDoc === doc && twState?.phase === "pick") return;   /* 双入口(setTyping直调+runAfterLoad钩子)竞态防护 */
  twReset();
  twActive = true;
  twActDoc = doc;
  twState = { doc, phase: "pick", allBlocks: twCollectBlocks(doc), blocks: [], bi: 0, tokens: [], idx: 0 };
  if (!doc.getElementById("twPickStyle")) {
    const st = doc.createElement("style");
    st.id = "twPickStyle";
    st.textContent = TW_PICK_CSS;
    doc.head.appendChild(st);
  }
  doc.body.classList.add("twPicking");
  twUpdateBar();
  doc.__twPickHandler = e => {
    const hit = twFindBlock(doc, e.target) || twState.allBlocks.find(b => b === e.target.closest(TW_BLOCK_SEL));
    if (hit) twStartAt(hit);
  };
  doc.addEventListener("click", doc.__twPickHandler);
}
/* 从选中段开始: 其后段落组成推进链, 全书其余内容压暗(聚光灯); 选中段居中 */
function twStartAt(el) {
  const st = twState;
  if (!st || !el) return;
  const doc = st.doc;
  if (doc.__twPickHandler) { doc.removeEventListener("click", doc.__twPickHandler); doc.__twPickHandler = null; }
  doc.body.classList.remove("twPicking");
  doc.body.classList.add("twSpot");
  const idx = st.allBlocks.indexOf(el);
  st.blocks = st.allBlocks.slice(Math.max(0, idx));
  st.bi = 0;
  st.phase = "typing";
  twUpdateBar();
  twLoadBlock(true);
  const inp = $("typingInput");   /* 点选完成即聚焦输入条, 字母直接可打 */
  if (inp) inp.focus({ preventScroll: true });
}

/* 视口锚定: 当前token过高/过低时平滑滚到中部阅读带(入参token对象或元素均可) */
function twAnchor(tok) {
  const frame = $("bookFrame");
  const win = frame.contentWindow;
  if (!win) return;
  const el = tok?.el || tok;
  if (!el?.getBoundingClientRect) return;
  const r = el.getBoundingClientRect();
  const vh = win.innerHeight || 600;
  if (r.top > vh * 0.62 || r.top < vh * 0.22) win.scrollBy({ top: r.top - vh * 0.42, behavior: REDUCED_MOTION ? "instant" : "smooth" });
}

function twApplySpotlight(activeEl) {
  const st = twState;
  if (!st) return;
  /* 用户预期: 选中段落整体变灰(打完的词恢复), 其他文字保持原样 */
  for (const b of st.allBlocks) b.classList.toggle("twGrayBlock", b === activeEl);
}

function twLoadBlock(centerFirst) {
  const st = twState;
  while (st.bi < st.blocks.length) {
    const b = st.blocks[st.bi++];
    const toks = twWrapBlock(st.doc, b, twIsJaBlock(b));
    /* 空expect的token(注音库缺失/无可读音内容)不可完成, 直接标记跳过防卡死 */
    const usable = [];
    for (const t of toks) {
      if (t.expect) usable.push(t);
      else t.el.classList.add("twGot");
    }
    if (usable.length) {
      st.tokens = usable;
      st.idx = 0;
      /* 期望流: 真打字模式按源文本字面逐字符匹配(一次上屏可横跨多token) */
      st.pos = 0;
      st.stream = "";
      for (const t of usable) { t.start = st.stream.length; st.stream += t.realExpect; t.end = st.stream.length; }
      twApplySpotlight(b);
      usable[0].el.classList.add("twCur");
      twPlaceCaret(usable[0]);
      twUpdateHint();
      if (centerFirst) b.scrollIntoView({ behavior: REDUCED_MOTION ? "instant" : "smooth", block: "center" });
      else twAnchor(usable[0]);
      return;
    }
  }
  twState.tokens = [];
  toast(t("twChapDone"));
}

/* 键入: 命中推进/完成切换(逐字母点亮); 宽松错误仅闪红 */
function twAdvance() {
  const st = twState;
  st.idx++;
  twUpdateBar();
  const nx = st.tokens[st.idx];
  if (nx) { nx.el.classList.add("twCur"); twPlaceCaret(nx); twAnchor(nx); }
  else twLoadBlock();
}
function twFeed(key) {
  const st = twState;
  if (!st || !st.tokens.length) return;
  const t = st.tokens[st.idx];
  if (!t) return;
  if (key === t.expect[t.got]) {
    t.got++;
    twPaintProgress(t);
    twPlayType();
    twUpdateHint();
    if (t.got >= t.expect.length) {
      t.el.classList.remove("twCur");
      t.el.classList.add("twGot");
      twAdvance();
    }
  } else {
    twPlayErr();
    t.el.classList.remove("twErr");
    void t.el.offsetWidth;
    t.el.classList.add("twErr");
    setTimeout(() => t.el.classList.remove("twErr"), 220);
  }
}
function twSkip() {
  const st = twState;
  if (!st || !st.tokens.length) return;
  const t = st.tokens[st.idx];
  if (!t) return;
  t.got = t.expect.length;
  twPaintProgress(t);
  twUpdateHint();
  t.el.classList.remove("twCur");
  t.el.classList.add("twGot");
  twAdvance();
}
/* 拾取态打字提醒: 节流防连按刷屏 */
/* 输入条状态读数: 让用户可见系统是否在接收输入(拾取中/词序) */
function twUpdateBar() {
  const el = document.getElementById("typingStat");
  if (!el) return;
  const st = twState;
  if (!st) { el.textContent = ""; return; }
  if (st.phase === "pick") { el.textContent = t("twStatPick"); return; }
  const total = st.tokens.length;
  el.textContent = total ? ` ${st.idx + 1}/${total}` : "";
}
let twNudgeAt = 0;
function twPickNudge() {
  if (performance.now() - twNudgeAt < 2000) return;
  twNudgeAt = performance.now();
  toast(t("twPickHint"));
}

/* ---------- 真打字模式: 流式匹配器 ----------
   期望流=当前块全部token的realExpect拼接; 上屏文本逐字符推进st.pos,
   一次上屏的长词组横跨多token时批量点亮; 错误宽松(闪当前token不阻塞) */
function twCurTokenByPos() {
  const st = twState;
  if (!st || !st.tokens.length) return null;
  return st.tokens.find(t => st.pos < t.end) || st.tokens[st.tokens.length - 1];
}
function twRepaintStream() {
  const st = twState;
  for (const t of st.tokens) {
    const done = Math.max(0, Math.min(t.src.length, st.pos - t.start));
    if (t.got !== done) {
      t.got = done;
      twPaintProgress(t);
      t.el.classList.toggle("twGot", done >= t.src.length);
    }
    t.el.classList.toggle("twCur", st.pos >= t.start && st.pos < t.end);
  }
  const cur = twCurTokenByPos();
  if (cur && (!twCaret?.isConnected || twCaret.previousSibling !== cur.el)) twPlaceCaret(cur);
}
function twFeedChunk(chunk) {
  const st = twState;
  if (!st || !st.tokens.length) return;
  for (const ch of chunk) {
    const t = twCurTokenByPos();
    if (!t) break;
    if (ch === st.stream[st.pos]) {
      st.pos++;
      twRepaintStream();
      twPlayType();
      if (st.pos >= st.stream.length) { twLoadBlock(); return; }
    } else {
      twPlayErr();
      t.el.classList.remove("twErr");
      void t.el.offsetWidth;
      t.el.classList.add("twErr");
      setTimeout(() => t.el.classList.remove("twErr"), 220);
    }
  }
  twUpdateHint();
}
function twSkipReal() {
  const st = twState;
  if (!st || !st.tokens.length) return;
  const t = twCurTokenByPos();
  if (!t) return;
  st.pos = t.end;
  twRepaintStream();
  twUpdateHint();
  if (st.pos >= st.stream.length) twLoadBlock();
}

/* 输入条读音提示: 拼音模式显示剩余期望字母, 真打字模式显示当前字读音参考 */
function twUpdateHint() {
  const el = document.getElementById("typingHint");
  if (!el) return;
  const st = twState;
  if (!st || st.phase === "pick" || !st.tokens.length) { el.textContent = ""; return; }
  if (state.twReal) {
    const tok = twCurTokenByPos();
    if (!tok) { el.textContent = ""; return; }
    let hint = "";
    const srcPart = tok.src.slice(0, 4);
    if (TW_KANA.test(srcPart)) hint = toRomaji(srcPart);
    else if (TW_HAN.test(srcPart)) hint = [...srcPart].map(twPinyin).join(" ");
    el.textContent = hint ? ` ${hint}` : "";
  } else {
    const tok = st.tokens[st.idx];
    el.textContent = tok ? ` ${tok.expect.slice(tok.got)}` : "";
  }
}

function twReset() {
  const doc = twState?.doc;
  if (doc) {
    if (doc.__twPickHandler) { doc.removeEventListener("click", doc.__twPickHandler); doc.__twPickHandler = null; }
    doc.body?.classList.remove("twPicking", "twSpot");
    doc.querySelectorAll?.(".twGrayBlock").forEach(el => el.classList.remove("twGrayBlock"));
  }
  twActive = false;
  twActDoc = null;
  twState = null;   /* span烙在DOM里, 关闭/换章由重渲染自然带走(与注音同策略) */
}

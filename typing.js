/* typing.js — 打字模式: 照书打字驱动阅读(只按 a-z: 英文字母/中文无声调全拼/日文wapuro罗马音)
   打字驱动推进, 当前行视口锚定; 宽松错误(闪红不阻塞); Tab跳过当前token, Esc退出
   依赖运行期全局: $(reader.js) state t toast ensurePinyinLib toRomaji KANA_DIGRAPH(pinyin.js)
   safeShowUnit/rerenderReader/setReadMode(reader.js); 加载顺序: pinyin.js → typing.js → reader.js */
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
      out.push(twMkToken(doc, word, word.toLowerCase()));
      frag.appendChild(out[out.length - 1].el);
      i = j; continue;
    }
    if (TW_HAN.test(ch)) {
      if (jaCtx) { plain += ch; i++; continue; }   /* 日语语境汉字无读音字典: 跳过不包 */
      flushPlain();
      out.push(twMkToken(doc, ch, twPinyin(ch)));
      frag.appendChild(out[out.length - 1].el);
      i++; continue;
    }
    if (TW_KANA.test(ch)) {
      flushPlain();
      /* 拄音两字符一token(wapuro), 其余单字 */
      const two = ch + kata2hira(text[i + 1] || "");
      const len = KANA_DIGRAPH[two] ? 2 : 1;
      const piece = text.slice(i, i + len);
      out.push(twMkToken(doc, piece, toRomaji(piece)));
      frag.appendChild(out[out.length - 1].el);
      i += len; continue;
    }
    plain += ch; i++;   /* 标点/空白等: 不打, 保持原样 */
  }
  flushPlain();
  return frag;
}
const TW_LATIN_RE = /[a-zA-Z]/;

function twMkToken(doc, text, expect) {
  const el = doc.createElement("span");
  el.className = "twTok";
  el.textContent = text;
  return { el, expect: expect || "", got: 0 };
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
  const tok = twMkToken(doc, base, expect);
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

/* 视口锚定: 当前token过高/过低时平滑滚到中部阅读带 */
function twAnchor(el) {
  const frame = $("bookFrame");
  const win = frame.contentWindow;
  if (!win) return;
  const r = el.getBoundingClientRect();
  const vh = win.innerHeight || 600;
  if (r.top > vh * 0.62 || r.top < vh * 0.22) win.scrollBy({ top: r.top - vh * 0.42, behavior: REDUCED_MOTION ? "instant" : "smooth" });
}

function twLoadBlock() {
  const st = twState;
  while (st.bi < st.blocks.length) {
    const b = st.blocks[st.bi++];
    const toks = twWrapBlock(st.doc, b, twIsJaBlock(b));
    if (toks.length) {
      st.tokens = toks;
      st.idx = 0;
      toks[0].el.classList.add("twCur");
      twAnchor(toks[0].el);
      return;
    }
  }
  twState.tokens = [];
  toast(t("twChapDone"));
}

/* 键入: 命中推进/完成切换; 宽松错误仅闪红 */
function twFeed(key) {
  const st = twState;
  if (!st || !st.tokens.length) return;
  const t = st.tokens[st.idx];
  if (!t) return;
  if (key === t.expect[t.got]) {
    t.got++;
    if (t.got >= t.expect.length) {
      t.el.classList.remove("twCur");
      t.el.classList.add("twGot");
      st.idx++;
      const nx = st.tokens[st.idx];
      if (nx) { nx.el.classList.add("twCur"); twAnchor(nx.el); }
      else twLoadBlock();
    }
  } else {
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
  t.el.classList.remove("twCur");
  t.el.classList.add("twGot");
  st.idx++;
  const nx = st.tokens[st.idx];
  if (nx) { nx.el.classList.add("twCur"); twAnchor(nx.el); }
  else twLoadBlock();
}

function twActivate(doc) {
  twReset();
  twActive = true;
  twState = { doc, blocks: twCollectBlocks(doc), bi: 0, tokens: [], idx: 0 };
  twLoadBlock();
}
function twReset() {
  twActive = false;
  twState = null;   /* span烙在DOM里, 关闭/换章由重渲染自然带走(与注音同策略) */
}

/* Simple EPUB Reader i18n — 中英词典与文案辅助。需在 reader.js 之前加载。 */
"use strict";

const I18N_STRINGS = {
  zh: {
    /* 工具栏 */
    toc: "目录", search: "搜索", autoRead: "自动阅读",
    modeTip: "切换滚动/翻页模式", settings: "阅读设置", menu: "菜单",
    speedSlow: "慢", speedFast: "快", autoReadSpeedAria: "自动阅读速度",
    menuOpen: "打开书籍…", menuCloseBook: "✕　关闭书籍",
    /* 设置面板 */
    secTheme: "系统主题", themeLight: "米白", themeWhite: "纯白", themeSepia: "羊皮纸", themeGreen: "护眼绿", themeDark: "深色",
    secCustom: "自定义主题",
    ctBgLabel: "纸面颜色", ctFgLabel: "文字颜色",
    colorAriaBg: "自定义纸面颜色", colorAriaFg: "自定义文字颜色",
    ctReset: "重置本槽为初始配色", customSlotN: "自定义{0}",
    advMore: "更多颜色", advAutoTitle: "恢复自动派生",
    advUi: "界面底色", advUiAria: "界面底色颜色",
    advFg: "界面文字", advMuted: "次要文字", advBorder: "边框", advButton: "按钮", advAccent: "强调色",
    advFgAria: "界面文字颜色", advMutedAria: "次要文字颜色", advBorderAria: "边框颜色", advButtonAria: "按钮颜色", advAccentAria: "强调色",
    secType: "排版",
    fontSize: "字号", fsMinusTip: "减小字体", fsPlusTip: "增大字体",
    fontSizeRangeAria: "字体大小", fontSizeNumAria: "字体大小数值",
    lineHeight: "行距", lhMinusTip: "减小行距", lhPlusTip: "增大行距",
    lineHeightRangeAria: "行距", lineHeightNumAria: "行距数值",
    fontFamily: "字体", fontSerif: "衬线（宋）", fontSans: "无衬线（黑）", fontFamilyAria: "正文字体",
    bookFontTip: "开启后书籍自带的字体声明(含内嵌字体)优先于阅读器字体设置",
    bookFontLabel: "书籍字体优先",
    pinyinLabel: "拼音标注", pinyinAria: "开启拼音标注", pinyinTip: "在汉字上方标注拼音; 首次开启需联网加载注音库, 之后离线可用", pinyinLoadFail: "注音库加载失败, 请检查网络后重试", bookFontAria: "书籍字体优先",
    secWidth: "正文宽度",
    maxWTip: "开启后正文限制最大宽度", maxWLabel: "限宽", maxWAria: "限制正文宽度", maxWRangeAria: "正文最大宽度",
    cwMinusTip: "减小宽度", cwPlusTip: "增大宽度", contentMaxNumAria: "正文宽度数值",
    sideReset: "恢复默认",
    langAuto: "自动",
    /* 侧边栏 */
    tabToc: "目录", tabSearch: "搜索",
    pinTip: "固定侧边栏", pinActiveTip: "侧边栏已固定，点击改为浮动", pinAria: "固定/浮动侧边栏",
    searchPh: "全书搜索…",
    /* 欢迎页 */
    shelfH: "书架", welcomeP: "把 EPUB / TXT 文件拖到这里，或者点击“选择文件”。", welcomeBtn: "选择文件",
    frameTitle: "书籍内容",
    /* 状态栏 */
    sbPrevTip: "上一章", noBook: "未打开书籍", sbNextTip: "下一章",
    dropOverlay: "松开以打开文件",
    /* 运行时 */
    zipBad: "不是有效的 ZIP/EPUB 文件", zip64: "暂不支持 ZIP64 EPUB", zipEmpty: "空 ZIP",
    cdBroken: "损坏的 ZIP central directory", lhBroken: "损坏的 ZIP local header",
    resMissing: "EPUB 内找不到资源: {0}", resEncrypted: "资源已加密，暂不支持: {0}",
    noDecompress: "Firefox 版本过低，缺少 DecompressionStream", zipMethod: "暂不支持 ZIP 压缩方式: {0}",
    crcFail: "数据校验失败: {0}",
    noOpf: "找不到 EPUB OPF", noSpine: "EPUB 没有可显示的章节",
    htmlParseFail: "章节内容解析失败",
    lostFile: "书籍文件已丢失，请重新选择文件",
    chapterFail: "章节加载失败: {0}", autoFlipFail: "自动翻章失败: {0}",
    badFileType: "请选择 EPUB 或 TXT 文件",
    layoutWhole: "全书排版中…", linkOutsideSpine: "链接目标不在阅读列表中: {0}",
    scanned: "已扫描 {0}/{1} 章…",
    resultsMeta: "{0} 处结果（{1} 章）", capNote: "，仅显示前 200 条", noResults: "无结果",
    chapterN: "第 {0} 章", progressLabel: "第 {0} / {1} 章",
    txtOpening: "开头", txtPart: "第 {0} 部分",
    shelfPos: "第 {0}/{1} 章 · ", shelfDelTip: "从书架移除"
  },
  en: {
    toc: "Contents", search: "Search", autoRead: "Auto-read",
    modeTip: "Toggle scroll/paged mode", settings: "Reading settings", menu: "Menu",
    speedSlow: "Slow", speedFast: "Fast", autoReadSpeedAria: "Auto-read speed",
    menuOpen: "Open book…", menuCloseBook: "✕　Close book",
    secTheme: "Built-in themes", themeLight: "Cream", themeWhite: "White", themeSepia: "Sepia", themeGreen: "Green", themeDark: "Dark",
    secCustom: "Custom themes",
    ctBgLabel: "Paper color", ctFgLabel: "Text color",
    colorAriaBg: "Custom paper color", colorAriaFg: "Custom text color",
    ctReset: "Reset slot to initial colors", customSlotN: "Custom {0}",
    advMore: "More colors", advAutoTitle: "Back to auto",
    advUi: "Interface color", advUiAria: "Interface color",
    advFg: "Interface text", advMuted: "Muted text", advBorder: "Borders", advButton: "Buttons", advAccent: "Accent",
    advFgAria: "Interface text color", advMutedAria: "Muted text color", advBorderAria: "Border color", advButtonAria: "Button color", advAccentAria: "Accent color",
    secType: "Typography",
    fontSize: "Font size", fsMinusTip: "Smaller font", fsPlusTip: "Larger font",
    fontSizeRangeAria: "Font size", fontSizeNumAria: "Font size value",
    lineHeight: "Line height", lhMinusTip: "Smaller line height", lhPlusTip: "Larger line height",
    lineHeightRangeAria: "Line height", lineHeightNumAria: "Line height value",
    fontFamily: "Font", fontSerif: "Serif", fontSans: "Sans-serif", fontFamilyAria: "Body font",
    bookFontTip: "When on, the book's own font declarations (incl. embedded fonts) take priority over reader settings",
    bookFontLabel: "Prefer book fonts",
    pinyinLabel: "Pinyin", pinyinAria: "Toggle pinyin annotation", pinyinTip: "Show pinyin above Chinese characters; the annotation library is fetched online on first use, offline afterwards", pinyinLoadFail: "Failed to load the pinyin library, please check your network and retry", bookFontAria: "Prefer book fonts",
    secWidth: "Content width",
    maxWTip: "Cap the maximum content width when on", maxWLabel: "Limit width", maxWAria: "Limit content width", maxWRangeAria: "Maximum content width",
    cwMinusTip: "Narrower", cwPlusTip: "Wider", contentMaxNumAria: "Content width value",
    sideReset: "Restore defaults",
    langAuto: "Auto",
    tabToc: "Contents", tabSearch: "Search",
    pinTip: "Pin sidebar", pinActiveTip: "Sidebar pinned — click to float again", pinAria: "Pin/unpin sidebar",
    searchPh: "Search whole book…",
    shelfH: "Library", welcomeP: "Drop an EPUB / TXT file here, or click “Choose File”.", welcomeBtn: "Choose File",
    frameTitle: "Book content",
    sbPrevTip: "Previous chapter", noBook: "No book open", sbNextTip: "Next chapter",
    dropOverlay: "Drop to open",
    zipBad: "Not a valid ZIP/EPUB file", zip64: "ZIP64 EPUB not supported yet", zipEmpty: "Empty ZIP",
    cdBroken: "Corrupt ZIP central directory", lhBroken: "Corrupt ZIP local header",
    resMissing: "Resource not found in EPUB: {0}", resEncrypted: "Encrypted resource unsupported: {0}",
    noDecompress: "Firefox too old: DecompressionStream missing", zipMethod: "Unsupported ZIP compression method: {0}",
    crcFail: "Checksum mismatch: {0}",
    noOpf: "EPUB OPF not found", noSpine: "EPUB has no readable chapters",
    htmlParseFail: "Failed to parse chapter content",
    lostFile: "Book file is missing; please pick the file again",
    chapterFail: "Failed to load chapter: {0}", autoFlipFail: "Auto next-chapter failed: {0}",
    badFileType: "Please choose an EPUB or TXT file",
    layoutWhole: "Laying out whole book…", linkOutsideSpine: "Link target not in reading list: {0}",
    scanned: "Scanned {0}/{1} chapters…",
    resultsMeta: "{0} results in {1} chapters", capNote: "; showing first 200", noResults: "No results",
    chapterN: "Chapter {0}", progressLabel: "Chapter {0} / {1}",
    txtOpening: "Start", txtPart: "Part {0}",
    shelfPos: "Ch. {0}/{1} · ", shelfDelTip: "Remove from library"
  }
};

let i18nLangCache = null;
function currentLang() {
  if (i18nLangCache) return i18nLangCache;
  const saved = localStorage.getItem("lang");
  let lang;
  if (saved === "zh" || saved === "en") lang = saved;
  else {
    const nav = (navigator.language || "").toLowerCase();
    lang = nav.startsWith("zh") ? "zh" : nav.startsWith("en") ? "en" : "zh";
  }
  i18nLangCache = lang;
  return lang;
}
function invalidateLangCache() { i18nLangCache = null; }

/* t("key", a, b): 取当前语言文案, {0}{1} 按序替换; 缺键回退中文再回退键名 */
function t(key, ...args) {
  const d = I18N_STRINGS[currentLang()] || I18N_STRINGS.zh;
  let s = d[key] != null ? d[key] : I18N_STRINGS.zh[key] != null ? I18N_STRINGS.zh[key] : key;
  for (let i = 0; i < args.length; i++) s = s.replaceAll(`{${i}}`, String(args[i]));
  return s;
}

/* 应用静态标注: data-i18n→textContent, data-i18n-title→title, data-i18n-ph→placeholder, data-i18n-aria→aria-label */
function applyI18nStatic(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => el.textContent = t(el.dataset.i18n));
  root.querySelectorAll("[data-i18n-title]").forEach(el => el.title = t(el.dataset.i18nTitle));
  root.querySelectorAll("[data-i18n-ph]").forEach(el => el.placeholder = t(el.dataset.i18nPh));
  root.querySelectorAll("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
}

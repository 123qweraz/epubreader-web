/* Simple EPUB Reader i18n — 中英词典与文案辅助。需在 reader.js 之前加载。 */
"use strict";

const I18N_STRINGS = {
  zh: {
    /* 工具栏 */
    toc: "目录", search: "搜索", autoRead: "自动阅读",
    modeTip: "切换滚动/翻页模式", settings: "阅读设置", menu: "菜单",
    speedSlow: "慢", speedFast: "快", autoReadSpeedAria: "自动阅读速度",
    closeBook: "关闭书籍",
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
    secShelf: "书架", shelfViewLabel: "视图", viewGrid: "网格", viewList: "列表",
    tabAppearance: "外观", tabLayout: "排版", tabBackup: "备份", tabAdvanced: "高级", secBackup: "数据备份", secAdvanced: "高级功能",
    fontSize: "字号", fsMinusTip: "减小字体", fsPlusTip: "增大字体",
    fontSizeRangeAria: "字体大小", fontSizeNumAria: "字体大小数值",
    lineHeight: "行距", lhMinusTip: "减小行距", lhPlusTip: "增大行距",
    lineHeightRangeAria: "行距", lineHeightNumAria: "行距数值",
    fontFamily: "字体", fontSerif: "衬线（宋）", fontSans: "无衬线（黑）", fontFamilyAria: "正文字体",
    bookFontTip: "开启后书籍自带的字体声明(含内嵌字体)优先于阅读器字体设置", vertLabel: "竖排阅读", vertAria: "竖排阅读", vertTip: "传统竖排(右起左行)，仅翻页模式；开启时自动切换到翻页模式",
    bookFontLabel: "书籍字体优先",
    pinyinLabel: "外挂注音", pinyinAria: "注音模式", annOff: "关", annPinyin: "拼音", annRomaji: "罗马音", annPyOnly: "纯拼音", pinyinSessionTip: "拼音为汉字标注，罗马音为日语假名标注（书内假名注音一并转换），纯拼音直接用拼音替换汉字正文；不影响书籍原生注音的显示。开启状态不做持久化，每次打开应用需重新开启。", pinyinNativeRuby: "本书自带注音，外挂注音不会覆盖已有注音", pinyinLoadFail: "注音库加载失败, 请检查网络后重试",     pinyinTooLong: "文本过长, 部分内容已跳过拼音标注", twTip: "打字模式: 只按字母键(英文打单词·中文打拼音·日文打罗马音), 打字驱动阅读; Esc退出 Tab跳词", twAria: "打字模式", twNoVert: "竖排暂不支持打字模式", twPickHint: "点击一段文字开始打字（Esc 退出）", twChapDone: "本章打完，已到末尾", bookFontAria: "书籍字体优先", chapFailTitle: "本章无法显示", chapFailBody: "该章节文件缺失或已损坏，其余章节不受影响",
    secWidth: "正文宽度",
    maxWTip: "开启后正文限制最大宽度", maxWLabel: "限宽", maxWAria: "限制正文宽度", maxWRangeAria: "正文最大宽度",
    cwMinusTip: "减小宽度", cwPlusTip: "增大宽度", contentMaxNumAria: "正文宽度数值",
    sideReset: "恢复默认",
    langAuto: "自动",
    /* 侧边栏 */
    tabToc: "目录", tabSearch: "搜索", tabMindMap: "导图",
    pinTip: "固定侧边栏", pinActiveTip: "侧边栏已固定，点击改为浮动", pinAria: "固定/浮动侧边栏",
    maxTip: "最大化面板", maxAria: "最大化面板", restoreTip: "还原面板", restoreAria: "还原面板",
    closeSideTip: "关闭面板", closeSideAria: "关闭面板",
    searchPh: "全书搜索…",
    mmEmpty: "无目录数据，无法生成导图",
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
    noDecompress: "浏览器版本过低，缺少 DecompressionStream", zipMethod: "暂不支持 ZIP 压缩方式: {0}",
    crcFail: "数据校验失败: {0}",
    noOpf: "找不到 EPUB OPF", noSpine: "EPUB 没有可显示的章节",
    htmlParseFail: "章节内容解析失败",
    lostFileRelink: "书籍文件未随备份保存，请在弹出的窗口中重新选择该文件",
    relinkMismatch: "所选文件与该书目不匹配，需要同名同大小的原文件",
    chapterFail: "章节加载失败: {0}", autoFlipFail: "自动翻章失败: {0}",
    badFileType: "请选择 EPUB 或 TXT 文件",
    layoutWhole: "全书排版中…", linkOutsideSpine: "链接目标不在阅读列表中: {0}",
    scanned: "已扫描 {0}/{1} 章…",
    resultsMeta: "{0} 处结果（{1} 章）", capNote: "，仅显示前 200 条", noResults: "无结果",
    chapterN: "第 {0} 章", progressLabel: "第 {0} / {1} 章",
    txtOpening: "开头", txtPart: "第 {0} 部分",
    shelfPos: "第 {0}/{1} 章 · ", shelfDelTip: "从书架移除",
    shelfRemoved: "已从书架移除", undo: "撤销",
    shelfEdit: "编辑", selectAll: "全选", deselectAll: "取消全选",
    delSelected: "删除", done: "完成", selOn: "已选中",
    batchRemoved: "已选 {0} 本，即将移出书架",
    exportData: "导出阅读数据", importData: "导入阅读数据",
    backupExported: "备份已导出",
    shelfGhost: "待关联", ghostTip: "点击选择本地文件恢复此书",
    relinkBtn: "恢复未关联书籍", relinkResult: "已恢复 {0} 本，{1} 本未能匹配",
    backupBad: "不是有效的备份文件",
    backupDone: "已导入 {0} 项设置、{1} 本书目"
  },
  en: {
    toc: "Contents", search: "Search", autoRead: "Auto-read",
    modeTip: "Toggle scroll/paged mode", settings: "Reading settings", menu: "Menu",
    speedSlow: "Slow", speedFast: "Fast", autoReadSpeedAria: "Auto-read speed",
    closeBook: "Close book",
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
    secShelf: "Shelf", shelfViewLabel: "View", viewGrid: "Grid", viewList: "List",
    tabAppearance: "Appearance", tabLayout: "Layout", tabBackup: "Backup", tabAdvanced: "Advanced", secBackup: "Data backup", secAdvanced: "Advanced",
    fontSize: "Font size", fsMinusTip: "Smaller font", fsPlusTip: "Larger font",
    fontSizeRangeAria: "Font size", fontSizeNumAria: "Font size value",
    lineHeight: "Line height", lhMinusTip: "Smaller line height", lhPlusTip: "Larger line height",
    lineHeightRangeAria: "Line height", lineHeightNumAria: "Line height value",
    fontFamily: "Font", fontSerif: "Serif", fontSans: "Sans-serif", fontFamilyAria: "Body font",
    bookFontTip: "When on, the book's own font declarations (incl. embedded fonts) take priority over reader settings", vertLabel: "Vertical text", vertAria: "Vertical text mode", vertTip: "Traditional vertical layout (right-to-left columns), paged mode only; switches to paged automatically when enabled",
    bookFontLabel: "Prefer book fonts",
    pinyinLabel: "Annotation", pinyinAria: "Annotation mode", annOff: "Off", annPinyin: "Pinyin", annRomaji: "Romaji", annPyOnly: "Pinyin only", pinyinSessionTip: "Pinyin annotates Chinese characters, romaji annotates Japanese kana (book furigana converted too), pinyin-only replaces Chinese text with plain pinyin; built-in annotations stay intact. Not persisted, re-enable each session.", pinyinNativeRuby: "This book has its own annotations; overlay pinyin will not override them", pinyinLoadFail: "Failed to load the annotation library, please check your network and retry",     pinyinTooLong: "Text too long; annotation was skipped for some parts", twTip: "Typing mode: letters only (English words · Chinese pinyin · Japanese romaji); typing drives reading; Esc to exit, Tab to skip", twAria: "Typing mode", twNoVert: "Typing mode is not supported in vertical layout yet", twPickHint: "Click a paragraph to start typing (Esc to exit)", twChapDone: "Chapter typed to the end", bookFontAria: "Prefer book fonts", chapFailTitle: "Chapter unavailable", chapFailBody: "This chapter's file is missing or corrupted; other chapters are unaffected.",
    secWidth: "Content width",
    maxWTip: "Cap the maximum content width when on", maxWLabel: "Limit width", maxWAria: "Limit content width", maxWRangeAria: "Maximum content width",
    cwMinusTip: "Narrower", cwPlusTip: "Wider", contentMaxNumAria: "Content width value",
    sideReset: "Restore defaults",
    langAuto: "Auto",
    tabToc: "Contents", tabSearch: "Search", tabMindMap: "Map",
    pinTip: "Pin sidebar", pinActiveTip: "Sidebar pinned — click to float again", pinAria: "Pin/unpin sidebar",
    maxTip: "Maximize panel", maxAria: "Maximize panel", restoreTip: "Restore panel", restoreAria: "Restore panel",
    closeSideTip: "Close panel", closeSideAria: "Close panel",
    searchPh: "Search whole book…",
    mmEmpty: "No TOC data — mind map unavailable",
    shelfH: "Library", welcomeP: "Drop an EPUB / TXT file here, or click “Choose File”.", welcomeBtn: "Choose File",
    frameTitle: "Book content",
    sbPrevTip: "Previous chapter", noBook: "No book open", sbNextTip: "Next chapter",
    dropOverlay: "Drop to open",
    zipBad: "Not a valid ZIP/EPUB file", zip64: "ZIP64 EPUB not supported yet", zipEmpty: "Empty ZIP",
    cdBroken: "Corrupt ZIP central directory", lhBroken: "Corrupt ZIP local header",
    resMissing: "Resource not found in EPUB: {0}", resEncrypted: "Encrypted resource unsupported: {0}",
    noDecompress: "Browser too old: DecompressionStream missing", zipMethod: "Unsupported ZIP compression method: {0}",
    crcFail: "Checksum mismatch: {0}",
    noOpf: "EPUB OPF not found", noSpine: "EPUB has no readable chapters",
    htmlParseFail: "Failed to parse chapter content",
    lostFileRelink: "Book files are not included in backups; please pick the file in the dialog that opens",
    relinkMismatch: "Selected file doesn't match this record; the original file with same name and size is required",
    chapterFail: "Failed to load chapter: {0}", autoFlipFail: "Auto next-chapter failed: {0}",
    badFileType: "Please choose an EPUB or TXT file",
    layoutWhole: "Laying out whole book…", linkOutsideSpine: "Link target not in reading list: {0}",
    scanned: "Scanned {0}/{1} chapters…",
    resultsMeta: "{0} results in {1} chapters", capNote: "; showing first 200", noResults: "No results",
    chapterN: "Chapter {0}", progressLabel: "Chapter {0} / {1}",
    txtOpening: "Start", txtPart: "Part {0}",
    shelfPos: "Ch. {0}/{1} · ", shelfDelTip: "Remove from library",
    shelfRemoved: "Removed from library", undo: "Undo",
    shelfEdit: "Edit", selectAll: "Select all", deselectAll: "Deselect all",
    delSelected: "Delete", done: "Done", selOn: "Selected",
    batchRemoved: "{0} selected, about to be removed",
    exportData: "Export reading data", importData: "Import reading data",
    backupExported: "Backup exported",
    shelfGhost: "Not linked", ghostTip: "Click to pick the local file and restore this book",
    relinkBtn: "Restore unlinked books", relinkResult: "Restored {0}, {1} unmatched",
    backupBad: "Invalid backup file",
    backupDone: "Imported {0} preferences, {1} book records"
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

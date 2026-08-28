/* EPUB Reader 网页版 Service Worker: 应用外壳离线缓存
   发版时需手动递增 VERSION 以淘汰旧缓存 */
const VERSION = "v55";
const CACHE = `epubreader-shell-${VERSION}`;
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./reader.css",
  "./vendor/pinyin-pro.min.js",
  "./pinyin.js",
  "./engine.js",
  "./pager.js",
  "./reader.js",
  "./typing.js",
  "./mindmap.js",
  "./i18n.js",
  "./icons/icon.svg",
  "./icons/icon32.png",
  "./icons/icon192.png",
  "./icons/icon512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll())
      .then(cs => cs.forEach(c => c.postMessage({ type: "shell-version", version: VERSION })))
  );
});

/* 页面加载时主动询问当前运行的资源版本(版本握手) */
self.addEventListener("message", e => {
  if (e.data === "version" && e.source)
    e.source.postMessage({ type: "shell-version", version: VERSION });
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  /* 页面导航网络优先: 保证发版后用户尽快拿到新 HTML, 断网回退缓存 */
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  /* 其余静态资源: 缓存优先, 命中同时后台刷新 */
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});

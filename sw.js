// sw.js
const CACHE_NAME = 'smart-prism-v3.1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './logo.png', // 如果有
    // 把你用到的 CDN 地址全部列在这里
    './lib/echarts.min.js',
    './lib/xlsx.full.min.js',
    './lib/dataTool.min.js',
    './lib/marked.min.js',
    './lib/katex.min.css',
    './lib/katex.min.js',
    './lib/auto-render.min.js',
    './lib/mhchem.min.js',
    './lib/localforage.min.js',
    './lib/html2canvas.min.js',
    './lib/jszip.min.js',
    './lib/FileSaver.min.js',
    
    './lib/fonts/KaTeX_Main-Regular.woff2',
    './lib/fonts/KaTeX_Math-Italic.woff2',
    './lib/fonts/KaTeX_Main-Bold.woff2',
    './lib/fonts/KaTeX_Size1-Regular.woff2'
];

// 安装 SW
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Opened cache');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// 拦截网络请求
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            // 如果缓存里有，直接返回缓存
            if (response) {
                return response;
            }
            // 否则去网络请求
            return fetch(event.request);
        })
    );
});

// 更新 SW (清理旧缓存)
self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
// sw.js
const CACHE_NAME = 'smart-prism-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './logo.png', // 如果有
    // 把你用到的 CDN 地址全部列在这里
    'https://cdn.bootcdn.net/ajax/libs/echarts/5.4.3/echarts.min.js',
    'https://cdn.bootcdn.net/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdn.bootcdn.net/ajax/libs/echarts-datatool/2.0.1/dataTool.min.js',
    'https://cdn.bootcdn.net/ajax/libs/marked/12.0.0/marked.min.js',
    'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.css',
    'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.js',
    'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js',
    'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/contrib/mhchem.min.js',
    'https://cdn.bootcdn.net/ajax/libs/localforage/1.10.0/localforage.min.js',
    'https://cdn.bootcdn.net/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdn.bootcdn.net/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.bootcdn.net/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js',
    // 字体文件
    'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/fonts/KaTeX_Main-Regular.woff2',
    'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/fonts/KaTeX_Math-Italic.woff2'
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
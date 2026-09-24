// ==UserScript==
// @name         Send to 115 Offline
// @namespace    https://github.com/lgithubl/send-to-115-userscript
// @version      0.2.0
// @description  Send selected cloud links to 115 offline download without replacing the native context menu.
// @author       lgithubl
// @license      MIT
// @match        *://*/*
// @run-at       document-end
// @noframes
// @connect      115.com
// @connect      my.115.com
// @connect      webapi.115.com
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    wpPathIdKey: 'send_to_115_wp_path_id',
    requestTimeout: 30000,
    maxBatchSize: 50,
  };

  const API = {
    sign: () => `https://115.com/?ct=offline&ac=space&_=${Date.now()}`,
    downpath: () => `https://webapi.115.com/offine/downpath?limit=1150&_=${Date.now()}`,
    userInfo: () => `https://my.115.com/?ct=ajax&ac=nav&_=${Date.now()}`,
    addMany: 'https://115.com/web/lixian/?ct=lixian&ac=add_task_urls',
  };

  let lastContext = {
    urls: [],
    text: '',
  };

  GM_addStyle(`
    .send-to-115-toast {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      max-width: min(360px, calc(100vw - 32px));
      padding: 10px 12px;
      border: 1px solid rgba(0, 0, 0, .14);
      border-radius: 8px;
      background: #111827;
      box-shadow: 0 10px 28px rgba(0, 0, 0, .18);
      color: #fff;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .send-to-115-toast strong {
      display: block;
      margin-bottom: 2px;
      font-size: 13px;
    }
    .send-to-115-toast span {
      display: block;
      color: #d1d5db;
      overflow-wrap: anywhere;
    }
  `);

  GM_registerMenuCommand('发送到 115（选中/最近右键内容）', () => {
    const urls = lastContext.urls.length ? lastContext.urls : collectCurrentUrls();
    sendUrls(urls);
  });

  GM_registerMenuCommand('设置 115 保存目录 wp_path_id', () => {
    const current = GM_getValue(CONFIG.wpPathIdKey, '');
    const next = window.prompt('输入 115 目标目录 wp_path_id，留空则使用默认云下载目录：', current);
    if (next === null) return;
    GM_setValue(CONFIG.wpPathIdKey, next.trim());
    notify('115 保存目录已更新', next.trim() || '使用默认云下载目录');
  });

  document.addEventListener('contextmenu', (event) => {
    const urls = collectEventUrls(event);
    lastContext = {
      urls,
      text: getSelectionText() || getLinkHref(event.target) || '',
    };
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!event.altKey || !event.shiftKey || event.key !== '1') return;
    event.preventDefault();
    sendUrls(collectCurrentUrls());
  });

  function collectEventUrls(event) {
    const selectedText = getSelectionText();
    const linkHref = getLinkHref(event.target);
    const linkText = getLinkText(event.target);

    return extractLinks([
      selectedText,
      linkHref,
      linkText,
    ].filter(Boolean).join('\n'));
  }

  function collectCurrentUrls() {
    return extractLinks([
      getSelectionText(),
      lastContext.text,
      location.href,
    ].filter(Boolean).join('\n'));
  }

  function extractLinks(text) {
    if (!text) return [];

    const patterns = [
      /magnet:\?[^\s"'<>，。；、）)】\]]+/gi,
      /ed2k:\/\/\|file\|[^\s"'<>]+/gi,
      /https?:\/\/[^\s"'<>]+/gi,
    ];

    const urls = [];
    for (const pattern of patterns) {
      const matches = text.match(pattern) || [];
      for (const match of matches) {
        const cleaned = cleanUrl(match);
        if (cleaned) urls.push(cleaned);
      }
    }

    return Array.from(new Set(urls));
  }

  function cleanUrl(url) {
    return decodeHtml(url)
      .replace(/[),.;，。；、]+$/g, '')
      .trim();
  }

  function decodeHtml(value) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
  }

  function getSelectionText() {
    return String(window.getSelection ? window.getSelection() : '').trim();
  }

  function getLinkHref(target) {
    const link = target && target.closest ? target.closest('a[href]') : null;
    return link ? link.href : '';
  }

  function getLinkText(target) {
    const link = target && target.closest ? target.closest('a[href]') : null;
    return link ? link.textContent.trim() : '';
  }

  async function sendUrls(urls) {
    const uniqueUrls = Array.from(new Set(urls || []));
    if (!uniqueUrls.length) {
      notify('未识别到可发送的链接');
      return;
    }

    try {
      notify('正在发送到 115', `${uniqueUrls.length} 条链接`);
      const chunks = chunk(uniqueUrls, CONFIG.maxBatchSize);
      const results = [];

      for (const urlsChunk of chunks) {
        results.push(await addTasks(urlsChunk));
      }

      const failed = results.filter((item) => !item.state);
      if (failed.length) {
        const message = failed.map((item) => item.error_msg || item.msg || '未知错误').join('; ');
        throw new Error(message);
      }

      notify('115 离线任务已添加', `${uniqueUrls.length} 条链接`);
    } catch (error) {
      notify('发送到 115 失败', error.message || String(error));
      console.error('[Send to 115]', error);
    }
  }

  async function addTasks(urls) {
    const token = await getSignToken();
    const userId = token.userId || await getOptionalUserId();

    const params = new URLSearchParams();
    params.set('savepath', '');
    params.set('wp_path_id', GM_getValue(CONFIG.wpPathIdKey, ''));
    if (userId) params.set('uid', userId);
    params.set('sign', token.sign);
    params.set('time', token.time);

    urls.forEach((url, index) => {
      params.set(`url[${index}]`, url);
    });

    const response = await request({
      method: 'POST',
      url: API.addMany,
      data: params.toString(),
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': 'https://115.com',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    return parseJson(response.responseText);
  }

  async function getOptionalUserId() {
    try {
      return await getUserId();
    } catch (error) {
      console.warn('[Send to 115] 未能获取 115 用户 ID，将不带 uid 继续提交', error);
      return '';
    }
  }

  async function getSignToken() {
    const response = await request({
      method: 'GET',
      url: API.sign(),
    });

    if (/<html[\s>]/i.test(response.responseText)) {
      throw new Error('115 未登录或登录态不可用');
    }

    const json = parseJson(response.responseText);
    if (!json.sign || !json.time) {
      throw new Error(json.error_msg || json.msg || '获取 115 sign/time 失败');
    }

    return {
      sign: json.sign,
      time: json.time,
      userId: findUserId(json),
    };
  }

  async function getUserId() {
    const readers = [
      readUserIdFromUserInfo,
      readUserIdFromDownpath,
    ];

    const errors = [];
    for (const reader of readers) {
      try {
        const userId = await reader();
        if (userId) return userId;
      } catch (error) {
        errors.push(error.message || String(error));
      }
    }

    throw new Error(`获取 115 用户 ID 失败${errors.length ? `：${errors.join('；')}` : ''}`);
  }

  async function readUserIdFromUserInfo() {
    const response = await request({
      method: 'GET',
      url: API.userInfo(),
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://115.com/',
      },
    });

    const json = parseLooseJson(response.responseText);
    const userId = findUserId(json);

    if (!userId && json.state === false) {
      throw new Error(json.error_msg || json.msg || '115 登录态不可用');
    }

    return userId;
  }

  async function readUserIdFromDownpath() {
    const response = await request({
      method: 'GET',
      url: API.downpath(),
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://115.com/',
      },
    });

    const json = parseJson(response.responseText);
    const userId = findUserId(json);

    if (!userId && json.state === false) {
      throw new Error(json.error_msg || json.msg || json.error || '获取云下载目录失败');
    }

    return userId;
  }

  function findUserId(value) {
    if (!value || typeof value !== 'object') return '';

    const keys = ['user_id', 'userid', 'uid'];
    for (const key of keys) {
      const candidate = value[key];
      if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
        return String(candidate).trim();
      }
    }

    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') {
        const candidate = findUserId(nested);
        if (candidate) return candidate;
      }
    }

    return '';
  }

  function request(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: CONFIG.requestTimeout,
        ...options,
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            resolve(response);
            return;
          }
          reject(new Error(`HTTP ${response.status}`));
        },
        ontimeout: () => reject(new Error('请求 115 超时')),
        onerror: (error) => reject(error),
      });
    });
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`115 返回内容不是 JSON：${String(text).slice(0, 120)}`);
    }
  }

  function parseLooseJson(text) {
    const trimmed = String(text || '').trim();
    if (trimmed.startsWith('{')) return parseJson(trimmed);

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return parseJson(trimmed.slice(start, end + 1));
    }

    return parseJson(trimmed);
  }

  function chunk(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  function notify(title, text) {
    showToast(title, text || '');
    console.log(`[Send to 115] ${title}`, text || '');
  }

  function showToast(title, text) {
    const oldToast = document.querySelector('.send-to-115-toast');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.className = 'send-to-115-toast';

    const titleNode = document.createElement('strong');
    titleNode.textContent = title;
    toast.appendChild(titleNode);

    if (text) {
      const textNode = document.createElement('span');
      textNode.textContent = text;
      toast.appendChild(textNode);
    }

    document.documentElement.appendChild(toast);
    window.setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 4000);
  }
})();

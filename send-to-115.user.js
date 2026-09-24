// ==UserScript==
// @name         Send to 115 Offline
// @namespace    https://github.com/lgithubl/send-to-115-userscript
// @version      0.1.0
// @description  Right-click selected cloud links and send them to 115 offline download.
// @author       lgithubl
// @license      MIT
// @match        *://*/*
// @run-at       document-end
// @noframes
// @connect      115.com
// @connect      webapi.115.com
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
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
    downpath: 'https://webapi.115.com/offine/downpath',
    addMany: 'https://115.com/web/lixian/?ct=lixian&ac=add_task_urls',
  };

  let lastContext = {
    urls: [],
    text: '',
  };

  GM_addStyle(`
    .send-to-115-menu {
      position: fixed;
      z-index: 2147483647;
      min-width: 148px;
      padding: 6px;
      border: 1px solid rgba(0, 0, 0, .14);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 10px 28px rgba(0, 0, 0, .18);
      color: #111827;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .send-to-115-menu button {
      display: block;
      width: 100%;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      padding: 7px 9px;
      text-align: left;
      white-space: nowrap;
    }
    .send-to-115-menu button:hover {
      background: #f3f4f6;
    }
    .send-to-115-menu small {
      display: block;
      padding: 3px 9px 6px;
      color: #6b7280;
    }
  `);

  GM_registerMenuCommand('发送最近右键内容到 115', () => {
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

    if (!urls.length) return;

    event.preventDefault();
    showMenu(event.clientX, event.clientY, urls);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!event.altKey || !event.shiftKey || event.key !== '1') return;
    event.preventDefault();
    sendUrls(collectCurrentUrls());
  });

  document.addEventListener('click', hideMenu, true);
  window.addEventListener('blur', hideMenu);
  window.addEventListener('scroll', hideMenu, true);

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

  function showMenu(x, y, urls) {
    hideMenu();

    const menu = document.createElement('div');
    menu.className = 'send-to-115-menu';
    menu.innerHTML = `
      <button type="button" data-action="send">发送到 115</button>
      <small>${urls.length} 条链接</small>
    `;

    menu.querySelector('[data-action="send"]').addEventListener('click', (event) => {
      event.stopPropagation();
      hideMenu();
      sendUrls(urls);
    });

    document.documentElement.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  }

  function hideMenu() {
    const oldMenu = document.querySelector('.send-to-115-menu');
    if (oldMenu) oldMenu.remove();
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
    const [token, userId] = await Promise.all([
      getSignToken(),
      getUserId(),
    ]);

    const params = new URLSearchParams();
    params.set('savepath', '');
    params.set('wp_path_id', GM_getValue(CONFIG.wpPathIdKey, ''));
    params.set('uid', userId);
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
    };
  }

  async function getUserId() {
    const response = await request({
      method: 'GET',
      url: API.downpath,
    });

    const json = parseJson(response.responseText);
    const data = Array.isArray(json.data) ? json.data : [];
    const item = data.find((entry) => entry && entry.user_id);

    if (!item || !item.user_id) {
      throw new Error(json.error_msg || json.msg || '获取 115 用户 ID 失败');
    }

    return String(item.user_id);
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

  function chunk(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  function notify(title, text) {
    if (typeof GM_notification === 'function') {
      GM_notification({
        title,
        text: text || '',
        timeout: 4000,
      });
      return;
    }
    console.log(`[Send to 115] ${title}`, text || '');
  }
})();

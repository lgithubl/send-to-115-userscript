// ==UserScript==
// @name         Send to 115 Offline
// @namespace    https://github.com/lgithubl/send-to-115-userscript
// @version      0.3.0
// @description  Send selected cloud links to 115 offline download without replacing the native context menu.
// @author       lgithubl
// @license      MIT
// @match        *://*/*
// @run-at       document-end
// @noframes
// @connect      115.com
// @connect      my.115.com
// @connect      webapi.115.com
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    settingsKey: 'send_to_115_settings',
    oldWpPathIdKey: 'send_to_115_wp_path_id',
    requestTimeout: 30000,
    maxBatchSize: 50,
  };

  const DEFAULT_SETTINGS = {
    wpPathId: '',
    createRandomFolder: true,
    randomFolderParentCid: '',
    randomFolderPrefix: 'aria2',
    pushToAria2: false,
    aria2RpcUrl: 'http://127.0.0.1:6800/jsonrpc',
    aria2RpcSecret: '',
    aria2DownloadDir: '',
    aria2ExtraOptionsJson: '{}',
    aria2SendReferer: true,
    aria2UserAgent: navigator.userAgent,
    pollIntervalMs: 30000,
    pollTimeoutMs: 7200000,
    stableRounds: 2,
    includeSubfolders: true,
  };

  const API = {
    sign: () => `https://115.com/?ct=offline&ac=space&_=${Date.now()}`,
    downpath: () => `https://webapi.115.com/offine/downpath?limit=1150&_=${Date.now()}`,
    userInfo: () => `https://my.115.com/?ct=ajax&ac=nav&_=${Date.now()}`,
    createFolder: 'https://webapi.115.com/files/add',
    files: (cid, offset = 0, limit = 1150) => {
      const params = new URLSearchParams({
        aid: '1',
        cid: String(cid || '0'),
        o: 'user_ptime',
        asc: '0',
        offset: String(offset),
        show_dir: '1',
        limit: String(limit),
        snap: '0',
        natsort: '1',
        fc_mix: '0',
        format: 'json',
        _: String(Date.now()),
      });
      return `https://webapi.115.com/files?${params}`;
    },
    download: (pickcode) => `https://webapi.115.com/files/download?pickcode=${encodeURIComponent(pickcode)}&_=${Date.now()}`,
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

  GM_registerMenuCommand('发送到 115（按配置）', () => {
    const urls = lastContext.urls.length ? lastContext.urls : collectCurrentUrls();
    sendUrls(urls);
  });

  GM_registerMenuCommand('仅提交到 115 离线', () => {
    const urls = lastContext.urls.length ? lastContext.urls : collectCurrentUrls();
    sendUrls(urls, { pushToAria2: false });
  });

  GM_registerMenuCommand('发送到 115，完成后推送 aria2', () => {
    const urls = lastContext.urls.length ? lastContext.urls : collectCurrentUrls();
    sendUrls(urls, { pushToAria2: true });
  });

  GM_registerMenuCommand('设置 115 保存目录 wp_path_id', () => {
    const settings = getSettings();
    const current = settings.wpPathId;
    const next = window.prompt('输入 115 目标目录 wp_path_id，留空则使用默认云下载目录：', current);
    if (next === null) return;
    saveSettings({ wpPathId: next.trim() });
    notify('115 保存目录已更新', next.trim() || '使用默认云下载目录');
  });

  GM_registerMenuCommand('设置 115 + aria2 配置', () => {
    editSettings();
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

  function getSettings() {
    const saved = GM_getValue(CONFIG.settingsKey, {});
    const parsed = typeof saved === 'string' ? safeJsonParse(saved, {}) : saved;
    const oldWpPathId = GM_getValue(CONFIG.oldWpPathIdKey, '');
    return normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...(oldWpPathId && !(parsed && parsed.wpPathId) ? { wpPathId: oldWpPathId } : {}),
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    });
  }

  function saveSettings(partial) {
    const settings = normalizeSettings({
      ...getSettings(),
      ...partial,
    });
    GM_setValue(CONFIG.settingsKey, settings);
    return settings;
  }

  function editSettings() {
    const current = getSettings();
    const editable = JSON.stringify(current, null, 2);
    const next = window.prompt('编辑配置 JSON：', editable);
    if (next === null) return;

    try {
      const parsed = JSON.parse(next);
      const settings = normalizeSettings({
        ...DEFAULT_SETTINGS,
        ...parsed,
      });
      GM_setValue(CONFIG.settingsKey, settings);
      notify('配置已保存', settings.pushToAria2 ? '已启用 aria2 推送' : '仅提交 115 离线');
    } catch (error) {
      notify('配置保存失败', error.message || String(error));
    }
  }

  function normalizeSettings(settings) {
    return {
      wpPathId: String(settings.wpPathId || '').trim(),
      createRandomFolder: Boolean(settings.createRandomFolder),
      randomFolderParentCid: String(settings.randomFolderParentCid || '').trim(),
      randomFolderPrefix: String(settings.randomFolderPrefix || 'aria2').trim() || 'aria2',
      pushToAria2: Boolean(settings.pushToAria2),
      aria2RpcUrl: String(settings.aria2RpcUrl || DEFAULT_SETTINGS.aria2RpcUrl).trim(),
      aria2RpcSecret: String(settings.aria2RpcSecret || '').trim(),
      aria2DownloadDir: String(settings.aria2DownloadDir || '').trim(),
      aria2ExtraOptionsJson: String(settings.aria2ExtraOptionsJson || '{}').trim() || '{}',
      aria2SendReferer: Boolean(settings.aria2SendReferer),
      aria2UserAgent: String(settings.aria2UserAgent || navigator.userAgent).trim(),
      pollIntervalMs: clampNumber(settings.pollIntervalMs, 5000, 600000, DEFAULT_SETTINGS.pollIntervalMs),
      pollTimeoutMs: clampNumber(settings.pollTimeoutMs, 60000, 86400000, DEFAULT_SETTINGS.pollTimeoutMs),
      stableRounds: clampNumber(settings.stableRounds, 1, 20, DEFAULT_SETTINGS.stableRounds),
      includeSubfolders: Boolean(settings.includeSubfolders),
    };
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  async function sendUrls(urls, overrides = {}) {
    const uniqueUrls = Array.from(new Set(urls || []));
    if (!uniqueUrls.length) {
      notify('未识别到可发送的链接');
      return;
    }

    try {
      const settings = {
        ...getSettings(),
        ...overrides,
      };
      const job = await prepareJob(settings);

      notify('正在发送到 115', `${uniqueUrls.length} 条链接${job.folderName ? ` -> ${job.folderName}` : ''}`);
      const chunks = chunk(uniqueUrls, CONFIG.maxBatchSize);
      const results = [];

      for (const urlsChunk of chunks) {
        results.push(await addTasks(urlsChunk, job.wpPathId));
      }

      const failed = results.filter((item) => !item.state);
      if (failed.length) {
        const message = failed.map((item) => item.error_msg || item.msg || '未知错误').join('; ');
        throw new Error(message);
      }

      if (!settings.pushToAria2) {
        notify('115 离线任务已添加', `${uniqueUrls.length} 条链接`);
        return;
      }

      const files = await waitForCompletedFiles(job, settings);
      const pushed = await pushFilesToAria2(files, settings);
      notify('已推送到 aria2', `${pushed.length} 个文件`);
    } catch (error) {
      notify('发送到 115 失败', error.message || String(error));
      console.error('[Send to 115]', error);
    }
  }

  async function prepareJob(settings) {
    if (!settings.createRandomFolder) {
      const targetCid = settings.wpPathId || settings.randomFolderParentCid || '0';
      return {
        wpPathId: targetCid,
        watchCid: targetCid,
        folderName: '',
        beforeFileIds: targetCid ? await snapshotFileIds(targetCid, settings) : new Set(),
      };
    }

    const parentCid = settings.randomFolderParentCid || settings.wpPathId || '0';
    const folderName = makeRandomFolderName(settings.randomFolderPrefix);
    const folderCid = await createFolder(parentCid, folderName);

    return {
      wpPathId: folderCid,
      watchCid: folderCid,
      folderName,
      beforeFileIds: new Set(),
    };
  }

  async function addTasks(urls, wpPathId) {
    const token = await getSignToken();
    const userId = token.userId || await getOptionalUserId();

    const params = new URLSearchParams();
    params.set('savepath', '');
    params.set('wp_path_id', wpPathId || '');
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

  async function createFolder(parentCid, folderName) {
    const params = new URLSearchParams();
    params.set('pid', parentCid || '0');
    params.set('cname', folderName);

    const response = await request({
      method: 'POST',
      url: API.createFolder,
      data: params.toString(),
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': 'https://115.com',
        'Referer': 'https://115.com/',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    const json = parseJson(response.responseText);
    const cid = findCreatedFolderCid(json);
    if (!json.state || !cid) {
      throw new Error(json.error_msg || json.msg || '创建 115 随机目录失败');
    }
    return cid;
  }

  async function waitForCompletedFiles(job, settings) {
    const startedAt = Date.now();
    let lastSignature = '';
    let stableCount = 0;

    while (Date.now() - startedAt < Number(settings.pollTimeoutMs)) {
      const files = await listDownloadableFiles(job.watchCid, settings);
      const newFiles = files.filter((file) => !job.beforeFileIds.has(file.id));
      const signature = newFiles
        .map((file) => `${file.id}:${file.size || ''}:${file.pickcode || ''}`)
        .sort()
        .join('|');

      if (newFiles.length && signature === lastSignature) {
        stableCount += 1;
      } else {
        stableCount = newFiles.length ? 1 : 0;
        lastSignature = signature;
      }

      notify('等待 115 离线完成', `${newFiles.length} 个文件，稳定 ${stableCount}/${settings.stableRounds}`);

      if (newFiles.length && stableCount >= Number(settings.stableRounds)) {
        return newFiles;
      }

      await sleep(Number(settings.pollIntervalMs));
    }

    throw new Error('等待 115 离线完成超时');
  }

  async function listDownloadableFiles(cid, settings, seenCids = new Set()) {
    const files = [];
    const entries = await listFiles(cid);

    for (const entry of entries) {
      const item = normalizeFileEntry(entry);
      if (!item.id) continue;

      if (item.isDir) {
        if (!settings.includeSubfolders || seenCids.has(item.id)) continue;
        seenCids.add(item.id);
        files.push(...await listDownloadableFiles(item.id, settings, seenCids));
        continue;
      }

      if (item.pickcode) files.push(item);
    }

    return files;
  }

  async function snapshotFileIds(cid, settings) {
    if (!cid) return new Set();
    const files = await listDownloadableFiles(cid, settings);
    return new Set(files.map((file) => file.id));
  }

  async function listFiles(cid) {
    const allEntries = [];
    const limit = 1150;
    let offset = 0;

    while (true) {
      const response = await request({
        method: 'GET',
        url: API.files(cid, offset, limit),
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Referer': 'https://115.com/',
        },
      });
      const json = parseJson(response.responseText);
      if (!json.state) {
        throw new Error(json.error_msg || json.msg || json.error || '获取 115 文件列表失败');
      }

      const entries = Array.isArray(json.data) ? json.data : [];
      allEntries.push(...entries);

      const count = Number(json.count || allEntries.length);
      if (entries.length < limit || allEntries.length >= count) break;
      offset += limit;
      await sleep(200);
    }

    return allEntries;
  }

  function normalizeFileEntry(entry) {
    const id = String(entry.fid || entry.file_id || entry.cid || entry.id || '').trim();
    const pickcode = String(entry.pc || entry.pick_code || entry.pickcode || '').trim();
    const name = String(entry.n || entry.name || entry.file_name || '').trim();
    const isDir = Boolean(entry.is_dir || entry.isdir || entry.cid && !entry.fid && !pickcode);
    const size = Number(entry.s || entry.size || entry.file_size || 0);

    return {
      id,
      pickcode,
      name,
      isDir,
      size,
    };
  }

  async function pushFilesToAria2(files, settings) {
    const pushed = [];
    for (const file of files) {
      const download = await getDownloadUrl(file);
      const options = buildAria2Options(file, settings);
      await aria2AddUri(download.url, options, settings);
      pushed.push(file);
    }
    return pushed;
  }

  async function getDownloadUrl(file) {
    const response = await request({
      method: 'GET',
      url: API.download(file.pickcode),
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://115.com/',
      },
    });
    const json = parseJson(response.responseText);
    const url = findDownloadUrl(json);
    if (!json.state || !url) {
      throw new Error(json.error_msg || json.msg || `获取下载链接失败：${file.name || file.pickcode}`);
    }

    return { url };
  }

  function findDownloadUrl(value) {
    if (!value || typeof value !== 'object') return '';

    const keys = ['file_url', 'file_url_302', 'url', 'download_url'];
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate;
    }

    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') {
        const candidate = findDownloadUrl(nested);
        if (candidate) return candidate;
      }
    }

    return '';
  }

  function findCreatedFolderCid(value) {
    if (!value || typeof value !== 'object') return '';

    const keys = ['cid', 'file_id', 'fid', 'id'];
    for (const key of keys) {
      const candidate = value[key];
      if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
        return String(candidate).trim();
      }
    }

    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') {
        const candidate = findCreatedFolderCid(nested);
        if (candidate) return candidate;
      }
    }

    return '';
  }

  function buildAria2Options(file, settings) {
    const options = parseAria2Options(settings.aria2ExtraOptionsJson);
    if (settings.aria2DownloadDir) options.dir = settings.aria2DownloadDir;
    if (file.name && !options.out) options.out = file.name;

    const headers = Array.isArray(options.header) ? options.header.slice() : [];
    if (settings.aria2SendReferer && !headers.some((header) => /^referer:/i.test(header))) {
      headers.push('Referer: https://115.com/');
    }
    if (settings.aria2UserAgent && !headers.some((header) => /^user-agent:/i.test(header))) {
      headers.push(`User-Agent: ${settings.aria2UserAgent}`);
    }
    if (headers.length) options.header = headers;

    return options;
  }

  function parseAria2Options(value) {
    try {
      const parsed = JSON.parse(value || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (error) {
      throw new Error(`aria2ExtraOptionsJson 不是合法 JSON：${error.message}`);
    }
    throw new Error('aria2ExtraOptionsJson 必须是 JSON object');
  }

  async function aria2AddUri(url, options, settings) {
    const params = [];
    if (settings.aria2RpcSecret) params.push(`token:${settings.aria2RpcSecret}`);
    params.push([url], options);

    const response = await request({
      method: 'POST',
      url: settings.aria2RpcUrl,
      data: JSON.stringify({
        jsonrpc: '2.0',
        id: `send-to-115-${Date.now()}`,
        method: 'aria2.addUri',
        params,
      }),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    const json = parseJson(response.responseText);
    if (json.error) {
      throw new Error(json.error.message || 'aria2 RPC 返回错误');
    }
    return json.result;
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

  function makeRandomFolderName(prefix) {
    const now = new Date();
    const datePart = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('');
    const timePart = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const randomPart = Math.random().toString(16).slice(2, 8);
    return `${prefix}-${datePart}-${timePart}-${randomPart}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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

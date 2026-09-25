// ==UserScript==
// @name         Send to 115 Offline
// @namespace    https://github.com/lgithubl/send-to-115-userscript
// @version      0.8.4
// @description  Send selected cloud links to 115 offline download without replacing the native context menu.
// @author       lgithubl
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/lgithubl/send-to-115-userscript/main/send-to-115.user.js
// @downloadURL  https://raw.githubusercontent.com/lgithubl/send-to-115-userscript/main/send-to-115.user.js
// @match        *://*/*
// @run-at       document-end
// @noframes
// @connect      115.com
// @connect      my.115.com
// @connect      proapi.115.com
// @connect      webapi.115.com
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_cookie
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '0.8.4';

  const CONFIG = {
    settingsKey: 'send_to_115_settings',
    oldWpPathIdKey: 'send_to_115_wp_path_id',
    historyKey: 'send_to_115_history',
    panelCollapsedKey: 'send_to_115_panel_collapsed',
    requestTimeout: 30000,
    maxBatchSize: 50,
    maxHistoryItems: 20,
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
    waitOfflineTaskStatus: true,
    allowZeroSizeFiles: false,
    useBrowserCookieHeader: true,
    preferNativeFetchDownurl: true,
    useExtensionBridge: true,
    downurlCookieHeader: '',
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
    categoryGet: (cid) => `https://webapi.115.com/category/get?aid=1&cid=${encodeURIComponent(cid)}`,
    download: (pickcode) => `https://webapi.115.com/files/download?pickcode=${encodeURIComponent(pickcode)}&_=${Date.now()}`,
    chromeDownurl: (time) => `https://proapi.115.com/app/chrome/downurl?t=${time}`,
    addMany: 'https://115.com/web/lixian/?ct=lixian&ac=add_task_urls',
    taskList: 'https://115.com/web/lixian/?ct=lixian&ac=task_lists',
  };

  let lastContext = {
    urls: [],
    text: '',
  };

  let panelCollapsed = Boolean(GM_getValue(CONFIG.panelCollapsedKey, true));

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
    .send-to-115-context-menu {
      position: fixed;
      z-index: 2147483647;
      min-width: 168px;
      padding: 6px;
      border: 1px solid rgba(17, 24, 39, .16);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 14px 34px rgba(15, 23, 42, .22);
      color: #111827;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .send-to-115-context-menu button {
      display: block;
      width: 100%;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      padding: 7px 9px;
      text-align: left;
      font: inherit;
    }
    .send-to-115-context-menu button:hover {
      background: #f3f4f6;
    }
    .send-to-115-context-menu small {
      display: block;
      padding: 4px 9px 6px;
      color: #6b7280;
    }
    .send-to-115-panel {
      position: fixed;
      right: 16px;
      bottom: 76px;
      z-index: 2147483646;
      width: min(380px, calc(100vw - 32px));
      max-height: min(720px, calc(100vh - 104px));
      border: 1px solid rgba(17, 24, 39, .16);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 18px 48px rgba(15, 23, 42, .22);
      color: #111827;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
    }
    .send-to-115-panel button,
    .send-to-115-panel textarea {
      font: inherit;
    }
    .send-to-115-panel button {
      border: 1px solid rgba(17, 24, 39, .16);
      border-radius: 5px;
      background: #fff;
      color: #111827;
      cursor: pointer;
      padding: 3px 6px;
      font-size: 11px;
      line-height: 1.25;
    }
    .send-to-115-panel button:hover {
      background: #f3f4f6;
    }
    .send-to-115-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid #e5e7eb;
      background: #f9fafb;
    }
    .send-to-115-panel-title {
      font-weight: 700;
      font-size: 14px;
    }
    .send-to-115-panel-body {
      display: grid;
      gap: 10px;
      max-height: calc(min(720px, calc(100vh - 104px)) - 45px);
      overflow: auto;
      padding: 10px;
    }
    .send-to-115-actions,
    .send-to-115-panel-row {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      align-items: center;
    }
    .send-to-115-actions button,
    .send-to-115-panel-row button {
      text-align: left;
      white-space: nowrap;
    }
    .send-to-115-section-title {
      margin: 0 0 8px;
      font-weight: 700;
      color: #374151;
    }
    .send-to-115-settings-textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 220px;
      resize: vertical;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      color: #111827;
      background: #fff;
      padding: 10px;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      tab-size: 2;
    }
    .send-to-115-history {
      display: grid;
      gap: 8px;
    }
    .send-to-115-history-item {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 7px;
      background: #fff;
    }
    .send-to-115-history-meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: #6b7280;
      font-size: 12px;
      margin-bottom: 6px;
    }
    .send-to-115-history-meta span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .send-to-115-status {
      display: block;
      width: fit-content;
      max-width: 100%;
      box-sizing: border-box;
      margin: 0 0 6px;
      padding: 3px 7px;
      border-radius: 999px;
      background: #e0f2fe;
      color: #075985;
      font-weight: 700;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .send-to-115-status-failed {
      background: #fee2e2;
      color: #991b1b;
    }
    .send-to-115-status-pushed {
      background: #dcfce7;
      color: #166534;
    }
    .send-to-115-history-url {
      color: #111827;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 8px;
    }
    .send-to-115-history-detail {
      color: #6b7280;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin: -3px 0 8px;
      font-size: 12px;
    }
    .send-to-115-panel-collapsed {
      width: auto;
      max-height: none;
      border-radius: 999px;
      overflow: visible;
    }
    .send-to-115-panel-collapsed button {
      border-radius: 999px;
      padding: 9px 14px;
      font-weight: 700;
      box-shadow: 0 12px 32px rgba(15, 23, 42, .18);
    }
  `);

  console.info(`[Send to 115] version ${SCRIPT_VERSION}`);

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
    panelCollapsed = false;
    GM_setValue(CONFIG.panelCollapsedKey, panelCollapsed);
    renderPanel();
    focusSettingsEditor();
  });

  initPanel();

  document.addEventListener('contextmenu', (event) => {
    const urls = collectEventUrls(event);
    lastContext = {
      urls,
      text: getSelectionText() || getLinkHref(event.target) || '',
    };

    if (event.shiftKey || !urls.length) return;
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, urls);
  }, true);

  document.addEventListener('click', hideContextMenu);
  window.addEventListener('blur', hideContextMenu);
  window.addEventListener('scroll', hideContextMenu, true);

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

  function showContextMenu(x, y, urls) {
    hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'send-to-115-context-menu';
    appendContextMenuButton(menu, '发送并推 aria2', () => sendUrls(urls, { pushToAria2: true }));
    appendContextMenuButton(menu, '按配置发送到 115', () => sendUrls(urls));
    appendContextMenuButton(menu, '仅提交 115', () => sendUrls(urls, { pushToAria2: false }));

    const hint = document.createElement('small');
    hint.textContent = `${urls.length} 条链接 · Shift+右键原菜单`;
    menu.appendChild(hint);

    document.documentElement.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  }

  function appendContextMenuButton(parent, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      hideContextMenu();
      onClick();
    });
    parent.appendChild(button);
  }

  function hideContextMenu() {
    const menu = document.querySelector('.send-to-115-context-menu');
    if (menu) menu.remove();
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
    panelCollapsed = false;
    GM_setValue(CONFIG.panelCollapsedKey, panelCollapsed);
    renderPanel();
    focusSettingsEditor();
  }

  function normalizeSettings(settings) {
    const aria2 = normalizeAria2Endpoint(
      String(settings.aria2RpcUrl || DEFAULT_SETTINGS.aria2RpcUrl).trim(),
      String(settings.aria2RpcSecret || '').trim(),
    );

    return {
      wpPathId: String(settings.wpPathId || '').trim(),
      createRandomFolder: Boolean(settings.createRandomFolder),
      randomFolderParentCid: String(settings.randomFolderParentCid || '').trim(),
      randomFolderPrefix: String(settings.randomFolderPrefix || 'aria2').trim() || 'aria2',
      pushToAria2: Boolean(settings.pushToAria2),
      aria2RpcUrl: aria2.url,
      aria2RpcSecret: aria2.secret,
      aria2DownloadDir: String(settings.aria2DownloadDir || '').trim(),
      aria2ExtraOptionsJson: String(settings.aria2ExtraOptionsJson || '{}').trim() || '{}',
      aria2SendReferer: Boolean(settings.aria2SendReferer),
      aria2UserAgent: String(settings.aria2UserAgent || navigator.userAgent).trim(),
      pollIntervalMs: clampNumber(settings.pollIntervalMs, 5000, 600000, DEFAULT_SETTINGS.pollIntervalMs),
      pollTimeoutMs: clampNumber(settings.pollTimeoutMs, 60000, 86400000, DEFAULT_SETTINGS.pollTimeoutMs),
      stableRounds: clampNumber(settings.stableRounds, 1, 20, DEFAULT_SETTINGS.stableRounds),
      includeSubfolders: Boolean(settings.includeSubfolders),
      waitOfflineTaskStatus: settings.waitOfflineTaskStatus !== false,
      allowZeroSizeFiles: Boolean(settings.allowZeroSizeFiles),
      useBrowserCookieHeader: settings.useBrowserCookieHeader !== false,
      preferNativeFetchDownurl: settings.preferNativeFetchDownurl !== false,
      useExtensionBridge: settings.useExtensionBridge !== false,
      downurlCookieHeader: String(settings.downurlCookieHeader || '').trim(),
    };
  }

  function normalizeAria2Endpoint(url, secret) {
    if (!url) return { url: DEFAULT_SETTINGS.aria2RpcUrl, secret };

    try {
      const parsed = new URL(url);
      const username = decodeURIComponent(parsed.username || '');
      const password = decodeURIComponent(parsed.password || '');
      if (username === 'token' && password) {
        parsed.username = '';
        parsed.password = '';
        return {
          url: parsed.toString(),
          secret: secret || password,
        };
      }
    } catch (error) {
      return { url, secret };
    }

    return { url, secret };
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

  function initPanel() {
    renderPanel();
  }

  function renderPanel() {
    let panel = document.querySelector('.send-to-115-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'send-to-115-panel';
      document.documentElement.appendChild(panel);
    }

    panel.className = `send-to-115-panel${panelCollapsed ? ' send-to-115-panel-collapsed' : ''}`;
    panel.innerHTML = '';

    if (panelCollapsed) {
      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.textContent = '115';
      openButton.title = '打开 Send to 115 面板';
      openButton.addEventListener('click', () => {
        panelCollapsed = false;
        GM_setValue(CONFIG.panelCollapsedKey, panelCollapsed);
        renderPanel();
      });
      panel.appendChild(openButton);
      return;
    }

    const header = document.createElement('div');
    header.className = 'send-to-115-panel-header';

    const title = document.createElement('div');
    title.className = 'send-to-115-panel-title';
    title.textContent = `Send to 115 ${SCRIPT_VERSION}`;
    header.appendChild(title);

    const collapseButton = document.createElement('button');
    collapseButton.type = 'button';
    collapseButton.textContent = '收起';
    collapseButton.addEventListener('click', () => {
      panelCollapsed = true;
      GM_setValue(CONFIG.panelCollapsedKey, panelCollapsed);
      renderPanel();
    });
    header.appendChild(collapseButton);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'send-to-115-panel-body';

    const actions = document.createElement('div');
    actions.className = 'send-to-115-actions';
    appendButton(actions, '发送并推 aria2', () => sendUrls(getPanelUrls(), { pushToAria2: true }));
    appendButton(actions, '推 aria2', () => pushLatestHistoryToAria2());
    appendButton(actions, '按配置发送', () => sendUrls(getPanelUrls()));
    appendButton(actions, '仅提交 115', () => sendUrls(getPanelUrls(), { pushToAria2: false }));
    body.appendChild(actions);

    const configSection = document.createElement('section');
    const configTitle = document.createElement('p');
    configTitle.className = 'send-to-115-section-title';
    configTitle.textContent = '配置';
    configSection.appendChild(configTitle);

    const textarea = document.createElement('textarea');
    textarea.className = 'send-to-115-settings-textarea';
    textarea.spellcheck = false;
    textarea.value = JSON.stringify(getSettings(), null, 2);
    configSection.appendChild(textarea);

    const configActions = document.createElement('div');
    configActions.className = 'send-to-115-panel-row';
    appendButton(configActions, '保存配置', () => saveSettingsFromPanel(textarea));
    appendButton(configActions, '填入 aria2 示例', () => {
      textarea.value = JSON.stringify(getExampleSettings(), null, 2);
      textarea.focus();
    });
    appendButton(configActions, '重新载入', () => {
      textarea.value = JSON.stringify(getSettings(), null, 2);
      textarea.focus();
    });
    configSection.appendChild(configActions);
    body.appendChild(configSection);

    const historySection = document.createElement('section');
    const historyTitle = document.createElement('p');
    historyTitle.className = 'send-to-115-section-title';
    historyTitle.textContent = '最近发送';
    historySection.appendChild(historyTitle);

    const history = document.createElement('div');
    history.className = 'send-to-115-history';
    renderHistoryList(history);
    historySection.appendChild(history);

    const historyActions = document.createElement('div');
    historyActions.className = 'send-to-115-panel-row';
    appendButton(historyActions, '刷新全部状态', () => refreshAllHistoryStatuses());
    appendButton(historyActions, '清空列表', () => {
      GM_setValue(CONFIG.historyKey, []);
      renderPanel();
    });
    historySection.appendChild(historyActions);
    body.appendChild(historySection);

    panel.appendChild(body);
  }

  function appendButton(parent, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    parent.appendChild(button);
    return button;
  }

  function getPanelUrls() {
    return lastContext.urls.length ? lastContext.urls : collectCurrentUrls();
  }

  function saveSettingsFromPanel(textarea) {
    try {
      const parsed = JSON.parse(textarea.value);
      const settings = normalizeSettings({
        ...DEFAULT_SETTINGS,
        ...parsed,
      });
      GM_setValue(CONFIG.settingsKey, settings);
      textarea.value = JSON.stringify(settings, null, 2);
      notify('配置已保存', settings.pushToAria2 ? '已启用 aria2 推送' : '仅提交 115 离线');
    } catch (error) {
      notify('配置保存失败', error.message || String(error));
    }
  }

  function getExampleSettings() {
    return normalizeSettings({
      ...getSettings(),
      createRandomFolder: true,
      pushToAria2: true,
      aria2RpcUrl: 'http://token:admin_aria2@my2.mynas.local.com:11582/jsonrpc',
      aria2DownloadDir: '',
      pollIntervalMs: 30000,
      pollTimeoutMs: 7200000,
      stableRounds: 2,
      waitOfflineTaskStatus: true,
      allowZeroSizeFiles: false,
      useBrowserCookieHeader: true,
      preferNativeFetchDownurl: true,
      useExtensionBridge: true,
      downurlCookieHeader: '',
    });
  }

  function focusSettingsEditor() {
    window.setTimeout(() => {
      const textarea = document.querySelector('.send-to-115-settings-textarea');
      if (textarea) textarea.focus();
    }, 0);
  }

  function renderHistoryList(container) {
    const history = getHistory();
    if (!history.length) {
      const empty = document.createElement('div');
      empty.className = 'send-to-115-history-item';
      empty.textContent = '暂无记录';
      container.appendChild(empty);
      return;
    }

    for (const item of history) {
      const row = document.createElement('div');
      row.className = 'send-to-115-history-item';

      const meta = document.createElement('div');
      meta.className = 'send-to-115-history-meta';

      const left = document.createElement('span');
      left.textContent = `${formatTime(item.createdAt)} · ${item.urls.length} 条`;
      left.title = left.textContent;
      meta.appendChild(left);

      const right = document.createElement('span');
      right.textContent = item.folderName || item.wpPathId || '';
      right.title = right.textContent;
      meta.appendChild(right);
      row.appendChild(meta);

      const status = document.createElement('div');
      status.className = `send-to-115-status ${getStatusClass(item.status)}`;
      status.textContent = item.status || 'unknown';
      status.title = [
        item.status || 'unknown',
        item.pushedCount ? `pushed ${item.pushedCount}` : '',
        item.detail || '',
        item.error || '',
      ].filter(Boolean).join('\n');
      row.appendChild(status);

      const url = document.createElement('div');
      url.className = 'send-to-115-history-url';
      url.textContent = item.urls[0] || '';
      url.title = (item.urls || []).join('\n');
      row.appendChild(url);

      const logText = Array.isArray(item.log) ? item.log.join('\n') : '';
      const detailText = item.error || item.detail || (Array.isArray(item.log) ? item.log[0] : '');
      if (detailText || logText) {
        const detail = document.createElement('div');
        detail.className = 'send-to-115-history-detail';
        detail.textContent = detailText;
        detail.title = [item.error || item.detail || '', logText].filter(Boolean).join('\n\n');
        row.appendChild(detail);
      }

      const controls = document.createElement('div');
      controls.className = 'send-to-115-panel-row';
      appendButton(controls, '刷新状态', () => refreshHistoryStatus(item.id));
      appendButton(controls, '推 aria2', () => pushHistoryToAria2(item.id));
      appendButton(controls, '重发', () => sendUrls(item.urls, item.overrides || {}));
      appendButton(controls, '重发并推 aria2', () => sendUrls(item.urls, { ...(item.overrides || {}), pushToAria2: true }));
      appendButton(controls, '仅提交 115', () => sendUrls(item.urls, { ...(item.overrides || {}), pushToAria2: false }));
      row.appendChild(controls);

      container.appendChild(row);
    }
  }

  function getStatusClass(status) {
    if (status === 'failed' || /failed|失败|error|push failed/i.test(status || '')) return 'send-to-115-status-failed';
    if (status === 'pushed') return 'send-to-115-status-pushed';
    return '';
  }

  function getHistory() {
    const saved = GM_getValue(CONFIG.historyKey, []);
    return Array.isArray(saved) ? saved : safeJsonParse(saved, []);
  }

  function createHistoryItem(urls, settings, overrides) {
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      urls,
      status: 'running',
      folderName: '',
      wpPathId: '',
      pushedCount: 0,
      error: '',
      detail: '',
      log: [],
      job: null,
      matcher: null,
      overrides: {
        pushToAria2: Boolean(settings.pushToAria2),
        ...(overrides || {}),
      },
    };
    upsertHistoryItem(item);
    return item.id;
  }

  function upsertHistoryItem(itemOrPatch) {
    const history = getHistory();
    const index = history.findIndex((item) => item.id === itemOrPatch.id);
    const nextItem = {
      ...(index === -1 ? {} : history[index]),
      ...itemOrPatch,
      updatedAt: Date.now(),
    };

    if (index === -1) {
      history.unshift(nextItem);
    } else {
      history.splice(index, 1);
      history.unshift(nextItem);
    }

    GM_setValue(CONFIG.historyKey, history.slice(0, CONFIG.maxHistoryItems));
    if (!panelCollapsed) renderPanel();
  }

  function appendHistoryLog(id, message, data) {
    const history = getHistory();
    const item = history.find((entry) => entry.id === id);
    if (!item) return;

    const line = `[${formatTime(Date.now())}] ${message}${data ? ` ${safeStringify(data, 360)}` : ''}`;
    item.log = [line, ...(Array.isArray(item.log) ? item.log : [])].slice(0, 30);
    item.updatedAt = Date.now();
    GM_setValue(CONFIG.historyKey, history);
    console.info('[Send to 115]', message, data || '');
    if (!panelCollapsed) renderPanel();
  }

  function logJson(label, value, maxLength = 12000) {
    console.info(`[Send to 115 JSON] ${label} ${safeStringify(value, maxLength)}`);
  }

  function safeStringify(value, maxLength) {
    let text = '';
    try {
      text = JSON.stringify(value);
    } catch (error) {
      text = String(value);
    }
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  function serializeJob(job) {
    return {
      wpPathId: job.wpPathId || '',
      watchCid: job.watchCid || '',
      folderName: job.folderName || '',
      isRandomFolder: Boolean(job.isRandomFolder),
      beforeFileIds: Array.from(job.beforeFileIds || []),
    };
  }

  function reviveJob(item) {
    if (!item) return null;
    if (!item.job && (item.wpPathId || item.folderName)) {
      return {
        wpPathId: item.wpPathId || '',
        watchCid: item.wpPathId || '',
        folderName: item.folderName || '',
        isRandomFolder: Boolean(item.folderName),
        beforeFileIds: new Set(),
      };
    }
    if (!item.job) return null;
    return {
      ...item.job,
      beforeFileIds: new Set(item.job.beforeFileIds || []),
    };
  }

  function serializeMatcher(matcher) {
    return {
      ids: Array.from(matcher.ids || []),
      hashes: Array.from(matcher.hashes || []),
      urls: Array.from(matcher.urls || []),
      cids: Array.from(matcher.cids || []),
    };
  }

  function reviveMatcher(item) {
    if (!item) return null;
    if (!item.matcher) {
      return {
        ids: new Set(),
        hashes: new Set(),
        urls: new Set((item.urls || []).map(normalizeComparableUrl)),
        cids: new Set([item.wpPathId || ''].filter(Boolean)),
      };
    }
    return {
      ids: new Set(item.matcher.ids || []),
      hashes: new Set(item.matcher.hashes || []),
      urls: new Set(item.matcher.urls || []),
      cids: new Set(item.matcher.cids || []),
    };
  }

  function summarizeAddTaskResponse(response) {
    return {
      state: response && response.state,
      msg: response && (response.error_msg || response.msg || response.err_msg || ''),
      ids: collectValuesByKey(response, /^(task_id|tid|id)$/i).slice(0, 5),
      hashes: collectValuesByKey(response, /hash/i).slice(0, 5),
    };
  }

  function collectValuesByKey(value, pattern) {
    const values = [];
    visitObjects(value, (item) => {
      for (const [key, raw] of Object.entries(item)) {
        if (!pattern.test(key)) continue;
        if (raw === undefined || raw === null || typeof raw === 'object') continue;
        const text = String(raw).trim();
        if (text) values.push(text);
      }
    });
    return Array.from(new Set(values));
  }

  async function refreshHistoryStatus(id) {
    const item = getHistory().find((entry) => entry.id === id);
    if (!item) {
      notify('刷新失败', '找不到历史记录');
      return;
    }

    const job = reviveJob(item);
    const matcher = reviveMatcher(item);
    if (!job || !matcher) {
      upsertHistoryItem({
        id,
        status: 'no tracking data',
        error: '这条记录没有保存 job/matcher，无法刷新；重发一次后可跟踪。',
      });
      return;
    }

    try {
      upsertHistoryItem({ id, status: 'refreshing', error: '', detail: '' });
      appendHistoryLog(id, 'manual refresh started');

      const tasks = await listOfflineTasks();
      const matched = tasks.filter((task) => matchOfflineTask(task, matcher, job));
      const done = matched.filter(isOfflineTaskDone);
      const failed = matched.filter(isOfflineTaskFailed);
      const settings = getSettings();
      const files = await listDownloadableFiles(job.watchCid || job.wpPathId || '0', settings);
      const newFiles = files.filter((file) => !job.beforeFileIds.has(file.id));
      const pendingFiles = newFiles.filter((file) => isPendingFile(file, settings));
      logJson('manual refresh files', {
        job: serializeJob(job),
        files: newFiles.map((file) => summarizeDownloadFile(file)),
        pendingFiles: pendingFiles.map((file) => summarizeDownloadFile(file)),
      });
      const filesText = `files ${newFiles.length}${pendingFiles.length ? `, pending ${pendingFiles.length}` : ''}`;
      const status = matched.length
        ? `offline ${done.length}/${matched.length}${failed.length ? ` failed ${failed.length}` : ''} · ${filesText}`
        : `no task match · ${filesText}`;

      upsertHistoryItem({
        id,
        status,
        detail: describeOfflineTasks(matched),
      });
      appendHistoryLog(id, 'manual refresh result', {
        tasks: tasks.length,
        matched: matched.length,
        done: done.length,
        failed: failed.length,
        files: newFiles.length,
        pendingFiles: pendingFiles.length,
      });
      notify('状态已刷新', status);
    } catch (error) {
      upsertHistoryItem({
        id,
        status: 'refresh failed',
        error: error.message || String(error),
      });
      appendHistoryLog(id, 'manual refresh failed', error.message || String(error));
      notify('刷新状态失败', error.message || String(error));
    }
  }

  async function refreshAllHistoryStatuses() {
    const history = getHistory().filter((item) => reviveJob(item) && reviveMatcher(item));
    if (!history.length) {
      notify('没有可刷新的记录', '重发一次后会保存跟踪信息');
      return;
    }

    for (const item of history) {
      await refreshHistoryStatus(item.id);
      await sleep(300);
    }
  }

  async function pushLatestHistoryToAria2() {
    const item = getHistory().find((entry) => reviveJob(entry));
    if (!item) {
      notify('没有可推送记录', '先发送或刷新一条记录');
      return;
    }
    await pushHistoryToAria2(item.id);
  }

  async function pushHistoryToAria2(id) {
    const item = getHistory().find((entry) => entry.id === id);
    if (!item) {
      notify('推送失败', '找不到历史记录');
      return;
    }

    const job = reviveJob(item);
    if (!job) {
      upsertHistoryItem({
        id,
        status: 'no tracking data',
        error: '这条记录没有保存目录信息，无法直接推 aria2；重发一次后可推送。',
      });
      return;
    }

    try {
      const settings = getSettings();
      upsertHistoryItem({ id, status: 'pushing aria2', error: '' });
      appendHistoryLog(id, 'manual aria2 push started');

      const newFiles = await waitForCompletedFiles(
        { ...job, watchCid: job.watchCid || job.wpPathId || '0' },
        settings,
        id,
      );
      if (!newFiles.length) {
        throw new Error('目标目录没有发现可推送的新增文件');
      }

      appendHistoryLog(id, 'manual aria2 files', newFiles.map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size,
        ready: !isPendingFile(file, settings),
      })));
      const pushed = await pushFilesToAria2(newFiles, settings, id);
      upsertHistoryItem({
        id,
        status: 'pushed',
        pushedCount: pushed.length,
        error: '',
        detail: `manual push ${pushed.length} files`,
      });
      appendHistoryLog(id, 'manual aria2 push done', { pushed: pushed.length });
      notify('已推送到 aria2', `${pushed.length} 个文件`);
    } catch (error) {
      upsertHistoryItem({
        id,
        status: 'push failed',
        error: error.message || String(error),
      });
      appendHistoryLog(id, 'manual aria2 push failed', error.message || String(error));
      notify('推送 aria2 失败', error.message || String(error));
    }
  }

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return [
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
      `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    ].join(' ');
  }

  async function sendUrls(urls, overrides = {}) {
    const uniqueUrls = Array.from(new Set(urls || []));
    if (!uniqueUrls.length) {
      notify('未识别到可发送的链接');
      return;
    }

    const settings = {
      ...getSettings(),
      ...overrides,
    };
    const historyId = createHistoryItem(uniqueUrls, settings, overrides);
    appendHistoryLog(historyId, 'created', {
      urls: uniqueUrls.length,
      pushToAria2: settings.pushToAria2,
      waitOfflineTaskStatus: settings.waitOfflineTaskStatus,
    });

    try {
      const job = await prepareJob(settings);
      upsertHistoryItem({
        id: historyId,
        status: 'prepared',
        folderName: job.folderName,
        wpPathId: job.wpPathId,
        job: serializeJob(job),
      });
      appendHistoryLog(historyId, 'prepared job', serializeJob(job));

      notify('正在发送到 115', `${uniqueUrls.length} 条链接${job.folderName ? ` -> ${job.folderName}` : ''}`);
      const chunks = chunk(uniqueUrls, CONFIG.maxBatchSize);
      const results = [];

      for (const urlsChunk of chunks) {
        results.push({
          urls: urlsChunk,
          response: await addTasks(urlsChunk, job.wpPathId),
        });
        appendHistoryLog(historyId, 'add_task_urls response', summarizeAddTaskResponse(results[results.length - 1].response));
      }

      const failed = results.map((item) => item.response).filter((item) => !item.state);
      if (failed.length) {
        const message = failed.map((item) => item.error_msg || item.msg || '未知错误').join('; ');
        throw new Error(message);
      }

      const matcher = buildOfflineTaskMatcher(results, uniqueUrls, job);
      upsertHistoryItem({
        id: historyId,
        matcher: serializeMatcher(matcher),
      });
      appendHistoryLog(historyId, 'matcher built', serializeMatcher(matcher));

      if (!settings.pushToAria2) {
        upsertHistoryItem({
          id: historyId,
          status: '115 added (not watching)',
        });
        notify('115 离线任务已添加', `${uniqueUrls.length} 条链接`);
        return;
      }

      upsertHistoryItem({
        id: historyId,
        status: 'waiting',
      });
      const waitResult = await waitForOfflineOrDirectory(job, settings, matcher, historyId);
      appendHistoryLog(historyId, 'wait finished', waitResult.usedOfflineStatus ? 'offline status' : 'directory stable');
      upsertHistoryItem({
        id: historyId,
        status: waitResult.usedOfflineStatus ? 'offline done' : 'directory stable',
      });
      const files = await getFilesReadyForPush(job, settings, historyId, waitResult);
      appendHistoryLog(historyId, 'files ready', files.map((file) => ({ id: file.id, name: file.name, size: file.size })));
      const pushed = await pushFilesToAria2(files, settings, historyId);
      upsertHistoryItem({
        id: historyId,
        status: 'pushed',
        pushedCount: pushed.length,
      });
      notify('已推送到 aria2', `${pushed.length} 个文件`);
    } catch (error) {
      upsertHistoryItem({
        id: historyId,
        status: 'failed',
        error: error.message || String(error),
      });
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
        isRandomFolder: false,
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
      isRandomFolder: true,
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

  async function waitForOfflineOrDirectory(job, settings, matcher, historyId) {
    if (!settings.waitOfflineTaskStatus) {
      upsertHistoryItem({ id: historyId, status: 'directory watch' });
      const files = await waitForCompletedFiles(job, settings, historyId);
      return { usedOfflineStatus: false, files };
    }

    try {
      await waitForOfflineTasks(job, settings, matcher, historyId);
      return { usedOfflineStatus: true };
    } catch (error) {
      console.warn('[Send to 115] 离线任务状态匹配失败，回退目录轮询', error);
      upsertHistoryItem({
        id: historyId,
        status: 'fallback directory watch',
        error: `任务状态不可用，回退目录轮询：${error.message || String(error)}`,
      });
      const files = await waitForCompletedFiles(job, settings, historyId);
      return { usedOfflineStatus: false, files };
    }
  }

  async function waitForOfflineTasks(job, settings, matcher, historyId) {
    const startedAt = Date.now();
    let noMatchRounds = 0;

    while (Date.now() - startedAt < Number(settings.pollTimeoutMs)) {
      const tasks = await listOfflineTasks();
      const matched = tasks.filter((task) => matchOfflineTask(task, matcher, job));
      const done = matched.filter(isOfflineTaskDone);
      const failed = matched.filter(isOfflineTaskFailed);
      const statusText = matched.length
        ? `offline ${done.length}/${matched.length}${failed.length ? ` failed ${failed.length}` : ''}`
        : 'offline matching';

      upsertHistoryItem({
        id: historyId,
        status: statusText,
        detail: describeOfflineTasks(matched),
      });
      appendHistoryLog(historyId, 'offline poll', {
        tasks: tasks.length,
        matched: matched.length,
        done: done.length,
        failed: failed.length,
        noMatchRounds,
      });
      notify('等待 115 离线任务完成', statusText);

      if (failed.length) {
        throw new Error(`115 离线任务失败：${describeOfflineTasks(failed) || '未知错误'}`);
      }

      if (matched.length && done.length === matched.length) {
        return matched;
      }

      if (!matched.length) {
        noMatchRounds += 1;
        if (noMatchRounds >= 3) {
          throw new Error('连续 3 次未匹配到本次离线任务');
        }
      } else {
        noMatchRounds = 0;
      }

      await sleep(Number(settings.pollIntervalMs));
    }

    throw new Error('等待 115 离线任务状态完成超时');
  }

  async function listOfflineTasks() {
    try {
      return await listOfflineTasksByMethod('POST');
    } catch (error) {
      console.warn('[Send to 115] POST 获取离线任务列表失败，尝试 GET', error);
      return listOfflineTasksByMethod('GET');
    }
  }

  async function listOfflineTasksByMethod(method) {
    const token = await getSignToken();
    const userId = token.userId || await getOptionalUserId();
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('uid', userId || '');
    params.set('sign', token.sign);
    params.set('time', token.time);

    const response = await request({
      method,
      url: method === 'GET' ? `${API.taskList}&${params}` : API.taskList,
      data: method === 'GET' ? undefined : params.toString(),
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }),
        'Origin': 'https://115.com',
        'Referer': 'https://115.com/',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    const json = parseJson(response.responseText);
    if (json.state === false) {
      throw new Error(json.error_msg || json.msg || '获取 115 离线任务列表失败');
    }
    return extractOfflineTasks(json);
  }

  function extractOfflineTasks(value) {
    const tasks = [];
    visitObjects(value, (item) => {
      if (looksLikeOfflineTask(item)) tasks.push(item);
    });
    return dedupeObjects(tasks);
  }

  function looksLikeOfflineTask(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const keys = Object.keys(item);
    const hasTaskIdentity = keys.some((key) => /(^|_)(hash|info_hash|task_id|torrent_id|url)$/i.test(key));
    const hasTaskState = keys.some((key) => /(status|percent|progress|state|file_id|wp_path_id|cid)/i.test(key));
    return hasTaskIdentity && hasTaskState;
  }

  function buildOfflineTaskMatcher(results, urls, job) {
    const values = {
      ids: new Set(),
      hashes: new Set(),
      urls: new Set(urls.map(normalizeComparableUrl)),
      cids: new Set([String(job.wpPathId || ''), String(job.watchCid || '')].filter(Boolean)),
    };

    for (const result of results) {
      collectMatcherValues(result.response, values);
    }

    return values;
  }

  function collectMatcherValues(value, values) {
    visitObjects(value, (item) => {
      for (const [key, raw] of Object.entries(item)) {
        if (raw === undefined || raw === null || typeof raw === 'object') continue;
        const text = String(raw).trim();
        if (!text) continue;

        if (/^(task_id|tid|id)$/i.test(key)) values.ids.add(text);
        if (/hash/i.test(key)) values.hashes.add(text.toLowerCase());
        if (/^(url|source_url|torrent_url)$/i.test(key)) values.urls.add(normalizeComparableUrl(text));
        if (/^(cid|wp_path_id|save_cid)$/i.test(key)) values.cids.add(text);
      }
    });
  }

  function matchOfflineTask(task, matcher, job) {
    const taskValues = {
      ids: new Set(),
      hashes: new Set(),
      urls: new Set(),
      cids: new Set(),
    };
    collectMatcherValues(task, taskValues);

    if (hasIntersection(taskValues.ids, matcher.ids)) return true;
    if (hasIntersection(taskValues.hashes, matcher.hashes)) return true;
    if (hasIntersection(taskValues.urls, matcher.urls)) return true;
    if (job.isRandomFolder && job.folderName && objectText(task).includes(job.folderName)) return true;
    if (job.isRandomFolder && hasIntersection(taskValues.cids, matcher.cids)) return true;
    return false;
  }

  function isOfflineTaskDone(task) {
    const text = objectText(task).toLowerCase();
    if (/(完成|成功|done|success|finished|complete)/i.test(text)) return true;

    const status = findFirstByKey(task, /(status|state)$/i);
    if (['2', '3', '4', '100'].includes(String(status))) return true;

    const percent = Number(findFirstByKey(task, /(percent|progress|percent_done)$/i));
    if (Number.isFinite(percent) && percent >= 100) return true;

    return false;
  }

  function isOfflineTaskFailed(task) {
    const text = objectText(task).toLowerCase();
    if (/(失败|错误|取消|fail|failed|error|cancel)/i.test(text)) return true;
    const status = String(findFirstByKey(task, /(status|state)$/i) || '').toLowerCase();
    return ['-1', '5', 'failed', 'fail', 'error'].includes(status);
  }

  function describeOfflineTasks(tasks) {
    return tasks.slice(0, 3).map((task) => {
      const name = findFirstByKey(task, /^(name|file_name|filename|n)$/i);
      const status = findFirstByKey(task, /(status|state|percent|progress)$/i);
      const hash = findFirstByKey(task, /hash/i);
      return [name, status, hash].filter(Boolean).join(' / ');
    }).filter(Boolean).join('; ');
  }

  async function waitForFilesAfterOfflineWait(job, settings, historyId) {
    const startedAt = Date.now();
    const fileAppearTimeoutMs = Number(settings.pollTimeoutMs);

    while (Date.now() - startedAt < fileAppearTimeoutMs) {
      const files = await listDownloadableFiles(job.watchCid, settings);
      const newFiles = files.filter((file) => !job.beforeFileIds.has(file.id));
      const readyFiles = await resolveReadyFiles(newFiles, settings, historyId);
      const readyIds = new Set(readyFiles.map((file) => file.id));
      const pendingFiles = newFiles.filter((file) => !readyIds.has(file.id));
      if (readyFiles.length) return readyFiles;
      if (historyId) {
        upsertHistoryItem({
          id: historyId,
          status: `offline done, waiting files ready ${readyFiles.length}/${newFiles.length}`,
        });
        appendHistoryLog(historyId, 'offline done waiting files ready', {
          files: newFiles.length,
          ready: readyFiles.length,
          pending: pendingFiles.length,
          pendingFiles: pendingFiles.map((file) => summarizeDownloadFile(file)),
        });
      }
      await sleep(Math.min(Number(settings.pollIntervalMs), 15000));
    }

    throw new Error('离线任务已完成，但目标目录未找到可推送的就绪文件');
  }

  async function getFilesReadyForPush(job, settings, historyId, waitResult) {
    if (!waitResult.usedOfflineStatus) {
      return waitResult.files || waitForCompletedFiles(job, settings, historyId);
    }

    try {
      return await waitForFilesAfterOfflineWait(job, settings, historyId);
    } catch (error) {
      console.warn('[Send to 115] 离线状态完成后未发现文件，回退目录轮询', error);
      upsertHistoryItem({
        id: historyId,
        status: 'fallback directory watch',
        error: `离线状态完成但目录未出文件，回退目录轮询：${error.message || String(error)}`,
      });
      return waitForCompletedFiles(job, settings, historyId);
    }
  }

  async function waitForCompletedFiles(job, settings, historyId) {
    const startedAt = Date.now();
    let lastSignature = '';
    let stableCount = 0;

    while (Date.now() - startedAt < Number(settings.pollTimeoutMs)) {
      const files = await listDownloadableFiles(job.watchCid, settings);
      const newFiles = files.filter((file) => !job.beforeFileIds.has(file.id));
      const readyFiles = await resolveReadyFiles(newFiles, settings, historyId);
      const readyIds = new Set(readyFiles.map((file) => file.id));
      const pendingFiles = newFiles.filter((file) => !readyIds.has(file.id));
      const signature = readyFiles
        .map((file) => `${file.id}:${file.size || ''}:${file.pickcode || ''}:${file.readyDownload ? file.readyDownload.url : ''}`)
        .sort()
        .join('|');

      if (readyFiles.length && signature === lastSignature) {
        stableCount += 1;
      } else {
        stableCount = readyFiles.length ? 1 : 0;
        lastSignature = signature;
      }

      const pendingText = pendingFiles.length ? `, pending ${pendingFiles.length}` : '';
      const status = `directory ${readyFiles.length}/${newFiles.length} ready${pendingText} stable ${stableCount}/${settings.stableRounds}`;
      if (historyId) upsertHistoryItem({ id: historyId, status });
      if (historyId) appendHistoryLog(historyId, 'directory poll', {
        files: newFiles.length,
        ready: readyFiles.length,
        pending: pendingFiles.length,
        stableCount,
        pendingFiles: pendingFiles.map((file) => summarizeDownloadFile(file)),
      });
      notify('等待 115 离线完成', `${readyFiles.length}/${newFiles.length} 个文件就绪，稳定 ${stableCount}/${settings.stableRounds}`);

      if (readyFiles.length && stableCount >= Number(settings.stableRounds)) {
        return readyFiles;
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

  async function resolveReadyFiles(files, settings, historyId) {
    const readyFiles = [];
    for (const file of files) {
      if (!isPendingFile(file, settings)) {
        readyFiles.push(file);
        continue;
      }

      try {
        const enrichedFile = await enrichFileFromCategory(file);
        const download = await getDownloadUrl(enrichedFile, settings);
        enrichedFile.readyDownload = download;
        readyFiles.push(enrichedFile);
        if (historyId) appendHistoryLog(historyId, 'pending file direct url ready', {
          file: summarizeDownloadFile(enrichedFile),
          url: download.url,
        });
      } catch (error) {
        if (!isIncompleteUploadError(error)) {
          logJson('pending file direct url probe failed', {
            file: summarizeDownloadFile(file),
            error: error.message || String(error),
            response: error.response || null,
          });
        }
      }
    }
    return readyFiles;
  }

  async function enrichFileFromCategory(file) {
    if (!file || !file.id) return file;

    const response = await request({
      method: 'GET',
      url: API.categoryGet(file.id),
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://webapi.115.com/bridge_2.0.html?namespace=Core.DataAccess&api=UDataAPI&_t=v5',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    const json = parseJson(response.responseText);
    logJson('115 category/get response', {
      file: summarizeDownloadFile(file),
      response: summarizeCategoryGetResponse(json),
    });

    if (json.state === false) {
      const error = new Error(json.error_msg || json.msg || json.error || '获取 115 文件详情失败');
      error.response = json;
      throw error;
    }

    const size = parseFileSize(json.size || json.file_size || json.s);
    return {
      ...file,
      name: String(json.file_name || json.name || file.name || '').trim(),
      pickcode: String(json.pick_code || json.pickcode || file.pickcode || '').trim(),
      size: size || file.size,
      raw: {
        ...(file.raw || {}),
        ...summarizeCategoryGetResponse(json),
      },
    };
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
    const size = parseFileSize(entry.s || entry.size || entry.file_size || entry.fs || entry.fsize || entry.f_size || 0);

    return {
      id,
      pickcode,
      name,
      isDir,
      size,
      raw: summarizeFileEntry(entry),
    };
  }

  function isPendingFile(file, settings) {
    if (settings.allowZeroSizeFiles) return false;
    if (!file || file.isDir || !file.pickcode) return true;
    const size = Number(file.size || 0);
    const raw = file.raw || {};
    const sha = String(raw.sha || raw.sha1 || raw.file_sha1 || '').trim();
    return size <= 0 && !sha;
  }

  function summarizeFileEntry(entry) {
    const summary = {};
    for (const key of ['fid', 'file_id', 'cid', 'id', 'pc', 'pick_code', 'pickcode', 'n', 'name', 'file_name', 's', 'size', 'file_size', 'fs', 'fsize', 'sha', 'sha1', 'file_sha1', 'ico', 'class']) {
      if (entry[key] !== undefined && entry[key] !== null) summary[key] = entry[key];
    }
    return summary;
  }

  function summarizeCategoryGetResponse(json) {
    const summary = {};
    for (const key of ['state', 'error', 'errNo', 'msg', 'count', 'size', 'file_size', 'file_name', 'pick_code', 'pickcode', 'sha1', 'ptime', 'ctime', 'utime', 'open_time', 'rtime', 'file_category']) {
      if (json && json[key] !== undefined && json[key] !== null) summary[key] = json[key];
    }
    if (json && Array.isArray(json.paths)) {
      summary.paths = json.paths.map((item) => ({
        file_id: item.file_id,
        file_name: item.file_name,
      }));
    }
    return summary;
  }

  function parseFileSize(value) {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

    const text = String(value).trim();
    const number = Number(text);
    if (Number.isFinite(number)) return number;

    const match = text.match(/^([\d.]+)\s*([kmgtp]?b)$/i);
    if (!match) return 0;

    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return 0;
    const units = {
      b: 1,
      kb: 1024,
      mb: 1024 ** 2,
      gb: 1024 ** 3,
      tb: 1024 ** 4,
      pb: 1024 ** 5,
    };
    return Math.round(amount * (units[match[2].toLowerCase()] || 1));
  }

  async function pushFilesToAria2(files, settings, historyId) {
    const pushed = [];
    for (const file of files) {
      const download = file.readyDownload || await waitForDownloadUrl(file, settings, historyId);
      const options = buildAria2Options({ ...file, ...download.fileInfo }, settings);
      if (historyId) appendHistoryLog(historyId, 'aria2 addUri request', {
        name: file.name,
        url: download.url,
        options,
      });
      logJson('aria2 addUri request', {
        name: file.name,
        url: download.url,
        options,
      });
      const result = await aria2AddUri(download.url, options, settings);
      logJson('aria2 addUri result', {
        name: file.name,
        result,
      });
      pushed.push(file);
    }
    return pushed;
  }

  async function waitForDownloadUrl(file, settings, historyId) {
    const startedAt = Date.now();
    let attempts = 0;

    while (Date.now() - startedAt < Number(settings.pollTimeoutMs)) {
      attempts += 1;
      try {
        const download = await getDownloadUrl(file, settings);
        if (historyId) appendHistoryLog(historyId, 'download url ready', {
          name: file.name,
          attempts,
          url: download.url,
        });
        return download;
      } catch (error) {
        if (!isIncompleteUploadError(error)) throw error;

        const waitMs = Math.min(Number(settings.pollIntervalMs), 30000);
        if (historyId) {
          upsertHistoryItem({
            id: historyId,
            status: 'waiting downloadable',
            detail: `${file.name || file.pickcode} · ${error.message || String(error)}`,
          });
          appendHistoryLog(historyId, 'download url not ready', {
            name: file.name,
            pickcode: file.pickcode,
            size: file.size,
            raw: file.raw,
            attempts,
            error: error.message || String(error),
            response: error.response || null,
          });
        }
        notify('等待 115 文件可下载', `${file.name || file.pickcode}`);
        await sleep(waitMs);
      }
    }

    throw new Error(`等待 115 文件可下载超时：${file.name || file.pickcode}`);
  }

  async function getDownloadUrl(file, settings) {
    try {
      return await getChromeDownloadUrl(file, settings);
    } catch (error) {
      console.warn('[Send to 115] chrome downurl failed, fallback webapi', error);
    }

    const url = API.download(file.pickcode);
    const response = await request({
      method: 'GET',
      url,
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://115.com/',
      },
    });
    const json = parseJson(response.responseText);
    const downloadUrl = findDownloadUrl(json);
    logJson('115 webapi download response', {
      file,
      requestUrl: url,
      response: json,
      directUrl: downloadUrl,
    });
    if (!json.state || !downloadUrl) {
      const error = new Error(json.error_msg || json.msg || `获取下载链接失败：${file.name || file.pickcode}`);
      error.response = json;
      throw error;
    }

    logJson('115 direct url', { source: 'webapi', directUrl: downloadUrl });
    return { url: downloadUrl, response: json };
  }

  async function getChromeDownloadUrl(file, settings) {
    const time = Math.floor(Date.now() / 1000);
    const encoded = m115Encode(JSON.stringify({ pickcode: file.pickcode }), time);
    const manualCookieHeader = String(settings && settings.downurlCookieHeader || '').trim();
    const browserCookieHeader = settings && settings.useBrowserCookieHeader
      ? await get115CookieHeader()
      : '';
    const cookieHeader = manualCookieHeader || browserCookieHeader;
    const cookieNames = getCookieNames(cookieHeader);
    const sendCookieHeader = Boolean(manualCookieHeader) || isLikelyComplete115CookieHeader(browserCookieHeader);
    const requestInfo = {
      file: summarizeDownloadFile(file),
      time,
      url: API.chromeDownurl(time),
      payload: { pickcode: file.pickcode },
      dataLength: encoded.data.length,
      cookieNames,
      cookieHeaderLoaded: Boolean(cookieHeader),
      cookieHeaderSent: sendCookieHeader,
      cookieHeaderComplete: Boolean(manualCookieHeader) || isLikelyComplete115CookieHeader(browserCookieHeader),
      cookieHeaderSource: manualCookieHeader ? 'manual' : (browserCookieHeader ? 'browser' : 'none'),
      extensionBridgeEnabled: Boolean(settings && settings.useExtensionBridge),
      nativeFetchEnabled: Boolean(settings && settings.preferNativeFetchDownurl),
    };
    logJson('115 chrome downurl request', requestInfo);

    if (settings && settings.useExtensionBridge && !manualCookieHeader) {
      const extensionResult = await tryExtensionChromeDownurl(file, encoded, time);
      if (extensionResult && extensionResult.url) return extensionResult;
    }

    if (settings && settings.preferNativeFetchDownurl && !manualCookieHeader) {
      const nativeResult = await tryNativeChromeDownurl(file, encoded, time);
      if (nativeResult && nativeResult.url) return nativeResult;
    }

    const response = await request({
      method: 'POST',
      url: API.chromeDownurl(time),
      data: `data=${encodeURIComponent(encoded.data)}`,
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://115.com',
        'Referer': 'https://115.com/',
        ...(sendCookieHeader ? { 'Cookie': cookieHeader } : {}),
      },
    });
    const json = parseJson(response.responseText);
    return parseChromeDownurlResult(file, encoded, json, 'chromeDownurl');
  }

  function parseChromeDownurlResult(file, encoded, json, source) {
    const decoded = json && json.data ? parseJson(m115Decode(json.data, encoded.key)) : json;
    const directItem = getChromeDownloadItem(decoded);
    const downloadUrl = directItem.url || findDownloadUrl(decoded);
    logJson(`115 ${source} raw response`, {
      file: summarizeDownloadFile(file),
      response: json,
    });
    logJson(`115 ${source} decoded`, {
      file: summarizeDownloadFile(file),
      decoded,
      directItem,
      directUrl: downloadUrl,
    });

    if (!downloadUrl) {
      const error = new Error(findErrorMessage(decoded) || findErrorMessage(json) || `chrome downurl 获取下载链接失败：${file.name || file.pickcode}`);
      error.response = decoded || json;
      throw error;
    }

    logJson('115 direct url', {
      source,
      name: directItem.name || file.name,
      size: directItem.size || file.size,
      pickcode: directItem.pickcode || file.pickcode,
      directUrl: downloadUrl,
    });
    return {
      url: downloadUrl,
      response: decoded,
      fileInfo: {
        name: directItem.name || file.name,
        size: directItem.size || file.size,
        pickcode: directItem.pickcode || file.pickcode,
      },
    };
  }

  async function tryExtensionChromeDownurl(file, encoded, time) {
    try {
      const ping = await sendExtensionBridgeRequest({ action: 'ping' }, 3000);
      logJson('115 extension bridge ping', {
        ok: ping && ping.ok,
        version: ping && ping.version,
        error: ping && ping.error,
      });
      if (!ping || !ping.ok) {
        const staleMessage = ping && ping.error
          ? `扩展后台可能还是旧版：${ping.error}`
          : '扩展后台没有响应版本信息';
        notify('115 扩展需要重新加载', `${staleMessage}。请在 chrome://extensions 点 Reload 或删除旧扩展后重新 Load unpacked。`);
        logJson('115 extension bridge stale or old', {
          ping,
          hint: 'Reload extension 0.1.2+ in chrome://extensions, then refresh this page.',
        });
      }

      const response = await sendExtensionBridgeRequest({
        action: 'chromeDownurl',
        url: API.chromeDownurl(time),
        data: encoded.data,
        file: summarizeDownloadFile(file),
      }, 12000);

      logJson('115 extension bridge response', {
        file: summarizeDownloadFile(file),
        ok: response && response.ok,
        error: response && response.error,
        status: response && response.status,
        source: response && response.source,
        cookieNames: response && response.cookieNames,
        cookieDiagnostics: response && response.cookieDiagnostics,
        tabError: response && response.tabError,
        hasResponse: Boolean(response && response.response),
      });

      if (!response || !response.ok || !response.response) return null;
      return parseChromeDownurlResult(file, encoded, response.response, 'extensionDownurl');
    } catch (error) {
      logJson('115 extension bridge unavailable', {
        file: summarizeDownloadFile(file),
        error: error.message || String(error),
        hint: 'Reload the Send to 115 Bridge extension in chrome://extensions, then refresh this page.',
      });
      return null;
    }
  }

  async function tryNativeChromeDownurl(file, encoded, time) {
    if (typeof fetch !== 'function') return null;

    try {
      const response = await fetch(API.chromeDownurl(time), {
        method: 'POST',
        credentials: 'include',
        mode: 'cors',
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(encoded.data)}`,
      });
      const json = await response.json();
      const decoded = json && json.data ? parseJson(m115Decode(json.data, encoded.key)) : json;
      const directItem = getChromeDownloadItem(decoded);
      const downloadUrl = directItem.url || findDownloadUrl(decoded);
      logJson('115 native downurl decoded', {
        file: summarizeDownloadFile(file),
        httpStatus: response.status,
        response: json,
        decoded,
        directItem,
        directUrl: downloadUrl,
      });

      if (!downloadUrl) return null;
      logJson('115 direct url', {
        source: 'nativeChromeDownurl',
        name: directItem.name || file.name,
        size: directItem.size || file.size,
        pickcode: directItem.pickcode || file.pickcode,
        directUrl: downloadUrl,
      });
      return {
        url: downloadUrl,
        response: decoded,
        fileInfo: {
          name: directItem.name || file.name,
          size: directItem.size || file.size,
          pickcode: directItem.pickcode || file.pickcode,
        },
      };
    } catch (error) {
      logJson('115 native downurl failed', {
        file: summarizeDownloadFile(file),
        error: error.message || String(error),
      });
      return null;
    }
  }

  function sendExtensionBridgeRequest(payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const targetWindow = getExtensionBridgeWindow();
      const listeners = [window];
      if (targetWindow && targetWindow !== window) listeners.push(targetWindow);
      const id = `send-to-115-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('extension bridge timeout'));
      }, timeoutMs || 10000);

      function cleanup() {
        for (const listenerWindow of listeners) {
          try {
            listenerWindow.removeEventListener('message', onMessage);
          } catch (_) {}
        }
      }

      function onMessage(event) {
        const message = event.data;
        if (!message || message.source !== 'send-to-115-extension' || message.id !== id) return;

        window.clearTimeout(timer);
        cleanup();
        resolve(message.payload || null);
      }

      for (const listenerWindow of listeners) {
        try {
          listenerWindow.addEventListener('message', onMessage);
        } catch (_) {}
      }

      targetWindow.postMessage({
        source: 'send-to-115-userscript',
        id,
        payload,
      }, '*');
    });
  }

  function getExtensionBridgeWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch (_) {}
    return window;
  }

  function summarizeDownloadFile(file) {
    return {
      id: file && file.id,
      name: file && file.name,
      pickcode: file && file.pickcode,
      size: file && file.size,
      raw: file && file.raw,
    };
  }

  async function get115CookieHeader() {
    const scopes = [
      { url: 'https://115.com/' },
      { url: 'https://webapi.115.com/' },
      { url: 'https://my.115.com/' },
      { url: 'https://proapi.115.com/' },
      { domain: '.115.com' },
      { domain: '115.com' },
    ];
    const cookiesByName = new Map();
    const scopeResults = [];

    for (const scope of scopes) {
      const cookies = await listBrowserCookies(scope);
      scopeResults.push({
        scope,
        cookieNames: cookies.map((cookie) => cookie.name).filter(Boolean),
        count: cookies.length,
      });
      for (const cookie of cookies) {
        if (!cookie || !cookie.name || cookie.value === undefined) continue;
        const old = cookiesByName.get(cookie.name);
        if (!old || String(cookie.domain || '').length > String(old.domain || '').length) {
          cookiesByName.set(cookie.name, cookie);
        }
      }
    }

    const cookies = Array.from(cookiesByName.values());
    const header = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    logJson('browser cookie header loaded', {
      cookieNames: cookies.map((cookie) => cookie.name).filter(Boolean),
      complete: isLikelyComplete115CookieHeader(header),
      count: cookies.length,
      scopeResults,
    });
    return header;
  }

  async function listBrowserCookies(details) {
    if (typeof GM_cookie === 'undefined' || !GM_cookie || typeof GM_cookie.list !== 'function') {
      logJson('browser cookie header unavailable', { details, reason: 'GM_cookie unavailable' });
      return [];
    }

    return new Promise((resolve) => {
      try {
        GM_cookie.list(details, (cookies, error) => {
          if (error) {
            logJson('browser cookie scope unavailable', { details, error: error.message || String(error) });
            resolve([]);
            return;
          }

          resolve(Array.isArray(cookies) ? cookies : []);
        });
      } catch (error) {
        logJson('browser cookie scope unavailable', { details, error: error.message || String(error) });
        resolve([]);
      }
    });
  }

  function getCookieNames(header) {
    return String(header || '')
      .split(';')
      .map((part) => part.split('=')[0].trim())
      .filter(Boolean);
  }

  function isLikelyComplete115CookieHeader(header) {
    const names = new Set(getCookieNames(header));
    return names.has('UID') && names.has('SEID') && names.has('KID');
  }

  function getChromeDownloadItem(decoded) {
    const item = decoded && typeof decoded === 'object' ? Object.values(decoded).pop() : null;
    if (!item || typeof item !== 'object') {
      return { url: '', name: '', size: 0, pickcode: '' };
    }
    const nestedUrl = item.url && typeof item.url === 'object' ? item.url.url : item.url;
    const url = [item.file_url, item.file_url_302, nestedUrl, item.download_url]
      .map((candidate) => String(candidate || '').trim())
      .find((candidate) => /^https?:\/\//i.test(candidate)) || '';

    return {
      url,
      name: String(item.file_name || item.name || ''),
      size: parseFileSize(item.file_size || item.size || 0),
      pickcode: String(item.pick_code || item.pickcode || ''),
      raw: item,
    };
  }

  function findErrorMessage(value) {
    if (!value || typeof value !== 'object') return '';
    for (const key of ['error_msg', 'err_msg', 'msg', 'message']) {
      if (value[key]) return String(value[key]);
    }
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') {
        const message = findErrorMessage(nested);
        if (message) return message;
      }
    }
    return '';
  }

  const M115_RSA_N = BigInt('0x8686980c0f5a24c4b9d43020cd2c22703ff3f450756529058b1cf88f09b8602136477198a6e2683149659bd122c33592fdb5ad47944ad1ea4d36c6b172aad6338c3bb6ac6227502d010993ac967d1aef00f0c8e038de2e4d3bc2ec368af2e9f10a6f1eda4f7262f136420c07c331b871bf139f74f3010e3c4fe57df3afb71683');
  const M115_RSA_E = BigInt('0x10001');
  const M115_KTS = [
    240, 229, 105, 174, 191, 220, 191, 138, 26, 69, 232, 190, 125, 166, 115, 184,
    222, 143, 231, 196, 69, 218, 134, 196, 155, 100, 139, 20, 106, 180, 241, 170,
    56, 1, 53, 158, 38, 105, 44, 134, 0, 107, 79, 165, 54, 52, 98, 166,
    42, 150, 104, 24, 242, 74, 253, 189, 107, 151, 143, 77, 143, 137, 19, 183,
    108, 142, 147, 237, 14, 13, 72, 62, 215, 47, 136, 216, 254, 254, 126, 134,
    80, 149, 79, 209, 235, 131, 38, 52, 219, 102, 123, 156, 126, 157, 122, 129,
    50, 234, 182, 51, 222, 58, 169, 89, 52, 102, 59, 170, 186, 129, 96, 72,
    185, 213, 129, 156, 248, 108, 132, 119, 255, 84, 120, 38, 95, 190, 232, 30,
    54, 159, 52, 128, 92, 69, 44, 155, 118, 213, 27, 143, 204, 195, 184, 245,
  ];
  const M115_KEY_S = [0x29, 0x23, 0x21, 0x5E];
  const M115_KEY_L = [120, 6, 173, 76, 51, 134, 93, 24, 76, 1, 63, 70];

  function m115Encode(src, time) {
    const key = stringToBytes(md5(`!@###@#${time}DFDR@#@#`));
    let tmp = stringToBytes(src);
    tmp = m115SymEncode(tmp, key, null);
    tmp = key.slice(0, 16).concat(tmp);
    return {
      data: m115AsymEncode(tmp),
      key,
    };
  }

  function m115Decode(src, key) {
    const tmp = m115AsymDecode(stringToBytes(window.atob(src)));
    return bytesToString(m115SymDecode(tmp.slice(16), key, tmp.slice(0, 16)));
  }

  function m115GetKey(length, key) {
    if (key) {
      return Array.from({ length }, (_, index) => ((key[index] + M115_KTS[length * index]) & 0xff) ^ M115_KTS[length * (length - 1 - index)]);
    }
    return length === 12 ? M115_KEY_L.slice() : M115_KEY_S.slice();
  }

  function xor115(src, key) {
    const mod4 = src.length % 4;
    const ret = [];
    for (let index = 0; index < mod4; index += 1) {
      ret.push(src[index] ^ key[index % key.length]);
    }
    for (let index = mod4; index < src.length; index += 1) {
      ret.push(src[index] ^ key[(index - mod4) % key.length]);
    }
    return ret;
  }

  function m115SymEncode(src, key1, key2) {
    const k1 = m115GetKey(4, key1);
    const k2 = m115GetKey(12, key2);
    return xor115(xor115(src, k1).reverse(), k2);
  }

  function m115SymDecode(src, key1, key2) {
    const k1 = m115GetKey(4, key1);
    const k2 = m115GetKey(12, key2);
    return xor115(xor115(src, k2).reverse(), k1);
  }

  function m115AsymEncode(src) {
    const chunkSize = 117;
    let hex = '';
    for (let offset = 0; offset < src.length; offset += chunkSize) {
      hex += rsaEncryptBytes(src.slice(offset, offset + chunkSize));
    }
    return window.btoa(bytesToString(hexToBytes(hex)));
  }

  function m115AsymDecode(src) {
    const chunkSize = 128;
    let ret = '';
    for (let offset = 0; offset < src.length; offset += chunkSize) {
      ret += rsaDecryptBytes(src.slice(offset, offset + chunkSize));
    }
    return stringToBytes(ret);
  }

  function rsaEncryptBytes(bytes) {
    const padded = pkcs1Pad(bytes, 128);
    const encrypted = modPow(bytesToBigInt(padded), M115_RSA_E, M115_RSA_N);
    return bigIntToHex(encrypted, 256);
  }

  function rsaDecryptBytes(bytes) {
    const decrypted = modPow(bytesToBigInt(bytes), M115_RSA_E, M115_RSA_N);
    const hex = decrypted.toString(16).length % 2 ? `0${decrypted.toString(16)}` : decrypted.toString(16);
    const chars = bytesToString(hexToBytes(hex));
    let index = 1;
    while (index < chars.length && chars.charCodeAt(index) !== 0) index += 1;
    return chars.slice(index + 1);
  }

  function pkcs1Pad(bytes, length) {
    if (length < bytes.length + 11) throw new Error('m115 RSA block too long');
    const padded = new Array(length);
    let target = length;
    for (let index = bytes.length - 1; index >= 0 && target > 0; index -= 1) {
      padded[--target] = bytes[index];
    }
    padded[--target] = 0;
    while (target > 2) padded[--target] = 0xff;
    padded[--target] = 2;
    padded[--target] = 0;
    return padded;
  }

  function modPow(base, exponent, modulus) {
    let result = 1n;
    let current = base % modulus;
    let exp = exponent;
    while (exp > 0n) {
      if (exp & 1n) result = (result * current) % modulus;
      exp >>= 1n;
      current = (current * current) % modulus;
    }
    return result;
  }

  function bytesToBigInt(bytes) {
    return BigInt(`0x${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('') || '0'}`);
  }

  function bigIntToHex(value, length) {
    return value.toString(16).padStart(length, '0');
  }

  function hexToBytes(hex) {
    const bytes = [];
    for (let index = 0; index < hex.length; index += 2) {
      bytes.push(parseInt(hex.slice(index, index + 2), 16));
    }
    return bytes;
  }

  function stringToBytes(value) {
    return Array.from(String(value), (char) => char.charCodeAt(0));
  }

  function bytesToString(bytes) {
    return bytes.map((byte) => String.fromCharCode(byte)).join('');
  }

  function md5(input) {
    const rotateLeft = (value, shift) => (value << shift) | (value >>> (32 - shift));
    const add = (left, right) => (left + right) >>> 0;
    const cmn = (q, a, b, x, s, t) => add(rotateLeft(add(add(a, q), add(x, t)), s), b);
    const ff = (a, b, c, d, x, s, t) => cmn((b & c) | (~b & d), a, b, x, s, t);
    const gg = (a, b, c, d, x, s, t) => cmn((b & d) | (c & ~d), a, b, x, s, t);
    const hh = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t);
    const ii = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t);
    const text = unescape(encodeURIComponent(input));
    const words = [];
    for (let index = 0; index < text.length; index += 1) {
      words[index >> 2] = (words[index >> 2] || 0) | (text.charCodeAt(index) << ((index % 4) * 8));
    }
    words[text.length >> 2] = (words[text.length >> 2] || 0) | (0x80 << ((text.length % 4) * 8));
    words[(((text.length + 8) >> 6) << 4) + 14] = text.length * 8;

    let a = 0x67452301;
    let b = 0xefcdab89;
    let c = 0x98badcfe;
    let d = 0x10325476;

    for (let index = 0; index < words.length; index += 16) {
      const oldA = a;
      const oldB = b;
      const oldC = c;
      const oldD = d;
      a = ff(a, b, c, d, words[index + 0] || 0, 7, 0xd76aa478);
      d = ff(d, a, b, c, words[index + 1] || 0, 12, 0xe8c7b756);
      c = ff(c, d, a, b, words[index + 2] || 0, 17, 0x242070db);
      b = ff(b, c, d, a, words[index + 3] || 0, 22, 0xc1bdceee);
      a = ff(a, b, c, d, words[index + 4] || 0, 7, 0xf57c0faf);
      d = ff(d, a, b, c, words[index + 5] || 0, 12, 0x4787c62a);
      c = ff(c, d, a, b, words[index + 6] || 0, 17, 0xa8304613);
      b = ff(b, c, d, a, words[index + 7] || 0, 22, 0xfd469501);
      a = ff(a, b, c, d, words[index + 8] || 0, 7, 0x698098d8);
      d = ff(d, a, b, c, words[index + 9] || 0, 12, 0x8b44f7af);
      c = ff(c, d, a, b, words[index + 10] || 0, 17, 0xffff5bb1);
      b = ff(b, c, d, a, words[index + 11] || 0, 22, 0x895cd7be);
      a = ff(a, b, c, d, words[index + 12] || 0, 7, 0x6b901122);
      d = ff(d, a, b, c, words[index + 13] || 0, 12, 0xfd987193);
      c = ff(c, d, a, b, words[index + 14] || 0, 17, 0xa679438e);
      b = ff(b, c, d, a, words[index + 15] || 0, 22, 0x49b40821);
      a = gg(a, b, c, d, words[index + 1] || 0, 5, 0xf61e2562);
      d = gg(d, a, b, c, words[index + 6] || 0, 9, 0xc040b340);
      c = gg(c, d, a, b, words[index + 11] || 0, 14, 0x265e5a51);
      b = gg(b, c, d, a, words[index + 0] || 0, 20, 0xe9b6c7aa);
      a = gg(a, b, c, d, words[index + 5] || 0, 5, 0xd62f105d);
      d = gg(d, a, b, c, words[index + 10] || 0, 9, 0x02441453);
      c = gg(c, d, a, b, words[index + 15] || 0, 14, 0xd8a1e681);
      b = gg(b, c, d, a, words[index + 4] || 0, 20, 0xe7d3fbc8);
      a = gg(a, b, c, d, words[index + 9] || 0, 5, 0x21e1cde6);
      d = gg(d, a, b, c, words[index + 14] || 0, 9, 0xc33707d6);
      c = gg(c, d, a, b, words[index + 3] || 0, 14, 0xf4d50d87);
      b = gg(b, c, d, a, words[index + 8] || 0, 20, 0x455a14ed);
      a = gg(a, b, c, d, words[index + 13] || 0, 5, 0xa9e3e905);
      d = gg(d, a, b, c, words[index + 2] || 0, 9, 0xfcefa3f8);
      c = gg(c, d, a, b, words[index + 7] || 0, 14, 0x676f02d9);
      b = gg(b, c, d, a, words[index + 12] || 0, 20, 0x8d2a4c8a);
      a = hh(a, b, c, d, words[index + 5] || 0, 4, 0xfffa3942);
      d = hh(d, a, b, c, words[index + 8] || 0, 11, 0x8771f681);
      c = hh(c, d, a, b, words[index + 11] || 0, 16, 0x6d9d6122);
      b = hh(b, c, d, a, words[index + 14] || 0, 23, 0xfde5380c);
      a = hh(a, b, c, d, words[index + 1] || 0, 4, 0xa4beea44);
      d = hh(d, a, b, c, words[index + 4] || 0, 11, 0x4bdecfa9);
      c = hh(c, d, a, b, words[index + 7] || 0, 16, 0xf6bb4b60);
      b = hh(b, c, d, a, words[index + 10] || 0, 23, 0xbebfbc70);
      a = hh(a, b, c, d, words[index + 13] || 0, 4, 0x289b7ec6);
      d = hh(d, a, b, c, words[index + 0] || 0, 11, 0xeaa127fa);
      c = hh(c, d, a, b, words[index + 3] || 0, 16, 0xd4ef3085);
      b = hh(b, c, d, a, words[index + 6] || 0, 23, 0x04881d05);
      a = hh(a, b, c, d, words[index + 9] || 0, 4, 0xd9d4d039);
      d = hh(d, a, b, c, words[index + 12] || 0, 11, 0xe6db99e5);
      c = hh(c, d, a, b, words[index + 15] || 0, 16, 0x1fa27cf8);
      b = hh(b, c, d, a, words[index + 2] || 0, 23, 0xc4ac5665);
      a = ii(a, b, c, d, words[index + 0] || 0, 6, 0xf4292244);
      d = ii(d, a, b, c, words[index + 7] || 0, 10, 0x432aff97);
      c = ii(c, d, a, b, words[index + 14] || 0, 15, 0xab9423a7);
      b = ii(b, c, d, a, words[index + 5] || 0, 21, 0xfc93a039);
      a = ii(a, b, c, d, words[index + 12] || 0, 6, 0x655b59c3);
      d = ii(d, a, b, c, words[index + 3] || 0, 10, 0x8f0ccc92);
      c = ii(c, d, a, b, words[index + 10] || 0, 15, 0xffeff47d);
      b = ii(b, c, d, a, words[index + 1] || 0, 21, 0x85845dd1);
      a = ii(a, b, c, d, words[index + 8] || 0, 6, 0x6fa87e4f);
      d = ii(d, a, b, c, words[index + 15] || 0, 10, 0xfe2ce6e0);
      c = ii(c, d, a, b, words[index + 6] || 0, 15, 0xa3014314);
      b = ii(b, c, d, a, words[index + 13] || 0, 21, 0x4e0811a1);
      a = ii(a, b, c, d, words[index + 4] || 0, 6, 0xf7537e82);
      d = ii(d, a, b, c, words[index + 11] || 0, 10, 0xbd3af235);
      c = ii(c, d, a, b, words[index + 2] || 0, 15, 0x2ad7d2bb);
      b = ii(b, c, d, a, words[index + 9] || 0, 21, 0xeb86d391);
      a = add(a, oldA);
      b = add(b, oldB);
      c = add(c, oldC);
      d = add(d, oldD);
    }

    return [a, b, c, d].map((word) => [0, 8, 16, 24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
  }

  function isIncompleteUploadError(error) {
    const message = [
      error && (error.message || String(error)),
      error && error.response ? objectText(error.response) : '',
    ].join(' ');
    return /上传不完整|文件上传不完整|not.*complete|incomplete/i.test(message || '');
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

  function visitObjects(value, visitor, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);

    if (!Array.isArray(value)) visitor(value);
    for (const nested of Object.values(value)) {
      visitObjects(nested, visitor, seen);
    }
  }

  function dedupeObjects(items) {
    const seen = new Set();
    const unique = [];
    for (const item of items) {
      const key = [
        findFirstByKey(item, /^(task_id|tid|id)$/i),
        findFirstByKey(item, /hash/i),
        findFirstByKey(item, /^(url|source_url)$/i),
        findFirstByKey(item, /^(name|file_name|filename|n)$/i),
      ].filter(Boolean).join('|') || JSON.stringify(item).slice(0, 200);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }

  function hasIntersection(left, right) {
    for (const item of left) {
      if (item && right.has(item)) return true;
    }
    return false;
  }

  function normalizeComparableUrl(url) {
    return String(url || '').trim().replace(/&amp;/g, '&');
  }

  function objectText(value) {
    const parts = [];
    visitObjects(value, (item) => {
      for (const raw of Object.values(item)) {
        if (raw === undefined || raw === null || typeof raw === 'object') continue;
        parts.push(String(raw));
      }
    });
    return parts.join(' ');
  }

  function findFirstByKey(value, pattern) {
    let found = '';
    visitObjects(value, (item) => {
      if (found) return;
      for (const [key, raw] of Object.entries(item)) {
        if (!pattern.test(key)) continue;
        if (raw === undefined || raw === null || typeof raw === 'object') continue;
        const text = String(raw).trim();
        if (text) {
          found = text;
          return;
        }
      }
    });
    return found;
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
    const payload = {
      jsonrpc: '2.0',
      id: `send-to-115-${Date.now()}`,
      method: 'aria2.addUri',
      params,
    };
    logJson('aria2 rpc payload', {
      rpcUrl: settings.aria2RpcUrl,
      payload,
    });

    const response = await request({
      method: 'POST',
      url: settings.aria2RpcUrl,
      data: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    const json = parseJson(response.responseText);
    logJson('aria2 rpc response', json);
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
        anonymous: false,
        withCredentials: true,
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

// ==UserScript==
// @name         Send to 115 Offline
// @namespace    https://github.com/lgithubl/send-to-115-userscript
// @version      0.6.3
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
    title.textContent = 'Send to 115';
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
      const files = await listDownloadableFiles(job.watchCid || job.wpPathId || '0', getSettings());
      const newFiles = files.filter((file) => !job.beforeFileIds.has(file.id));
      const pendingFiles = newFiles.filter((file) => !file.size);
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

      const files = await listDownloadableFiles(job.watchCid || job.wpPathId || '0', settings);
      const newFiles = files.filter((file) => !job.beforeFileIds.has(file.id));
      if (!newFiles.length) {
        throw new Error('目标目录没有发现可推送的新增文件');
      }

      appendHistoryLog(id, 'manual aria2 files', newFiles.map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size,
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

    return Boolean(findFirstByKey(task, /^(file_id|fid|pickcode|pick_code)$/i));
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
    const fileAppearTimeoutMs = Math.min(Number(settings.pollTimeoutMs), Math.max(Number(settings.pollIntervalMs) * 4, 120000));

    while (Date.now() - startedAt < fileAppearTimeoutMs) {
      const files = await listDownloadableFiles(job.watchCid, settings);
      const newFiles = files.filter((file) => !job.beforeFileIds.has(file.id));
      if (newFiles.length) return newFiles;
      if (historyId) upsertHistoryItem({ id: historyId, status: 'offline done, waiting files' });
      await sleep(Math.min(Number(settings.pollIntervalMs), 15000));
    }

    throw new Error('离线任务已完成，但目标目录未找到新增文件');
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

      const status = `directory ${newFiles.length} files stable ${stableCount}/${settings.stableRounds}`;
      if (historyId) upsertHistoryItem({ id: historyId, status });
      if (historyId) appendHistoryLog(historyId, 'directory poll', {
        files: newFiles.length,
        stableCount,
      });
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
    const size = Number(entry.s || entry.size || entry.file_size || entry.fs || entry.fsize || entry.f_size || 0);

    return {
      id,
      pickcode,
      name,
      isDir,
      size,
    };
  }

  async function pushFilesToAria2(files, settings, historyId) {
    const pushed = [];
    for (const file of files) {
      const download = await waitForDownloadUrl(file, settings, historyId);
      const options = buildAria2Options(file, settings);
      await aria2AddUri(download.url, options, settings);
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
        const download = await getDownloadUrl(file);
        if (historyId) appendHistoryLog(historyId, 'download url ready', {
          name: file.name,
          attempts,
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
            size: file.size,
            attempts,
            error: error.message || String(error),
          });
        }
        notify('等待 115 文件可下载', `${file.name || file.pickcode}`);
        await sleep(waitMs);
      }
    }

    throw new Error(`等待 115 文件可下载超时：${file.name || file.pickcode}`);
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
      const error = new Error(json.error_msg || json.msg || `获取下载链接失败：${file.name || file.pickcode}`);
      error.response = json;
      throw error;
    }

    return { url };
  }

  function isIncompleteUploadError(error) {
    const message = error && (error.message || String(error));
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

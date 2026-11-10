(() => {
  const bridgeMeta = {
    extensionId: chrome.runtime.id,
    bridgeVersion: chrome.runtime.getManifest().version,
  };

  // 读剪贴板：页面是 HTTP（局域网 IP）时 navigator.clipboard 不存在，扩展有 clipboardRead 权限，可以在页面里 execCommand('paste')
  function readClipboardByPaste() {
    const previous = document.activeElement;
    const box = document.createElement('textarea');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
    (document.body || document.documentElement).appendChild(box);
    box.focus();
    let ok = false;
    try {
      ok = document.execCommand('paste');
    } catch (error) {
      ok = false;
    }
    const text = box.value;
    box.remove();
    try {
      if (previous && previous.focus) previous.focus();
    } catch (error) {
      // 忽略
    }
    if (!ok) return { ok: false, error: 'execCommand(paste) 被浏览器拒绝（扩展需要 clipboardRead 权限并重新加载）' };
    return { ok: true, text, source: 'extension-paste' };
  }

  window.addEventListener('message', async (event) => {
    const message = event.data;
    if (!message || message.source !== 'send-to-115-userscript' || !message.id) return;

    if (message.payload && message.payload.action === 'readClipboard') {
      window.postMessage({
        source: 'send-to-115-extension',
        id: message.id,
        payload: { ...bridgeMeta, ...readClipboardByPaste() },
      }, '*');
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        source: 'send-to-115-content',
        id: message.id,
        payload: message.payload || {},
      });

      window.postMessage({
        source: 'send-to-115-extension',
        id: message.id,
        payload: { ...bridgeMeta, ...(response || {}) },
      }, '*');
    } catch (error) {
      window.postMessage({
        source: 'send-to-115-extension',
        id: message.id,
        payload: {
          ...bridgeMeta,
          ok: false,
          error: error && error.message ? error.message : String(error),
        },
      }, '*');
    }
  });
})();

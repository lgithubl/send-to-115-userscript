(() => {
  const bridgeMeta = {
    extensionId: chrome.runtime.id,
    bridgeVersion: chrome.runtime.getManifest().version,
  };

  window.addEventListener('message', async (event) => {
    const message = event.data;
    if (!message || message.source !== 'send-to-115-userscript' || !message.id) return;

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

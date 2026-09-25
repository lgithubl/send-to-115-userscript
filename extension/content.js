(() => {
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
        payload: response,
      }, '*');
    } catch (error) {
      window.postMessage({
        source: 'send-to-115-extension',
        id: message.id,
        payload: {
          ok: false,
          error: error && error.message ? error.message : String(error),
        },
      }, '*');
    }
  });
})();

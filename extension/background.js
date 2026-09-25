chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.source !== 'send-to-115-content') return false;

  handleMessage(message.payload || {})
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error),
      });
    });

  return true;
});

async function handleMessage(payload) {
  if (payload.action === 'ping') {
    return {
      ok: true,
      version: chrome.runtime.getManifest().version,
    };
  }

  if (payload.action === 'chromeDownurl') {
    return chromeDownurl(payload);
  }

  return {
    ok: false,
    error: `Unknown action: ${payload.action || ''}`,
  };
}

async function chromeDownurl(payload) {
  if (!payload.url || !payload.data) {
    return {
      ok: false,
      error: 'Missing downurl url/data',
    };
  }

  const cookieNames = await getCookieNames('https://proapi.115.com/');
  const response = await fetch(payload.url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `data=${encodeURIComponent(payload.data)}`,
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      status: response.status,
      cookieNames,
      error: `115 response is not JSON: ${text.slice(0, 120)}`,
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    cookieNames,
    response: json,
  };
}

function getCookieNames(url) {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ url }, (cookies) => {
      resolve((cookies || []).map((cookie) => cookie.name).filter(Boolean));
    });
  });
}

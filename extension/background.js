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
      extensionId: chrome.runtime.id,
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

  const cookieDiagnostics = await getCookieDiagnostics();
  const attempts = [];
  const exporterResult = await exporterStyleDownurl(payload);
  attempts.push(summarizeAttempt('115exporter-background', exporterResult));
  if (exporterResult && exporterResult.ok && exporterResult.response) {
    return {
      ...exporterResult,
      source: '115exporter-background',
      cookieNames: cookieDiagnostics.cookieNames,
      cookieDiagnostics,
      attempts,
    };
  }

  const tabResult = await try115TabDownurl(payload);
  attempts.push(summarizeAttempt('115-tab', tabResult));
  if (tabResult && tabResult.ok && tabResult.response) {
    return {
      ...tabResult,
      source: '115-tab',
      cookieNames: cookieDiagnostics.cookieNames,
      cookieDiagnostics,
      attempts,
    };
  }

  const backgroundResult = await backgroundDownurl(payload);
  attempts.push(summarizeAttempt('background', backgroundResult));
  return {
    ...backgroundResult,
    source: 'background',
    cookieNames: cookieDiagnostics.cookieNames,
    cookieDiagnostics,
    attempts,
    tabError: tabResult && tabResult.error,
  };
}

async function exporterStyleDownurl(payload) {
  const response = await fetch(payload.url, {
    method: 'POST',
    credentials: 'include',
    headers: {
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
      error: `115Exporter-style response is not JSON: ${text.slice(0, 120)}`,
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    response: json,
  };
}

async function backgroundDownurl(payload) {
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
      error: `115 response is not JSON: ${text.slice(0, 120)}`,
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    response: json,
  };
}

function summarizeAttempt(source, result) {
  return {
    source,
    ok: Boolean(result && result.ok),
    status: result && result.status,
    error: result && result.error,
    state: result && result.response && result.response.state,
    errno: result && result.response && result.response.errno,
    hasData: Boolean(result && result.response && result.response.data),
  };
}

async function try115TabDownurl(payload) {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        'http://115.com/*',
        'http://*.115.com/*',
        'https://115.com/*',
        'https://*.115.com/*',
      ],
    });
    const tab = (tabs || []).find((item) => item && item.id && !String(item.url || '').includes('proapi.115.com'));
    if (!tab || !tab.id) {
      return {
        ok: false,
        error: 'No open 115 tab found. Open https://115.com/ in this Chrome profile and keep it logged in.',
      };
    }

    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: requestChromeDownurlFrom115Page,
      args: [{ url: payload.url, data: payload.data }],
    });
    const result = injected && injected[0] && injected[0].result;
    if (!result) {
      return {
        ok: false,
        error: `115 tab returned no result: ${tab.url || tab.id}`,
      };
    }
    return {
      ...result,
      tabId: tab.id,
      tabUrl: tab.url,
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error),
    };
  }
}

async function requestChromeDownurlFrom115Page(input) {
  const response = await fetch(input.url, {
    method: 'POST',
    credentials: 'include',
    mode: 'cors',
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `data=${encodeURIComponent(input.data)}`,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      status: response.status,
      error: `115 tab response is not JSON: ${text.slice(0, 120)}`,
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    response: json,
  };
}

async function getCookieDiagnostics() {
  const stores = await getCookieStores();
  const queries = [];
  const scopes = [
    { url: 'https://115.com/' },
    { url: 'https://my.115.com/' },
    { url: 'https://webapi.115.com/' },
    { url: 'https://proapi.115.com/' },
    { domain: '.115.com' },
    { domain: '115.com' },
  ];

  for (const store of stores) {
    for (const scope of scopes) {
      queries.push(store.id ? { ...scope, storeId: store.id } : { ...scope });
    }
  }

  const cookiesByKey = new Map();
  const scopeResults = [];
  for (const query of queries) {
    const cookies = await getCookies(query);
    scopeResults.push({
      query,
      cookieNames: cookies.map((cookie) => cookie.name).filter(Boolean),
      count: cookies.length,
      error: cookies.error || '',
    });
    for (const cookie of cookies) {
      if (!cookie || !cookie.name) continue;
      cookiesByKey.set(`${cookie.storeId || ''}:${cookie.domain || ''}:${cookie.path || ''}:${cookie.name}`, cookie);
    }
  }

  const cookies = Array.from(cookiesByKey.values());
  return {
    cookieNames: Array.from(new Set(cookies.map((cookie) => cookie.name).filter(Boolean))),
    count: cookies.length,
    storeIds: stores.map((store) => store.id),
    scopeResults,
  };
}

function getCookieStores() {
  return new Promise((resolve) => {
    chrome.cookies.getAllCookieStores((stores) => {
      if (chrome.runtime.lastError || !stores || !stores.length) {
        resolve([{ id: undefined }]);
        return;
      }
      resolve(stores);
    });
  });
}

function getCookies(details) {
  return new Promise((resolve) => {
    chrome.cookies.getAll(details, (cookies) => {
      if (chrome.runtime.lastError) {
        const empty = [];
        empty.error = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
        resolve(empty);
        return;
      }
      resolve(cookies || []);
    });
  });
}

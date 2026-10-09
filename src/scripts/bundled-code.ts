export const LEGACY_DELAY_FETCH_CODE = `(() => {
  const installationKey = Symbol.for('fakeheader.delayFetch');
  if (window[installationKey]) return;

  const originalFetch = window.fetch.bind(window);
  const endpoint = '/api/example';
  const delayMilliseconds = 1500;

  window.fetch = async (input, init) => {
    const requestUrl = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      location.href
    );
    if (requestUrl.origin === location.origin && requestUrl.pathname === endpoint) {
      await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
    }
    return originalFetch(input, init);
  };

  window[installationKey] = {
    restore() {
      window.fetch = originalFetch;
      delete window[installationKey];
    }
  };
})();`;

export const DELAY_HTTP_REQUESTS_CODE = `(() => {
  const installationKey = Symbol.for('fakeheader.delayHttp.v2');
  if (window[installationKey]) return;

  const delayMilliseconds = 1500;
  const pathPrefix = '';
  const sameOriginOnly = true;

  const matches = (requestUrl) => {
    if (sameOriginOnly && requestUrl.origin !== location.origin) return false;
    if (!pathPrefix) return true;
    return requestUrl.pathname === pathPrefix || requestUrl.pathname.startsWith(
      pathPrefix.endsWith('/') ? pathPrefix : pathPrefix + '/'
    );
  };
  const parseUrl = (value) => {
    try {
      return new URL(value, location.href);
    } catch {
      return null;
    }
  };
  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMilliseconds));

  const originalFetch = window.fetch;
  const delayedFetch = async function(input, init) {
    const requestUrl = parseUrl(
      typeof input === 'string' || input instanceof URL ? input : input.url
    );
    if (requestUrl && matches(requestUrl)) await wait();
    return originalFetch.call(this, input, init);
  };
  window.fetch = delayedFetch;

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const xhrMetadata = new WeakMap();
  const delayedOpen = function(method, url, async = true, ...credentials) {
    xhrMetadata.set(this, { url: parseUrl(String(url)), async: async !== false });
    return originalOpen.call(this, method, url, async, ...credentials);
  };
  const delayedSend = function(body) {
    const metadata = xhrMetadata.get(this);
    if (!metadata?.async || !metadata.url || !matches(metadata.url)) {
      return originalSend.call(this, body);
    }
    const request = this;
    setTimeout(() => originalSend.call(request, body), delayMilliseconds);
  };
  XMLHttpRequest.prototype.open = delayedOpen;
  XMLHttpRequest.prototype.send = delayedSend;

  window[installationKey] = {
    restore() {
      if (window.fetch === delayedFetch) window.fetch = originalFetch;
      if (XMLHttpRequest.prototype.open === delayedOpen) XMLHttpRequest.prototype.open = originalOpen;
      if (XMLHttpRequest.prototype.send === delayedSend) XMLHttpRequest.prototype.send = originalSend;
      delete window[installationKey];
    }
  };
})();`;

export function upgradeBundledUserScriptCode(code: string): string {
  return code === LEGACY_DELAY_FETCH_CODE ? DELAY_HTTP_REQUESTS_CODE : code;
}

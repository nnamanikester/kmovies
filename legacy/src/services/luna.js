/**
 * Minimal client for webOS Luna service calls (the same bridge webOSTV.js uses).
 *
 * @param {string} uri     e.g. "luna://com.example.service/method"
 * @param {object} params  request payload
 * @param {(response: object) => void} onResponse  called for every reply
 * @returns {() => void} cancels the call / subscription
 */
export function callService(uri, params, onResponse) {
  if (typeof window.PalmServiceBridge !== 'function') {
    throw new Error('Luna services are only available on webOS');
  }

  const bridge = new window.PalmServiceBridge();
  bridge.onservicecallback = (message) => {
    let response;
    try {
      response = JSON.parse(message);
    } catch (e) {
      response = { returnValue: false, errorText: `Invalid response: ${message}` };
    }
    onResponse(response);
  };
  bridge.call(uri, JSON.stringify(params));

  return () => bridge.cancel();
}

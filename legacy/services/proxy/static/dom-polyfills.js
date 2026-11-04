/* DOM APIs newer than Chrome 68 that core-js does not cover, plus compatibility shims. Appended to the polyfill bundle. */
(function () {
  /*
   * Nuxt syncs cookies across tabs with the CookieStore API (Chrome 87+). On
   * older engines it falls back to BroadcastChannel, where an empty cookie is
   * broadcast as "undefined" and crashes every listening frame (JSON.parse),
   * ping-ponging between frames. A TV app has one window, so cross-tab sync is
   * useless: refuse those channels (Nuxt catches this and skips syncing).
   */
  /*
   * The site runs in a frame inside the TV app, which Chrome 68 treats as a
   * third-party context: cookies written with SameSite (or Secure, over http)
   * are silently dropped, losing the site's login token. Strip those attributes.
   */
  var cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (cookieDesc && cookieDesc.set) {
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      enumerable: cookieDesc.enumerable,
      get: cookieDesc.get,
      set: function (value) {
        cookieDesc.set.call(this, String(value).replace(/;\s*(SameSite=[^;]*|Secure)(?=;|$)/gi, ''));
      },
    });
  }

  /*
   * Sites start players muted because desktop browsers block autoplay with
   * sound. TV apps have no such restriction, and finding the mute button with a
   * remote is awkward, so unmute each video the first time it starts playing.
   * Only once per source: if the viewer mutes it afterwards, it stays muted.
   */
  document.addEventListener(
    'playing',
    function (event) {
      var media = event.target;
      if (!media || media.tagName !== 'VIDEO') return;
      var source = media.currentSrc || media.src || 'unknown';
      if (media.__kmoviesUnmutedFor === source) return;
      media.__kmoviesUnmutedFor = source;
      if (media.muted) media.muted = false;
      if (media.volume === 0) media.volume = 1;
    },
    true
  );

  if (window.BroadcastChannel) {
    var NativeBroadcastChannel = window.BroadcastChannel;
    var PatchedBroadcastChannel = function BroadcastChannel(name) {
      if (/^nuxt:cookies:/.test(String(name))) throw new Error('BroadcastChannel disabled for ' + name);
      return new NativeBroadcastChannel(name);
    };
    PatchedBroadcastChannel.prototype = NativeBroadcastChannel.prototype;
    window.BroadcastChannel = PatchedBroadcastChannel;
  }

  var EP = Element.prototype;
  var DP = Document.prototype;
  var FP = DocumentFragment.prototype;

  function toNodes(args) {
    var frag = document.createDocumentFragment();
    Array.prototype.forEach.call(args, function (n) {
      frag.appendChild(n instanceof Node ? n : document.createTextNode(String(n)));
    });
    return frag;
  }

  [EP, DP, FP].forEach(function (proto) {
    if (!proto.replaceChildren) {
      proto.replaceChildren = function () {
        while (this.lastChild) this.removeChild(this.lastChild);
        this.appendChild(toNodes(arguments));
      };
    }
  });

  if (!EP.toggleAttribute) {
    EP.toggleAttribute = function (name, force) {
      var on = force === undefined ? !this.hasAttribute(name) : !!force;
      if (on) this.setAttribute(name, '');
      else this.removeAttribute(name);
      return on;
    };
  }

  if (!window.requestIdleCallback) {
    window.requestIdleCallback = function (cb) {
      var start = Date.now();
      return setTimeout(function () {
        cb({ didTimeout: false, timeRemaining: function () { return Math.max(0, 50 - (Date.now() - start)); } });
      }, 1);
    };
    window.cancelIdleCallback = clearTimeout;
  }
})();

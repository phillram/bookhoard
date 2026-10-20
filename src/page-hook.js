// Runs in Libby's own page (not in bookhoard's separate content-script world), from the start.
// Only while bookhoard is opening books in Media Do's reader (it sets data-bookhoard-capture on
// <html>), Libby's window.open of a Media Do reader address goes to bookhoard instead, which opens
// the tab itself: a button pressed by a script may not open tabs, and Libby would then send its
// own tab to the reader. Everything else, and at any other time, window.open is untouched.
(() => {
  const open = window.open;
  const reader = url => {
    try {
      const u = new URL(url, location.href);
      return u.protocol === 'https:' && /(^|\.)mediadotech\.com$/.test(u.hostname);
    } catch {
      return false;
    }
  };
  window.open = function (url, ...rest) {
    if (document.documentElement.dataset.bookhoardCapture === '1' && reader(url)) {
      window.postMessage({ bookhoard: 'reader', url: String(url) }, location.origin);
      return { closed: false, focus() {}, close() {}, blur() {} };  // Libby only checks it opened
    }
    return open.call(this, url, ...rest);
  };
  document.documentElement.dataset.bookhoardHook = '1';
})();

// Runs in Libby's own page (not in bookhoard's separate content-script world), from the start.
// Only while bookhoard is opening books in their online reader (it sets data-bookhoard-capture on
// <html>), Libby's window.open goes to bookhoard instead, which opens the tab itself: a button
// pressed by a script may not open tabs, and Libby would then send its own tab to the reader. The
// reader's address comes from Libby's server and may first go through another site, so any https
// address counts. At any other time window.open is untouched.
(() => {
  const open = window.open;
  window.open = function (url, ...rest) {
    if (document.documentElement.dataset.bookhoardCapture === '1') {
      let u = null;
      try { u = new URL(url, location.href); } catch {}
      if (u?.protocol === 'https:') {
        window.postMessage({ bookhoard: 'reader', url: u.href }, location.origin);
        return { closed: false, focus() {}, close() {}, blur() {} };  // Libby only checks it opened
      }
    }
    return open.call(this, url, ...rest);
  };
  document.documentElement.dataset.bookhoardHook = '1';
})();

// Applied before the stylesheet paints so a dark-mode user never sees a white flash.
(function () {
  var saved = localStorage.getItem('maintainiq.theme');
  var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();

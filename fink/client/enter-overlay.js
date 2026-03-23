// Click-to-enter: dismisses overlay and signals ready to connect.
// The module script (infra-demo-modes.js) waits for this before connecting.
document.getElementById('enterOverlay').addEventListener('click', function() {
  this.classList.add('hidden');
  window.__enterClicked = true;
  window.dispatchEvent(new Event('fink-enter'));
  var el = this;
  setTimeout(function() { el.remove(); }, 500);
});

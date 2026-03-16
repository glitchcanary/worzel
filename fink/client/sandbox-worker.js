// sandbox-worker.js — runs inside the sandboxed iframe
// Defines the oooOO tagged template function and executes .fink.js content
// sent from the parent via postMessage.

window.finkData = [];

function oooOO(strings) {
  var result = strings[0];
  for (var i = 1; i < arguments.length; i++) {
    result += String(arguments[i]) + strings[i];
  }
  window.finkData.push(result);
}

window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'exec-finkjs') {
    try {
      (new Function(e.data.code))();
      parent.postMessage({
        type: 'fink-loaded',
        data: window.finkData[0] || null
      }, '*');
    } catch (err) {
      parent.postMessage({
        type: 'fink-error',
        error: err.message
      }, '*');
    }
  }
});

parent.postMessage({ type: 'sandbox-ready' }, '*');

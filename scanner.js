// Caméra et lecture des codes-barres. Ne connaît ni le catalogue ni l'interface : il prévient quand il lit un code.
// Utilise le lecteur intégré à Chrome (BarcodeDetector), qui marche hors ligne.
(function () {
  'use strict';

  var FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128'];
  var INTERVAL_MS = 200;

  var ERRORS = {
    NotAllowedError: 'Caméra refusée : autorise l’appareil photo pour ce site (Chrome → ⋮ → Paramètres → Paramètres des sites).',
    NotFoundError: 'Aucune caméra trouvée.',
    NotReadableError: 'La caméra est utilisée par une autre application.',
    OverconstrainedError: 'Caméra arrière introuvable.'
  };

  function supported() {
    return !!(window.BarcodeDetector && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // create(onCode, onError) → { start(video), stop(), running() }
  //   onCode(texte) est appelé à chaque lecture (le même code revient tant qu'il reste devant la caméra).
  function create(onCode, onError) {
    var stream = null;
    var timer = null;
    var detector = null;
    var video = null;
    var token = 0;   // invalide un démarrage encore en cours si stop() ou un autre start() arrive entre-temps
    var busy = false;

    function stop() {
      token++;
      if (timer) clearInterval(timer);
      timer = null;
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
      if (video) video.srcObject = null;
      video = null;
    }

    function scanOnce() {
      if (busy || !video || video.readyState < 2) return;
      busy = true;
      detector.detect(video).then(function (found) {
        busy = false;
        if (timer && found.length) onCode(found[0].rawValue);
      }, function () { busy = false; });
    }

    function start(videoEl) {
      stop();
      var mine = token;
      if (!supported()) {
        onError('Le scan n’est pas disponible sur ce navigateur. Utilise Chrome sur Android.');
        return Promise.resolve(false);
      }
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        .then(function (s) {
          if (mine !== token) { s.getTracks().forEach(function (t) { t.stop(); }); return false; }
          stream = s;
          video = videoEl;
          video.srcObject = s;
          var play = video.play && video.play();
          if (play && play.catch) play.catch(function () { /* lecture refusée : l'image reste figée */ });
          detector = new window.BarcodeDetector({ formats: FORMATS });
          timer = setInterval(scanOnce, INTERVAL_MS);
          return true;
        }, function (e) {
          if (mine === token) onError(ERRORS[e && e.name] || 'Caméra indisponible : ' + (e && e.name || 'erreur'));
          return false;
        });
    }

    return { start: start, stop: stop, running: function () { return !!timer; } };
  }

  window.ReassortScanner = { supported: supported, create: create };
})();

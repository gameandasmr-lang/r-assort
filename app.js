// Interface : onglets, micro, voix, liste. La compréhension des phrases est dans logic.js.
(function () {
  'use strict';

  var R = window.Reassort;
  var STORAGE_KEY = 'reassort.v1';
  var TAB_KEY = 'reassort.tab';
  var CUSTOM_KEY = 'reassort.catalogue-perso';
  var TEST_KEY = 'reassort.test-codes';
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var MIC_ERRORS = {
    'not-allowed': 'Micro refusé : autorise le micro pour ce site dans Chrome.',
    'service-not-allowed': 'Micro refusé : autorise le micro pour ce site dans Chrome.',
    'no-speech': 'Je n’ai rien entendu. Réessaie.',
    'audio-capture': 'Aucun micro trouvé.',
    'network': 'Pas de réseau pour la reconnaissance vocale.'
  };

  var state = load(STORAGE_KEY, { entries: [], nextId: 1 });
  var custom = load(CUSTOM_KEY, []);
  var testStats = load(TEST_KEY, { tries: 0, ok: 0, misses: [] });
  var catalog = buildCatalog();
  var undoStack = [];
  var recognition = null;
  var answerId = null;
  var lastPointageId = null;
  var pending = null;      // pointage en attente d'un choix : { parsed, text }
  var testCode = null;

  function $(id) { return document.getElementById(id); }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // --- Données -------------------------------------------------------------

  function load(key, fallback) {
    try {
      var saved = JSON.parse(localStorage.getItem(key));
      if (saved && typeof saved === 'object') return saved;
    } catch (e) { /* stockage indisponible : on repart de zéro */ }
    return fallback;
  }

  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignoré */ }
  }

  function save() { store(STORAGE_KEY, state); }

  function buildCatalog() {
    return R.createCatalog((window.CATALOG || []).concat(custom));
  }

  // Un article renommé à la main est retenu pour les prochaines fois.
  function remember(code, name) {
    if (!code || !name) return;
    custom = custom.filter(function (row) { return row[0] !== code; }).concat([[code, name]]);
    store(CUSTOM_KEY, custom);
    catalog = buildCatalog();
  }

  function snapshot() {
    undoStack.push(JSON.stringify(state.entries));
    if (undoStack.length > 30) undoStack.shift();
  }

  function undo() {
    if (!undoStack.length) return false;
    state.entries = JSON.parse(undoStack.pop());
    commit();
    return true;
  }

  function commit() {
    save();
    renderList();
    renderPointage();
    renderAnswer(false);
    renderSearch();
    PAD_MODES.forEach(renderPad);
  }

  function findEntry(id) {
    for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === id) return state.entries[i];
    return null;
  }

  // --- Voix ----------------------------------------------------------------

  function frenchVoice() {
    if (!window.speechSynthesis) return null;
    var voices = speechSynthesis.getVoices();
    for (var i = 0; i < voices.length; i++) if (/^fr/i.test(voices[i].lang)) return voices[i];
    return null;
  }

  function speak(text) {
    if (!window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      var utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      var voice = frenchVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = 1.05;
      speechSynthesis.speak(utterance);
    } catch (e) { /* pas de synthèse vocale */ }
  }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignoré */ }
  }

  function setStatus(mode, text, isError) {
    var el = $('status-' + mode);
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  function setListening(mode, on) {
    document.querySelectorAll('[data-mic="' + mode + '"]').forEach(function (b) {
      b.classList.toggle('listening', on);
    });
  }

  function toggleListening(mode) {
    if (recognition) { recognition.stop(); return; }
    if (!SpeechRecognition) {
      setStatus(mode, 'La reconnaissance vocale n’est pas disponible ici. Ouvre l’app dans Chrome.', true);
      return;
    }
    if (window.speechSynthesis) speechSynthesis.cancel();

    var rec = new SpeechRecognition();
    rec.lang = 'fr-FR';
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.continuous = false;
    var alternatives = null;

    rec.onresult = function (event) {
      var result = event.results[event.results.length - 1];
      setStatus(mode, '« ' + result[0].transcript + ' »');
      if (result.isFinal) {
        alternatives = Array.prototype.map.call(result, function (a) { return a.transcript; });
      }
    };
    rec.onerror = function (event) {
      alternatives = null;
      if (event.error !== 'aborted') setStatus(mode, MIC_ERRORS[event.error] || 'Erreur micro : ' + event.error, true);
    };
    rec.onend = function () {
      recognition = null;
      setListening(mode, false);
      if (alternatives) handle(mode, alternatives);
    };

    recognition = rec;
    setListening(mode, true);
    setStatus(mode, 'Je t’écoute…');
    vibrate(20);
    try {
      rec.start();
    } catch (e) {
      recognition = null;
      setListening(mode, false);
      setStatus(mode, 'Impossible de démarrer le micro.', true);
    }
  }

  function handle(mode, alternatives) {
    if (mode === 'pointage') handlePointage(alternatives);
    else if (mode === 'deballage') handleQuestion(alternatives);
    else handleTest(alternatives);
  }

  // --- Affichage d'un article ----------------------------------------------

  function articleHtml(article) {
    var code = article.code ? '<span class="code">' + escapeHtml(article.code) + '</span>' : '';
    var name = article.name ? escapeHtml(article.name) : (article.code ? '<em>Article inconnu</em>' : '');
    return code + '<span class="article-name">' + name + '</span>';
  }

  // --- Pointage --------------------------------------------------------------

  function handlePointage(alternatives) {
    var best = R.bestPointage(alternatives, catalog);
    var parsed = best.parsed;
    var text = best.text;

    if (parsed.action === 'undo') {
      var undone = undo();
      setStatus('pointage', undone ? 'Dernière action annulée.' : 'Rien à annuler.');
      speak(undone ? 'Annulé.' : 'Rien à annuler.');
      return;
    }
    if (parsed.action === 'unknown') {
      setStatus('pointage', 'Pas compris : « ' + text + ' »', true);
      speak('Je n’ai pas compris.');
      return;
    }

    applyParsed(parsed, text);
  }

  function applyParsed(parsed, text) {
    var target = parsed.target;
    if (target.kind === 'item') {
      applyPointage({ code: target.item.code, name: target.item.name }, parsed, text);
    } else if (target.kind === 'free') {
      applyPointage({ code: null, name: target.name }, parsed, text);
    } else {
      pending = { parsed: parsed, text: text };
      lastPointageId = null;
      setStatus('pointage', '« ' + text + ' »');
      renderPointage();
      if (target.kind === 'choose') speak(target.candidates.length + ' articles possibles. Choisis à l’écran.');
      else speak('Code ' + R.spokenCode(target.code) + ' inconnu. Vérifie à l’écran.');
      vibrate([30, 40, 30]);
    }
  }

  function applyPointage(article, parsed, text) {
    snapshot();
    var entry = R.findSameArticle(article, state.entries);
    var updated = !!entry;
    if (!entry) {
      entry = { id: state.nextId++, code: article.code, name: article.name, qty: 0, out: true, done: 0 };
      state.entries.unshift(entry);
    } else if (article.name && article.code) {
      entry.name = article.name;
    }
    entry.qty = parsed.qty;
    entry.out = parsed.out;
    entry.done = Math.min(entry.done || 0, entry.qty);
    lastPointageId = entry.id;
    pending = null;
    commit();

    var note = parsed.qtyGuessed ? ' (pas de quantité dite : 1 carton)' : '';
    setStatus('pointage', '« ' + text + ' »' + (updated ? ' — mis à jour' : '') + note);
    speak(R.spokenLabel(entry) + ', ' + (entry.out ? R.formatQty(entry.qty) : 'on ne sort pas') + (updated ? ', mis à jour.' : '.'));
    vibrate(40);
  }

  function choiceButton(item) {
    return '<button type="button" class="choice" data-action="choose" data-code="' + escapeHtml(item.code) + '">' +
      articleHtml(item) + '</button>';
  }

  function renderPointage() {
    var box = $('pointage-result');
    if (pending) {
      var t = pending.parsed.target;
      var qty = pending.parsed.out ? R.formatQty(pending.parsed.qty) : 'on ne sort pas';
      var html;
      if (t.kind === 'choose') {
        html = '<div class="pick-title">Lequel ? <small>(' + escapeHtml(qty) + ')</small></div>' +
          t.candidates.map(choiceButton).join('') +
          '<button type="button" class="choice secondary" data-action="keep">Aucun : garder « ' + escapeHtml(t.name) + ' »</button>';
      } else {
        html = '<div class="pick-title">Code <span class="code">' + escapeHtml(t.code) + '</span> inconnu <small>(' + escapeHtml(qty) + ')</small></div>' +
          (t.suggestions.length ? '<div class="pick-sub">Tu voulais dire :</div>' + t.suggestions.map(choiceButton).join('') : '') +
          '<button type="button" class="choice secondary" data-action="keep">Garder le code ' + escapeHtml(t.code) + '</button>';
      }
      html += '<button type="button" class="choice secondary" data-action="cancel-pick">Annuler</button>';
      box.className = 'pick';
      box.innerHTML = html;
      return;
    }
    var entry = lastPointageId && findEntry(lastPointageId);
    box.className = '';
    box.innerHTML = entry ? '<ul class="entries big">' + entryRow(entry) + '</ul>' : '';
  }

  function resolvePending(item) {
    var parsed = pending.parsed;
    var t = parsed.target;
    var article = item
      ? { code: item.code, name: item.name }
      : (t.kind === 'choose' ? { code: null, name: t.name } : { code: t.code, name: '' });
    applyPointage(article, parsed, pending.text);
  }

  // --- Déballage -------------------------------------------------------------

  function handleQuestion(alternatives) {
    var best = R.bestQuestion(alternatives, state.entries, catalog);
    showResolution(best.result, best.text);
  }

  function showResolution(result, query) {
    var box = $('answer');
    answerId = null;
    if (result.kind === 'match') {
      showAnswer(result.entry, true);
      return;
    }
    box.hidden = false;
    if (result.kind === 'ambiguous') {
      box.className = 'answer ambiguous';
      box.innerHTML = '<div class="answer-name">Lequel ?</div><div class="choices">' +
        result.candidates.map(function (e) {
          return '<button type="button" class="choice" data-action="pick" data-id="' + e.id + '">' + articleHtml(e) + '</button>';
        }).join('') + '</div>';
      speak(result.candidates.length + ' articles pointés possibles. Choisis à l’écran.');
      vibrate([30, 40, 30]);
      return;
    }

    var article = result.item || (result.code ? { code: result.code, name: '' } : null);
    box.className = 'answer none';
    box.innerHTML = '<div class="answer-big">PAS NOTÉ</div>' +
      (article ? '<div class="answer-name">' + articleHtml(article) + '</div>' : '<div class="answer-name">« ' + escapeHtml(query) + ' »</div>') +
      '<div class="answer-detail">Pas dans ton pointage. Vérifie sur la tablette.</div>' +
      (result.near.length
        ? '<div class="answer-detail">Tu voulais dire :</div><div class="choices">' + result.near.map(function (e) {
          return '<button type="button" class="choice" data-action="pick" data-id="' + e.id + '">' + articleHtml(e) + '</button>';
        }).join('') + '</div>'
        : '');
    speak((result.item ? result.item.name + ' : pas noté.' : 'Pas noté.') + ' Vérifie sur la tablette.');
    vibrate([80, 60, 80]);
  }

  function showAnswer(entry, withVoice) {
    answerId = entry.id;
    renderAnswer(withVoice);
  }

  function renderAnswer(withVoice) {
    var box = $('answer');
    var entry = answerId && findEntry(answerId);
    if (!entry) {
      if (answerId) { box.hidden = true; answerId = null; }
      return;
    }
    var a = R.answer(entry);
    box.hidden = false;
    box.className = 'answer ' + (a.yes ? 'yes' : 'no');
    var buttons = '';
    if (a.yes && (entry.done || 0) < entry.qty) {
      buttons = '<div class="choices">' +
        '<button type="button" data-action="unpack" data-amount="1" data-id="' + entry.id + '">Déballé +1</button>' +
        '<button type="button" data-action="unpack" data-amount="0.5" data-id="' + entry.id + '">Déballé +½</button>' +
        '</div>';
    }
    box.innerHTML = '<div class="answer-big">' + a.short + '</div>' +
      '<div class="answer-name">' + articleHtml(entry) + '</div>' +
      '<div class="answer-detail">' + escapeHtml(a.detail) + '</div>' + buttons;
    if (withVoice) {
      speak(a.speech);
      vibrate(a.yes ? 60 : [80, 60, 80]);
    }
  }

  function renderSearch() {
    var input = $('form-deballage').querySelector('input');
    var query = input.value.trim();
    var list = $('search-results');
    if (!query) { list.innerHTML = ''; return; }
    var found = /^\d+$/.test(query)
      ? state.entries.filter(function (e) { return e.code && e.code.indexOf(query) !== -1; })
      : R.findMatches(query, state.entries).map(function (r) { return r.entry; });
    list.innerHTML = found.length
      ? found.slice(0, 8).map(function (e) {
        return '<li><button type="button" class="choice" data-action="pick" data-id="' + e.id + '">' + articleHtml(e) + '</button></li>';
      }).join('')
      : '<li class="empty">Aucun article pointé ne correspond.</li>';
  }

  // --- Liste -----------------------------------------------------------------

  function shortQty(qty) {
    var whole = Math.floor(qty);
    var half = qty - whole >= 0.5;
    if (!half) return String(whole);
    return whole ? whole + '½' : '½';
  }

  function entryRow(entry) {
    var done = entry.done || 0;
    var complete = entry.out && entry.qty > 0 && done >= entry.qty;
    var sub = entry.out && entry.qty ? R.formatQty(entry.qty) : 'Ne sort pas';
    if (done) sub += ' · déballé ' + R.formatQty(done);
    var cls = 'entry' + (!entry.out || !entry.qty ? ' off' : '') + (complete ? ' complete' : '');
    return '<li class="' + cls + '" data-id="' + entry.id + '">' +
      '<div class="entry-main" data-action="rename"><div class="entry-name">' + articleHtml(entry) + '</div>' +
      '<div class="entry-sub">' + escapeHtml(sub) + '</div></div>' +
      '<div class="stepper"><button type="button" data-action="minus" aria-label="Moins un demi">−</button>' +
      '<span>' + shortQty(entry.out ? entry.qty : 0) + '</span>' +
      '<button type="button" data-action="plus" aria-label="Plus un demi">+</button></div>' +
      '<button type="button" class="icon" data-action="delete" aria-label="Supprimer">×</button>' +
      '</li>';
  }

  function renderList() {
    var entries = state.entries;
    var out = entries.filter(function (e) { return e.out && e.qty > 0; });
    var cartons = out.reduce(function (sum, e) { return sum + e.qty; }, 0);
    var unpacked = out.reduce(function (sum, e) { return sum + Math.min(e.done || 0, e.qty); }, 0);
    $('count').textContent = entries.length || '';
    $('summary').textContent = entries.length
      ? entries.length + ' article(s) pointé(s) · ' + out.length + ' à sortir (' + shortQty(cartons) + ' cartons) · déballé ' + shortQty(unpacked) + ' / ' + shortQty(cartons)
      : '';
    $('list').innerHTML = entries.length
      ? entries.map(entryRow).join('')
      : '<li class="empty">Rien de pointé pour l’instant.</li>';
  }

  function changeQty(entry, delta) {
    var qty = entry.out ? entry.qty : 0;
    qty = Math.max(0, qty + delta);
    entry.qty = qty;
    entry.out = qty > 0;
    entry.done = Math.min(entry.done || 0, qty);
  }

  function rename(entry) {
    var code = window.prompt('Code article (laisser vide si inconnu)', entry.code || '');
    if (code === null) return false;
    code = code.replace(/\D/g, '') || null;
    var known = code && catalog.byCode[code];
    var name = window.prompt('Nom de l’article', known && code !== entry.code ? known.name : (entry.name || ''));
    if (name === null) return false;
    name = name.trim();
    if (!name && !code) return false;
    entry.code = code;
    entry.name = name;
    remember(code, name);
    return true;
  }

  // --- Test des codes --------------------------------------------------------

  function newTestCode() {
    var items = catalog.items;
    testCode = items[Math.floor(Math.random() * items.length)].code;
    renderTest();
    setStatus('test', 'Appuie sur le micro et lis le code comme tu le lirais sur un carton.');
  }

  function handleTest(alternatives) {
    var best = R.bestPointage(alternatives, catalog);
    var t = best.parsed.target;
    var heard = t && t.kind === 'item' ? t.item.code : (t && t.kind === 'unknownCode' ? t.code : null);
    var ok = heard === testCode;
    testStats.tries++;
    if (ok) testStats.ok++;
    else testStats.misses = [{ expected: testCode, heard: alternatives.join(' | ') }].concat(testStats.misses).slice(0, 20);
    store(TEST_KEY, testStats);
    setStatus('test', (ok ? '✓ Bon : ' : '✗ Raté. Compris : ' + (heard || 'aucun code') + ' — ') + '« ' + alternatives[0] + ' »', !ok);
    speak(ok ? 'Bon.' : 'Raté.');
    vibrate(ok ? 40 : [80, 60, 80]);
    if (ok) {
      newTestCode();
      setStatus('test', '✓ Bon. Code suivant.');
    } else {
      renderTest();
    }
  }

  function renderTest() {
    var item = testCode && catalog.byCode[testCode];
    $('test-target').innerHTML = item ? articleHtml(item) : '';
    var rate = testStats.tries ? Math.round(100 * testStats.ok / testStats.tries) : 0;
    $('test-score').textContent = testStats.tries
      ? testStats.ok + ' / ' + testStats.tries + ' codes bien compris (' + rate + ' %)'
      : 'Aucun essai pour l’instant.';
    $('test-misses').innerHTML = testStats.misses.map(function (m) {
      return '<li><span class="code">' + escapeHtml(m.expected) + '</span> entendu : « ' + escapeHtml(m.heard) + ' »</li>';
    }).join('');
  }

  // --- Pavé numérique --------------------------------------------------------

  var INPUT_KEY = 'reassort.saisie';
  var PAD_MODES = ['pointage', 'deballage'];
  var PAD_QTY = [['½', 0.5], ['1', 1], ['1½', 1.5], ['2', 2], ['3', 3], ['4', 4], ['5', 5]];
  var padDigits = { pointage: '', deballage: '' };
  var inputModes = load(INPUT_KEY, {});

  function buildPad(mode) {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
    var labels = { clear: 'C', back: '⌫' };
    var html = '<div class="pad-display"><div class="pad-digits" id="pad-digits-' + mode + '"></div>' +
      '<div class="pad-preview" id="pad-preview-' + mode + '"></div></div>' +
      '<div class="pad-keys">' + keys.map(function (k) {
        return '<button type="button" class="pad-key" data-action="pad-key" data-mode="' + mode + '" data-key="' + k + '">' + (labels[k] || k) + '</button>';
      }).join('') + '</div>';
    if (mode === 'pointage') {
      html += '<div class="pad-label">Combien de cartons ?</div><div class="pad-qty">' +
        PAD_QTY.map(function (q) {
          return '<button type="button" data-action="pad-qty" data-qty="' + q[1] + '">' + q[0] + '</button>';
        }).join('') +
        '<button type="button" class="pad-no" data-action="pad-qty" data-qty="0">Ne sort pas</button></div>';
    } else {
      html += '<button type="button" class="pad-ok" data-action="pad-ask">Demander</button>';
    }
    return html;
  }

  function entryWithCode(code) {
    for (var i = 0; i < state.entries.length; i++) if (state.entries[i].code === code) return state.entries[i];
    return null;
  }

  function renderPad(mode) {
    var digits = padDigits[mode];
    $('pad-digits-' + mode).textContent = digits || ' ';
    var preview = '';
    if (digits.length >= 4) {
      var item = catalog.byCode[digits];
      var entry = entryWithCode(digits);
      if (item || entry) {
        preview = escapeHtml((entry && entry.name) || item.name);
        if (mode === 'pointage' && entry) {
          preview += '<small>Déjà pointé : ' + escapeHtml(entry.out ? R.formatQty(entry.qty) : 'ne sort pas') + '</small>';
        }
      } else if (digits.length >= 5) {
        preview = '<em>Code inconnu</em>';
      }
    }
    $('pad-preview-' + mode).innerHTML = preview;
    document.querySelectorAll('#view-' + mode + ' [data-action="pad-qty"], #view-' + mode + ' [data-action="pad-ask"]')
      .forEach(function (b) { b.disabled = digits.length < 4; });
  }

  // Au déballage, 5 chiffres suffisent : on répond tout de suite (sauf si un code à 6 chiffres commence pareil).
  function longerCodeExists(digits) {
    return Object.keys(catalog.byCode).some(function (c) { return c.length > digits.length && c.indexOf(digits) === 0; });
  }

  function padKey(mode, key) {
    var digits = padDigits[mode];
    if (key === 'back') digits = digits.slice(0, -1);
    else if (key === 'clear') digits = '';
    else if (digits.length < 6) digits += key;
    padDigits[mode] = digits;
    if (mode === 'pointage') scannedCode = null;
    renderPad(mode);
    vibrate(10);
    if (mode === 'deballage' && digits.length >= 5 && !longerCodeExists(digits)) padAsk();
  }

  function padAsk() {
    var code = padDigits.deballage;
    if (code.length < 4) return;
    padDigits.deballage = '';
    renderPad('deballage');
    setStatus('deballage', 'Code ' + code);
    handleQuestion([code]);
  }

  function padPoint(qty) {
    var code = padDigits.pointage;
    if (code.length < 4) return;
    var item = catalog.byCode[code];
    var parsed = { action: 'set', qty: qty, out: qty > 0, qtyGuessed: false };
    var text = code + ' — ' + (qty ? R.formatQty(qty) : 'ne sort pas');
    if (!item && code === scannedCode) {
      // Un code-barres valide n'est pas une faute de frappe : pas de confirmation, l'article est noté tel quel.
      padDigits.pointage = '';
      scannedCode = null;
      renderPad('pointage');
      applyPointage({ code: code, name: '' }, parsed, text);
      return;
    }
    parsed.target = item
      ? { kind: 'item', item: item }
      : {
        kind: 'unknownCode',
        code: code,
        suggestions: R.nearCodes(code, Object.keys(catalog.byCode)).slice(0, 6).map(function (c) { return catalog.byCode[c]; })
      };
    padDigits.pointage = '';
    renderPad('pointage');
    applyParsed(parsed, text);
  }

  function applyInputModes() {
    PAD_MODES.forEach(function (mode) {
      var chosen = inputModes[mode] || 'voice';
      $('view-' + mode).classList.toggle('pad-mode', chosen === 'pad');
      $('view-' + mode).classList.toggle('scan-mode', chosen === 'scan');
      document.querySelectorAll('#view-' + mode + ' [data-input]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.input === chosen);
      });
    });
    syncCamera();
  }

  // --- Scan du code-barres ---------------------------------------------------

  var SCAN_REPEAT_MS = 3000;   // le même code-barres devant la caméra n'est pas relu avant ce délai
  var scanner = window.ReassortScanner && window.ReassortScanner.create(onBarcode, onScanError);
  var scanMode = null;         // écran qui utilise la caméra en ce moment
  var lastScan = { raw: null, at: 0 };
  var scannedCode = null;      // code du pointage venu d'un code-barres (fiable, contrairement à un code tapé ou dicté)

  function currentTab() {
    var active = document.querySelector('.tab.active');
    return active ? active.dataset.tab : null;
  }

  // La caméra ne tourne que si un écran en mode scan est affiché et que l'app est visible.
  function syncCamera() {
    if (!scanner) return;
    var tab = currentTab();
    var want = document.visibilityState !== 'hidden' && PAD_MODES.indexOf(tab) >= 0 && inputModes[tab] === 'scan' ? tab : null;
    if (want === scanMode) return;
    scanMode = want;
    lastScan = { raw: null, at: 0 };
    if (!want) { scanner.stop(); return; }
    setStatus(want, 'Je démarre la caméra…');
    scanner.start($('scan-video-' + want)).then(function (ok) {
      if (ok && scanMode === want) setStatus(want, want === 'pointage' ? 'Présente le code-barres, puis choisis la quantité.' : 'Présente le code-barres du carton.');
    });
  }

  function onScanError(message) {
    if (scanMode) setStatus(scanMode, message, true);
    scanMode = null;
  }

  function onBarcode(raw) {
    var mode = scanMode;
    var now = Date.now();
    if (!mode || (raw === lastScan.raw && now - lastScan.at < SCAN_REPEAT_MS)) return;
    lastScan = { raw: raw, at: now };

    var found = R.codeFromBarcode(raw, catalog);
    if (!found) {
      setStatus(mode, 'Code-barres non reconnu : ' + raw, true);
      speak('Code-barres non reconnu.');
      vibrate([80, 60, 80]);
      return;
    }
    if (mode === 'deballage') {
      setStatus(mode, 'Code-barres → ' + found.code);
      handleQuestion([found.code]);
    } else {
      padDigits.pointage = found.code;
      scannedCode = found.code;
      renderPad('pointage');
      setStatus(mode, found.item ? found.item.name : 'Code ' + found.code + ' absent du catalogue');
      speak(found.item ? found.item.name : 'Code ' + R.spokenCode(found.code) + ' inconnu.');
      vibrate(40);
    }
  }

  // Sur PC : les touches du clavier alimentent le pavé.
  document.addEventListener('keydown', function (event) {
    if (event.target.closest && event.target.closest('input')) return;
    var view = document.querySelector('.view.active.pad-mode');
    if (!view) return;
    var mode = view.id.replace('view-', '');
    if (/^\d$/.test(event.key)) padKey(mode, event.key);
    else if (event.key === 'Backspace') padKey(mode, 'back');
    else if (event.key === 'Enter' && mode === 'deballage') padAsk();
    else return;
    event.preventDefault();
  });

  // --- Événements ------------------------------------------------------------

  function selectTab(tab) {
    if (!$('view-' + tab)) tab = 'pointage';
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + tab); });
    if (tab === 'test' && !testCode) newTestCode();
    try { localStorage.setItem(TAB_KEY, tab); } catch (e) { /* ignoré */ }
    syncCamera();
  }

  document.addEventListener('click', function (event) {
    var tab = event.target.closest('[data-tab]');
    if (tab) { selectTab(tab.dataset.tab); return; }

    var mic = event.target.closest('[data-mic]');
    if (mic) { toggleListening(mic.dataset.mic); return; }

    var input = event.target.closest('[data-input]');
    if (input) {
      inputModes[input.closest('.view').id.replace('view-', '')] = input.dataset.input;
      store(INPUT_KEY, inputModes);
      applyInputModes();
      return;
    }

    var actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.dataset.action;

    switch (action) {
      case 'choose':
        if (pending) resolvePending(catalog.byCode[actionEl.dataset.code]);
        return;
      case 'keep':
        if (pending) resolvePending(null);
        return;
      case 'cancel-pick':
        pending = null;
        renderPointage();
        setStatus('pointage', 'Annulé.');
        return;
      case 'test-next':
        newTestCode();
        return;
      case 'pad-key':
        padKey(actionEl.dataset.mode, actionEl.dataset.key);
        return;
      case 'pad-qty':
        padPoint(Number(actionEl.dataset.qty));
        return;
      case 'pad-ask':
        padAsk();
        return;
      case 'test-reset':
        testStats = { tries: 0, ok: 0, misses: [] };
        store(TEST_KEY, testStats);
        renderTest();
        return;
    }

    var holder = actionEl.closest('[data-id]');
    var entry = holder && findEntry(Number(holder.dataset.id));
    if (!entry) return;

    switch (action) {
      case 'pick':
        showAnswer(entry, true);
        return;
      case 'unpack':
        snapshot();
        entry.done = Math.min(entry.qty, (entry.done || 0) + Number(actionEl.dataset.amount));
        vibrate(30);
        break;
      case 'minus':
        snapshot();
        changeQty(entry, -0.5);
        break;
      case 'plus':
        snapshot();
        changeQty(entry, 0.5);
        break;
      case 'delete':
        snapshot();
        state.entries = state.entries.filter(function (e) { return e !== entry; });
        break;
      case 'rename':
        snapshot();
        if (!rename(entry)) { undoStack.pop(); return; }
        break;
      default:
        return;
    }
    commit();
  });

  $('form-pointage').addEventListener('submit', function (event) {
    event.preventDefault();
    var input = this.querySelector('input');
    if (!input.value.trim()) return;
    handlePointage([input.value]);
    input.value = '';
  });

  $('form-deballage').addEventListener('submit', function (event) {
    event.preventDefault();
    var input = this.querySelector('input');
    if (!input.value.trim()) return;
    input.blur();
    handleQuestion([input.value]);
  });

  $('form-deballage').querySelector('input').addEventListener('input', renderSearch);

  $('undo').addEventListener('click', function () {
    if (!undo()) window.alert('Rien à annuler.');
  });

  $('reset').addEventListener('click', function () {
    if (!state.entries.length) return;
    if (!window.confirm('Vider toute la liste pour un nouveau réassort ?')) return;
    snapshot();
    state.entries = [];
    lastPointageId = null;
    answerId = null;
    pending = null;
    $('answer').hidden = true;
    commit();
  });

  // Garde l'écran allumé pendant le réassort.
  function keepAwake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').catch(function () { /* refusé : tant pis */ });
  }
  document.addEventListener('visibilitychange', keepAwake);
  document.addEventListener('visibilitychange', syncCamera);

  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = frenchVoice;

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* hors ligne indisponible */ });
  }

  $('catalog-count').textContent = catalog.items.length;
  PAD_MODES.forEach(function (mode) {
    $('pad-' + mode).innerHTML = buildPad(mode);
    renderPad(mode);
  });
  applyInputModes();
  var initialTab = 'pointage';
  try { initialTab = localStorage.getItem(TAB_KEY) || initialTab; } catch (e) { /* ignoré */ }
  selectTab(initialTab);
  renderList();
  renderTest();
  keepAwake();
})();

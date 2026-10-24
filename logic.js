// Logique du réassort : lecture des phrases dictées, codes article, recherche dans le catalogue.
// Aucun accès au DOM ici, pour pouvoir tester avec Node (tests/logic.test.js).
(function (root) {
  'use strict';

  var NUMBER_WORDS = {
    zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7,
    huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14,
    quinze: 15, seize: 16, vingt: 20, vingts: 20, trente: 30, quarante: 40,
    cinquante: 50, soixante: 60
  };
  var MULTIPLIERS = { cent: 100, cents: 100, mille: 1000 };
  var HALF_WORDS = set('demi demie demis demies');
  var BOX_WORDS = set('carton cartons colis');
  var NEGATIVE_WORDS = set('non pas rien aucun aucune zero');
  var NEGATIVE_FILLER = set('on ne n sort sors sortir le la les l de d du des je j carton cartons');
  var LEADING_ARTICLES = set('le la les l de d du des');
  var CODE_WORDS = set('code article numero');
  var UNDO_WORDS = set('annule annuler efface effacer supprime supprimer');
  // Mots ignorés quand on compare des noms d'articles (questions, articles, unités).
  var STOP_WORDS = set(
    'est ce qu que qui quoi on sort sortir sors sortent sortira les le la l des de du d un une ' +
    'au aux a il ils elle y faut pour et ou combien oui non alors en je j dois doit ca c ' +
    'tu me m dis dit avec ne n pas t carton cartons demi g kg cl ml code article numero'
  );

  var MIN_SCORE = 0.6;
  var ENTRY_GAP = 0.08;     // écart en dessous duquel deux articles pointés sont « au coude à coude »
  var CATALOG_GAP = 0.15;   // plus large dans le catalogue : on préfère demander que se tromper
  var MAX_CHOICES = 6;
  var SAME_ARTICLE_SCORE = 0.9;

  function set(words) {
    var out = {};
    words.split(' ').forEach(function (w) { out[w] = true; });
    return out;
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function normalize(word) {
    return word.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/œ/g, 'oe').replace(/æ/g, 'ae');
  }

  // Découpe une phrase en mots : texte d'origine (affichage) + clé sans accents (logique).
  function tokenize(text) {
    var lower = String(text || '').toLowerCase()
      .replace(/½/g, ' demi ')
      .replace(/(^|\D)1\/2(?!\d)/g, '$1 demi ');
    var raw = lower.match(/\d+(?:[.,]\d+)?|\p{L}+/gu) || [];
    return raw.map(function (word) { return { text: word, key: normalize(word) }; });
  }

  // --- Nombres -------------------------------------------------------------

  function isNumberToken(key) {
    return /^\d+$/.test(key) || has(NUMBER_WORDS, key) || has(MULTIPLIERS, key);
  }

  // Quantité : « 2 », « deux », « 1,5 ». Les grands nombres sont des codes, pas des quantités.
  function numberValue(key) {
    if (/^\d{1,3}$/.test(key)) return parseInt(key, 10);
    if (/^\d+[.,]\d+$/.test(key)) return parseFloat(key.replace(',', '.'));
    if (has(NUMBER_WORDS, key) && NUMBER_WORDS[key] <= 20) return NUMBER_WORDS[key];
    return null;
  }

  // Lit une suite de nombres dictés comme une suite de chiffres :
  //   « 89 431 » → 89431, « huit neuf quatre trois un » → 89431,
  //   « quatre-vingt-neuf mille quatre cent trente et un » → 89431,
  //   « quatre-vingt-neuf quatre cent trente et un » → 89431.
  // Un nouveau nombre commence dès qu'un mot ne peut pas compléter le précédent.
  function readDigits(tokens) {
    var out = '';
    var total = 0;
    var current = 0;
    var open = false;
    var prev = null;

    function flush() {
      if (open) out += String(total + current);
      total = 0;
      current = 0;
      open = false;
    }

    for (var i = 0; i < tokens.length; i++) {
      var key = tokens[i].key;
      if (key === 'et') continue;
      if (/^\d+$/.test(key)) {
        flush();
        out += key;
        prev = key;
        continue;
      }
      if (has(MULTIPLIERS, key)) {
        if (key === 'mille') {
          total += (current || 1) * 1000;
          current = 0;
        } else {
          current = (current || 1) * 100;
        }
        open = true;
        prev = key;
        continue;
      }
      if (!has(NUMBER_WORDS, key)) return null;
      var value = NUMBER_WORDS[key];
      var low = current % 100;
      var filled = current > 0 || total > 0;
      var fits = false;
      if (open && value === 20 && prev === 'quatre' && low === 4) {
        current += 76;               // quatre-vingt
        prev = key;
        continue;
      }
      if (open && value > 0) {
        if (value >= 20) fits = low === 0 && filled;
        else if (value >= 10) fits = (low === 0 && filled) || low === 60 || low === 80;
        else fits = (low === 0 && filled) || (low >= 20 && low % 10 === 0);
      }
      if (fits) {
        current += value;
      } else {
        flush();
        current = value;
        open = true;
      }
      prev = key;
    }
    flush();
    return out;
  }

  // Cherche un code article dans la phrase. `isKnown(code)` dit si le code existe.
  // Les nombres qui suivent le code (« 89431 deux cartons ») restent pour la quantité.
  // → { code, known, start, stop } (stop exclu) ou null.
  function extractCode(tokens, isKnown) {
    var start = 0;
    while (start < tokens.length) {
      if (!isNumberToken(tokens[start].key)) { start++; continue; }
      var end = start;
      while (end < tokens.length && (isNumberToken(tokens[end].key) ||
        (tokens[end].key === 'et' && end + 1 < tokens.length && isNumberToken(tokens[end + 1].key)))) end++;

      var unknown = null;
      var short = null;
      for (var stop = end; stop > start; stop--) {
        var digits = readDigits(tokens.slice(start, stop));
        if (!digits || digits.length < 4) continue;
        if (isKnown && isKnown(digits)) return { code: digits, known: true, start: start, stop: stop };
        if (!unknown && digits.length === 5) unknown = { code: digits, known: false, start: start, stop: stop };
        // 4 chiffres inconnus : souvent un chiffre que la reconnaissance a avalé (« 89 31 »).
        // Marqué `short` : à ignorer si la phrase contient aussi un nom (« pizza 400 deux »).
        if (!short && digits.length === 4) short = { code: digits, known: false, short: true, start: start, stop: stop };
      }
      // « 89 31 deux cartons » : code écrit en chiffres, quantité en lettres → le code s'arrête aux lettres.
      var digitStop = start;
      while (digitStop < end && /^\d+$/.test(tokens[digitStop].key)) digitStop++;
      if (digitStop > start && digitStop < end) {
        var written = readDigits(tokens.slice(start, digitStop));
        if (written.length === 5 || written.length === 4) {
          return { code: written, known: false, short: written.length === 4, start: start, stop: digitStop };
        }
      }
      if (unknown) return unknown;
      if (short) return short;
      start = end;
    }
    return null;
  }

  function withoutRange(tokens, hit) {
    return tokens.slice(0, hit.start).concat(tokens.slice(hit.stop))
      .filter(function (t) { return !CODE_WORDS[t.key]; });
  }

  function isQuantityWord(key) {
    return numberValue(key) !== null || HALF_WORDS[key] || BOX_WORDS[key] || key === 'et';
  }

  function isQuantityCore(key) {
    return numberValue(key) !== null || HALF_WORDS[key] || BOX_WORDS[key];
  }

  // « un carton et demi » → 1.5, « un demi » → 0.5, « deux cartons » → 2.
  function computeQuantity(tokens) {
    var numbers = [];
    var half = false;
    var and = false;
    var box = false;
    tokens.forEach(function (t) {
      var value = numberValue(t.key);
      if (value !== null) numbers.push(value);
      else if (HALF_WORDS[t.key]) half = true;
      else if (t.key === 'et') and = true;
      else if (BOX_WORDS[t.key]) box = true;
    });
    var qty = null;
    if (half) qty = and && numbers.length ? numbers[0] + 0.5 : (numbers.length ? numbers[0] * 0.5 : 0.5);
    else if (numbers.length) qty = numbers[0];
    else if (box) qty = 1;
    return qty === null ? null : Math.round(qty * 2) / 2;
  }

  // Sépare le nom, la quantité et la négation. `hasCode` : le nom peut alors être vide.
  function splitQuantity(tokens, hasCode) {
    var negative = false;

    // « croissants on sort pas », « nems non », « pizza zéro carton »
    var tail = tokens.length;
    var tailHasNegative = false;
    while (tail > 0) {
      var k = tokens[tail - 1].key;
      if (NEGATIVE_WORDS[k] || numberValue(k) === 0) tailHasNegative = true;
      else if (!NEGATIVE_FILLER[k]) break;
      tail--;
    }
    if (tailHasNegative) {
      negative = true;
      tokens = tokens.slice(0, tail);
    }

    // « pas de croissants », « non croissants »
    if (tokens.length && (tokens[0].key === 'pas' || tokens[0].key === 'non')) {
      negative = true;
      tokens = tokens.slice(1);
    }

    var qty = null;
    if (!negative) {
      var minName = hasCode ? 0 : 1;
      var start = tokens.length;
      while (start > minName && isQuantityWord(tokens[start - 1].key)) start--;
      var qtyTokens = tokens.slice(start);
      if (qtyTokens.some(function (t) { return isQuantityCore(t.key); })) {
        tokens = tokens.slice(0, start);
      } else {
        // « deux cartons de nems »
        var end = 0;
        while (end < tokens.length - minName && (isQuantityWord(tokens[end].key) || LEADING_ARTICLES[tokens[end].key])) end++;
        qtyTokens = tokens.slice(0, end);
        if (qtyTokens.some(function (t) { return isQuantityCore(t.key); })) tokens = tokens.slice(end);
        else qtyTokens = [];
      }
      qty = computeQuantity(qtyTokens);
      if (qty === 0) negative = true;
    }

    while (tokens.length && LEADING_ARTICLES[tokens[0].key]) tokens = tokens.slice(1);
    var name = tokens.map(function (t) { return t.text; }).join(' ');
    if (name) name = name.charAt(0).toUpperCase() + name.slice(1);

    return {
      name: name,
      qty: negative ? 0 : (qty === null ? 1 : qty),
      out: !negative,
      qtyGuessed: !negative && qty === null
    };
  }

  // --- Catalogue -----------------------------------------------------------

  // rows : [[code, nom, code-barres?, nom complet?], ...]. Les dernières lignes remplacent les premières
  // (catalogue perso).
  function createCatalog(rows) {
    var byCode = {};
    (rows || []).forEach(function (row) {
      byCode[row[0]] = { code: row[0], name: row[1], ean: row[2] || null, keys: nameKeys(row[1]) };
    });
    var items = Object.keys(byCode).map(function (c) { return byCode[c]; });
    var byEan = {};
    items.forEach(function (item) { if (item.ean) byEan[item.ean] = item; });
    return { byCode: byCode, byEan: byEan, items: items };
  }

  // --- Codes-barres ----------------------------------------------------------

  // Clé de contrôle d'un code EAN (8, 12, 13 ou 14 chiffres) : détecte une lecture fausse de la caméra.
  function validEan(digits) {
    if (!/^\d+$/.test(digits) || [8, 12, 13, 14].indexOf(digits.length) < 0) return false;
    var sum = 0;
    for (var i = 0; i < digits.length - 1; i++) {
      var fromRight = digits.length - 1 - i;
      sum += Number(digits[i]) * (fromRight % 2 === 1 ? 3 : 1);
    }
    return (10 - sum % 10) % 10 === Number(digits[digits.length - 1]);
  }

  // EAN-13 que Picard fabrique lui-même : 327016 + référence sur 6 chiffres + clé (ex. 3270160894314 → 89431).
  var PICARD_PREFIX = '327016';

  function codeFromPicardEan(ean) {
    if (ean.length !== 13 || ean.indexOf(PICARD_PREFIX) !== 0) return null;
    return String(Number(ean.slice(6, 12)));
  }

  // Ce que la caméra a lu → { code, item, ean } ou null si ce n'est pas un code-barres exploitable.
  //   - EAN du produit : cherché dans le catalogue, sinon déduit si c'est un EAN Picard ;
  //   - carton (ITF-14 : un chiffre en plus devant) et GS1-128 (« 01 » + 14 chiffres) : on en extrait l'EAN.
  // item vaut null quand le code est déduit mais absent du catalogue.
  function codeFromBarcode(raw, catalog) {
    var digits = String(raw || '').replace(/\D/g, '');
    var tries = [];
    function add(candidate) { if (candidate && tries.indexOf(candidate) < 0) tries.push(candidate); }
    add(digits);
    if (digits.length === 14) add(digits.slice(1, 14));
    if (digits.length >= 16 && digits.indexOf('01') === 0) {
      add(digits.slice(2, 16));
      add(digits.slice(3, 16));
    }
    for (var i = 0; i < tries.length; i++) {
      var ean = tries[i];
      if (!validEan(ean)) continue;
      var item = catalog && catalog.byEan[ean];
      if (item) return { code: item.code, item: item, ean: ean };
      var code = codeFromPicardEan(ean);
      if (code) {
        var padded = code.length < 4 ? ('0000' + code).slice(-4) : code;
        var known = catalog && (catalog.byCode[code] || catalog.byCode[padded] || catalog.byCode['0' + code]);
        return { code: known ? known.code : code, item: known || null, ean: ean };
      }
    }
    return null;
  }

  // Codes du catalogue à une faute près (un chiffre changé, ajouté, oublié ou inversé).
  function nearCodes(code, codes) {
    return codes.filter(function (c) {
      if (c === code || Math.abs(c.length - code.length) > 1) return false;
      if (levenshtein(c, code) <= 1) return true;
      if (c.length !== code.length) return false;
      var diff = [];
      for (var i = 0; i < c.length; i++) if (c[i] !== code[i]) diff.push(i);
      return diff.length === 2 && diff[1] === diff[0] + 1 && c[diff[0]] === code[diff[1]] && c[diff[1]] === code[diff[0]];
    });
  }

  function searchCatalog(query, catalog) {
    var keys = nameKeys(query);
    if (!keys.length || !catalog) return [];
    var results = [];
    catalog.items.forEach(function (item) {
      var score = nameScore(keys, item.keys);
      if (score >= MIN_SCORE) results.push({ item: item, score: score });
    });
    return results.sort(function (a, b) { return b.score - a.score; });
  }

  function pickFromCatalog(results) {
    if (!results.length) return null;
    var best = results[0].score;
    var close = results.filter(function (r) { return r.score >= best - CATALOG_GAP; });
    if (close.length === 1) return { kind: 'item', item: close[0].item };
    return { kind: 'choose', candidates: close.slice(0, MAX_CHOICES).map(function (r) { return r.item; }) };
  }

  // --- Pointage --------------------------------------------------------------

  // Phrase dictée pendant le pointage →
  //   { action: 'undo' } | { action: 'unknown' } |
  //   { action: 'set', qty, out, qtyGuessed, target } où target vaut
  //     { kind: 'item', item }                       article du catalogue identifié
  //     { kind: 'choose', candidates, name }         plusieurs articles possibles
  //     { kind: 'unknownCode', code, suggestions }   code absent du catalogue
  //     { kind: 'free', name }                       nom absent du catalogue
  function parsePointage(text, catalog) {
    var tokens = tokenize(text);
    if (!tokens.length) return { action: 'unknown' };
    if (UNDO_WORDS[tokens[0].key]) return { action: 'undo' };

    var byCode = catalog ? catalog.byCode : {};
    var hit = extractCode(tokens, function (c) { return has(byCode, c); });
    var parts = splitQuantity(hit ? withoutRange(tokens, hit) : tokens, !!hit);
    if (hit && hit.short && parts.name) {
      hit = null;
      parts = splitQuantity(tokens, false);
    }
    var target;
    if (hit && hit.known) {
      target = { kind: 'item', item: byCode[hit.code] };
    } else if (hit) {
      var suggestions = catalog ? nearCodes(hit.code, Object.keys(byCode)).map(function (c) { return byCode[c]; }) : [];
      target = { kind: 'unknownCode', code: hit.code, suggestions: suggestions.slice(0, MAX_CHOICES) };
    } else if (parts.name) {
      var picked = pickFromCatalog(searchCatalog(parts.name, catalog));
      if (picked && picked.kind === 'choose') picked.name = parts.name;
      target = picked || { kind: 'free', name: parts.name };
    } else {
      return { action: 'unknown' };
    }

    return { action: 'set', qty: parts.qty, out: parts.out, qtyGuessed: parts.qtyGuessed, target: target };
  }

  // Parmi plusieurs transcriptions possibles, garde celle qui identifie le mieux un article.
  function bestPointage(alternatives, catalog) {
    var rank = { item: 4, choose: 3, unknownCode: 2, free: 1 };
    var best = null;
    var bestRank = -1;
    alternatives.forEach(function (text) {
      var parsed = parsePointage(text, catalog);
      var r = parsed.action === 'set' ? rank[parsed.target.kind] : (parsed.action === 'undo' ? 5 : 0);
      if (r > bestRank) { best = { text: text, parsed: parsed }; bestRank = r; }
    });
    return best;
  }

  // --- Déballage -------------------------------------------------------------

  function formatQty(qty) {
    if (!qty) return 'rien';
    var whole = Math.floor(qty);
    var half = qty - whole >= 0.5;
    if (whole === 0) return 'un demi';
    var text = whole === 1 ? 'un carton' : whole + ' cartons';
    return half ? text + ' et demi' : text;
  }

  function singular(key) {
    return key.length > 3 && /[sx]$/.test(key) ? key.slice(0, -1) : key;
  }

  function nameKeys(text) {
    return tokenize(text).map(function (t) { return t.key; })
      .filter(function (k) { return !STOP_WORDS[k] && !/^\d/.test(k) && numberValue(k) === null && !has(NUMBER_WORDS, k); })
      .map(singular);
  }

  function levenshtein(a, b) {
    var prev = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      for (var jj = 1; jj <= b.length; jj++) {
        var cost = a[i - 1] === b[jj - 1] ? 0 : 1;
        cur[jj] = Math.min(prev[jj] + 1, cur[jj - 1] + 1, prev[jj - 1] + cost);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function wordSimilarity(a, b) {
    if (a === b) return 1;
    if (Math.min(a.length, b.length) >= 3 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return 0.85;
    if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.3) return 0;
    return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  }

  function coverage(from, to) {
    var sum = 0;
    from.forEach(function (a) {
      var best = 0;
      to.forEach(function (b) { best = Math.max(best, wordSimilarity(a, b)); });
      if (best >= 0.7) sum += best;
    });
    return sum / from.length;
  }

  // Ce que l'on dit doit surtout se retrouver dans le nom (précision),
  // mais un nom plus complet départage deux articles proches (rappel).
  function nameScore(queryKeys, itemKeys) {
    if (!queryKeys.length || !itemKeys.length) return 0;
    return 0.7 * coverage(queryKeys, itemKeys) + 0.3 * coverage(itemKeys, queryKeys);
  }

  function findMatches(query, entries) {
    var keys = nameKeys(query);
    if (!keys.length) return [];
    return entries
      .map(function (entry) { return { entry: entry, score: entry.name ? nameScore(keys, nameKeys(entry.name)) : 0 }; })
      .filter(function (r) { return r.score >= MIN_SCORE; })
      .sort(function (a, b) { return b.score - a.score; });
  }

  // Question posée au déballage →
  //   { kind: 'match', entry }                    article pointé
  //   { kind: 'ambiguous', candidates: [entry] }  plusieurs articles pointés possibles
  //   { kind: 'notNoted', code, item, near }      pas pointé (item : article du catalogue s'il est reconnu,
  //                                               near : articles pointés dont le code est à une faute près)
  function ask(text, entries, catalog) {
    var byCode = catalog ? catalog.byCode : {};
    var entryByCode = {};
    entries.forEach(function (e) { if (e.code) entryByCode[e.code] = e; });

    var tokens = tokenize(text);
    var hit = extractCode(tokens, function (c) { return has(entryByCode, c) || has(byCode, c); });
    if (hit && hit.short && nameKeys(text).length) hit = null;
    if (hit) {
      if (has(entryByCode, hit.code)) return { kind: 'match', entry: entryByCode[hit.code] };
      var near = nearCodes(hit.code, Object.keys(entryByCode)).map(function (c) { return entryByCode[c]; });
      return { kind: 'notNoted', code: hit.code, item: byCode[hit.code] || null, near: near };
    }

    var matches = findMatches(text, entries);
    if (matches.length) {
      var best = matches[0].score;
      var close = matches.filter(function (r) { return r.score >= best - ENTRY_GAP; });
      if (close.length === 1) return { kind: 'match', entry: close[0].entry };
      return { kind: 'ambiguous', candidates: close.slice(0, MAX_CHOICES).map(function (r) { return r.entry; }) };
    }

    var picked = pickFromCatalog(searchCatalog(text, catalog));
    return { kind: 'notNoted', code: null, item: picked && picked.kind === 'item' ? picked.item : null, near: [] };
  }

  function bestQuestion(alternatives, entries, catalog) {
    var rank = { match: 3, ambiguous: 2, notNoted: 1 };
    var best = null;
    alternatives.forEach(function (text) {
      var result = ask(text, entries, catalog);
      var r = rank[result.kind] + (result.item ? 0.5 : 0);
      if (!best || r > best.rank) best = { text: text, result: result, rank: r };
    });
    return best;
  }

  // L'article déjà pointé qui correspond (même code, ou même nom pour les articles hors catalogue).
  function findSameArticle(article, entries) {
    var i;
    if (article.code) {
      for (i = 0; i < entries.length; i++) if (entries[i].code === article.code) return entries[i];
      return null;
    }
    if (!article.name) return null;
    var keys = nameKeys(article.name);
    var best = null;
    var bestScore = SAME_ARTICLE_SCORE;
    entries.forEach(function (e) {
      if (e.code) return;
      var s = nameScore(keys, nameKeys(e.name || ''));
      if (s >= bestScore) { best = e; bestScore = s; }
    });
    return best;
  }

  function spokenCode(code) {
    return code.split('').join(' ');
  }

  function spokenLabel(entry) {
    return entry.name || 'code ' + spokenCode(entry.code);
  }

  // Réponse au moment du déballage.
  function answer(entry) {
    if (!entry.out || !entry.qty) {
      return { yes: false, short: 'NON', detail: 'On ne sort pas', speech: spokenLabel(entry) + ' : non, on ne sort pas.' };
    }
    var done = entry.done || 0;
    var remaining = Math.max(0, entry.qty - done);
    var detail = formatQty(entry.qty);
    if (done > 0) detail += remaining > 0 ? ' — reste ' + formatQty(remaining) : ' — déjà tout déballé';
    return { yes: true, short: 'OUI', detail: detail, speech: spokenLabel(entry) + ' : oui, ' + detail.replace(' — ', ', ') + '.' };
  }

  var api = {
    tokenize: tokenize,
    readDigits: readDigits,
    createCatalog: createCatalog,
    codeFromBarcode: codeFromBarcode,
    validEan: validEan,
    nearCodes: nearCodes,
    searchCatalog: searchCatalog,
    parsePointage: parsePointage,
    bestPointage: bestPointage,
    ask: ask,
    bestQuestion: bestQuestion,
    findMatches: findMatches,
    findSameArticle: findSameArticle,
    formatQty: formatQty,
    answer: answer,
    spokenCode: spokenCode,
    spokenLabel: spokenLabel
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Reassort = api;
})(this);

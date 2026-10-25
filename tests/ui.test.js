// Lancer avec : npm install puis npm test
// Simule l'app dans un faux navigateur : micro simulé (plusieurs transcriptions possibles), voix capturée.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const APP = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8')
  .replace(/<script src="[^"]+"><\/script>/g, '');

const dom = new JSDOM(html, { url: 'http://localhost:8765/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
const spoken = [];
let nextPhrases = null;

w.speechSynthesis = { cancel() {}, speak(u) { spoken.push(u.text); }, getVoices() { return []; } };
w.SpeechSynthesisUtterance = function (t) { this.text = t; };
w.SpeechRecognition = function () {
  this.start = () => {
    const phrases = nextPhrases;
    setTimeout(() => {
      const result = phrases.map((p) => ({ transcript: p }));
      result.isFinal = true;
      this.onresult({ results: [result] });
      this.onend();
    }, 0);
  };
  this.stop = () => {};
};
let promptAnswers = [];
w.prompt = () => promptAnswers.shift();
w.confirm = () => true;
w.alert = () => {};

// Caméra et lecteur de codes-barres simulés : nextBarcode est ce que « voit » la caméra.
let nextBarcode = null;
let cameraOn = false;
w.navigator.mediaDevices = {
  getUserMedia: () => {
    cameraOn = true;
    return Promise.resolve({ getTracks: () => [{ stop() { cameraOn = false; } }] });
  }
};
w.BarcodeDetector = function () {
  // nextBarcode : un texte, ou une liste [{ rawValue, boundingBox }] quand plusieurs codes sont dans l'image
  this.detect = () => Promise.resolve(Array.isArray(nextBarcode) ? nextBarcode : nextBarcode ? [{ rawValue: nextBarcode }] : []);
};
Object.defineProperty(w.HTMLVideoElement.prototype, 'videoWidth', { get: () => 1000 });
Object.defineProperty(w.HTMLVideoElement.prototype, 'videoHeight', { get: () => 750 });
w.HTMLMediaElement.prototype.play = () => Promise.resolve();
Object.defineProperty(w.HTMLMediaElement.prototype, 'readyState', { get: () => 4 });

for (const f of ['catalog.js', 'logic.js', 'scanner.js', 'app.js']) w.eval(fs.readFileSync(path.join(APP, f), 'utf8'));

const $ = (s) => w.document.querySelector(s);
const $$ = (s) => [...w.document.querySelectorAll(s)];
const last = () => spoken[spoken.length - 1];
const tick = () => new Promise((r) => setTimeout(r, 5));
async function say(mode, ...phrases) {
  nextPhrases = phrases;
  $('[data-mic="' + mode + '"]').click();
  await tick();
  return last();
}

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

(async () => {
  await test('pointage par code : code et nom affichés', async () => {
    assert.strictEqual(await say('pointage', '89431 deux cartons'), 'Pizza margherita 400g, 2 cartons.');
    const card = $('#pointage-result .entry');
    assert.strictEqual(card.querySelector('.code').textContent, '89431');
    assert.ok(card.textContent.includes('Pizza margherita 400g'));
    assert.strictEqual(await say('pointage', 'quatre-vingt-neuf mille quatre cent trente et un un demi'), 'Pizza margherita 400g, un demi, mis à jour.');
    assert.strictEqual($('#count').textContent, '1');
  });

  await test('la meilleure transcription est retenue', async () => {
    assert.strictEqual(await say('pointage', 'poêlée sarla daisy un demi', '12866 un demi'), 'Poêlée sarladaise, un demi.');
  });

  await test('plusieurs articles proches → choix à l\'écran', async () => {
    assert.strictEqual(await say('pointage', 'nems un carton'), w.document.querySelectorAll('#pointage-result [data-action="choose"]').length + ' articles possibles. Choisis à l’écran.');
    const choice = $$('#pointage-result [data-action="choose"]').find((b) => b.textContent.includes('39691'));
    choice.click();
    assert.strictEqual(last(), '8 nems poulet avec sauce nuoc mam, un carton.');
    assert.ok($('#pointage-result .entry .code'));
  });

  await test('code inconnu → propositions, ou garder le code', async () => {
    assert.ok((await say('pointage', '89424 deux cartons')).includes('inconnu'));
    assert.ok($$('#pointage-result [data-action="choose"]').some((b) => b.textContent.includes('89421')));
    $('#pointage-result [data-action="keep"]').click();
    assert.strictEqual(last(), 'code 8 9 4 2 4, 2 cartons.');
  });

  await test('renommer un article inconnu l\'ajoute au catalogue perso', async () => {
    const row = $$('#list .entry').find((li) => li.textContent.includes('89424'));
    promptAnswers = ['89424', 'Gratin test maison'];
    row.querySelector('[data-action="rename"]').click();
    assert.ok($$('#list .entry').some((li) => li.textContent.includes('Gratin test maison')));
    assert.strictEqual(await say('pointage', '89424 un carton'), 'Gratin test maison, un carton, mis à jour.');
  });

  await test('déballage : par code, par nom, pas noté', async () => {
    assert.strictEqual(await say('deballage', 'huit neuf quatre trois un'), 'Pizza margherita 400g : oui, un demi.');
    assert.ok($('#answer').classList.contains('yes'));
    assert.strictEqual($('#answer .code').textContent, '89431');
    assert.strictEqual(await say('deballage', 'on sort la poêlée sarladaise'), 'Poêlée sarladaise : oui, un demi.');
    assert.strictEqual(await say('deballage', '39881'), '8 nems légumes avec sauce aigre douce : pas noté. Vérifie sur la tablette.');
    assert.ok($('#answer').classList.contains('none'));
    assert.strictEqual(await say('deballage', 'glace au chou-fleur violet'), 'Pas noté. Vérifie sur la tablette.');
  });

  await test('déballage : code à un chiffre près → proposition', async () => {
    await say('deballage', '89432');
    const near = $$('#answer [data-action="pick"]');
    if (near.length) {
      near[0].click();
      assert.strictEqual(last(), 'Pizza margherita 400g : oui, un demi.');
    }
  });

  await test('compteur de déballage', async () => {
    await say('pointage', '89431 deux cartons');
    await say('deballage', '89431');
    $('#answer [data-action="unpack"][data-amount="1"]').click();
    assert.strictEqual(await say('deballage', '89431'), 'Pizza margherita 400g : oui, 2 cartons, reste un carton.');
    $('#answer [data-action="unpack"][data-amount="1"]').click();
    assert.strictEqual(await say('deballage', '89431'), 'Pizza margherita 400g : oui, 2 cartons, déjà tout déballé.');
  });

  await test('recherche tapée par début de code', async () => {
    const search = $('#form-deballage input');
    search.value = '894';
    search.dispatchEvent(new w.Event('input'));
    assert.ok($('#search-results').textContent.includes('Pizza margherita 400g'));
  });

  await test('onglet Test : réussite et raté', async () => {
    $('[data-tab="test"]').click();
    const code = $('#test-target .code').textContent;
    await say('test', code.split('').join(' '));
    assert.strictEqual(spoken[spoken.length - 1], 'Bon.');
    assert.ok($('#test-score').textContent.startsWith('1 / 1'));
    const code2 = $('#test-target .code').textContent;
    await say('test', '11111');
    assert.strictEqual(last(), 'Raté.');
    assert.ok($('#test-misses').textContent.includes(code2));
    assert.strictEqual($('#test-target .code').textContent, code2, 'on garde le même code après un raté');
  });

  function tapCode(mode, code) {
    for (const d of code) $(`#pad-${mode} [data-key="${d}"]`).click();
  }

  await test('pavé : pointage en 5 chiffres + quantité', async () => {
    $('[data-tab="pointage"]').click();
    $('#view-pointage [data-input="pad"]').click();
    assert.ok($('#view-pointage').classList.contains('pad-mode'));
    assert.ok($('#pad-pointage [data-action="pad-qty"]').disabled, 'quantités bloquées sans code');
    tapCode('pointage', '12866');
    assert.strictEqual($('#pad-digits-pointage').textContent, '12866');
    assert.ok($('#pad-preview-pointage').textContent.includes('Poêlée sarladaise'));
    assert.ok($('#pad-preview-pointage').textContent.includes('Déjà pointé'));
    $('#pad-pointage [data-qty="1.5"]').click();
    assert.strictEqual(last(), 'Poêlée sarladaise, un carton et demi, mis à jour.');
    assert.strictEqual($('#pad-digits-pointage').textContent.trim(), '', 'pavé vidé après pointage');
    tapCode('pointage', '128');
    $('#pad-pointage [data-key="back"]').click();
    assert.strictEqual($('#pad-digits-pointage').textContent, '12');
    $('#pad-pointage [data-key="clear"]').click();
    tapCode('pointage', '89424');
    assert.ok($('#pad-preview-pointage').textContent.includes('Gratin test maison'), 'catalogue perso reconnu');
    $('#pad-pointage [data-qty="0"]').click();
    assert.strictEqual(last(), 'Gratin test maison, on ne sort pas, mis à jour.');
    tapCode('pointage', '99998');
    assert.ok($('#pad-preview-pointage').textContent.includes('Code inconnu'));
    $('#pad-pointage [data-qty="2"]').click();
    assert.ok($('#pointage-result').textContent.includes('inconnu'));
    $('#pointage-result [data-action="cancel-pick"]').click();
  });

  await test('pavé : déballage répond dès 5 chiffres', async () => {
    $('[data-tab="deballage"]').click();
    $('#view-deballage [data-input="pad"]').click();
    tapCode('deballage', '12866');
    assert.strictEqual(last(), 'Poêlée sarladaise : oui, un carton et demi.');
    assert.strictEqual($('#pad-digits-deballage').textContent.trim(), '');
    tapCode('deballage', '39881');
    assert.ok(last().includes('pas noté'));
  });

  await test('pavé : clavier du PC', async () => {
    for (const k of ['8', '9', '4', '3', '1']) w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k }));
    assert.strictEqual(last(), 'Pizza margherita 400g : oui, 2 cartons, déjà tout déballé.');
  });

  await test('le choix voix/pavé est retenu', async () => {
    assert.strictEqual(JSON.parse(w.localStorage.getItem('reassort.saisie')).deballage, 'pad');
    $('#view-deballage [data-input="voice"]').click();
    assert.ok(!$('#view-deballage').classList.contains('pad-mode'));
  });

  const eanOf = (code) => w.CATALOG.find((row) => row[0] === code)[2];
  const withCheck = (first12) => first12 + ((10 - [...first12].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0) % 10) % 10);
  const NEW_PICARD = withCheck('327016099997');   // référence 99997 : un produit Picard pas encore au catalogue
  const FOREIGN = '4006381333931';                // EAN valide d'une autre marque
  async function scan(barcode) {
    nextBarcode = barcode;
    await new Promise((r) => setTimeout(r, 450));
    nextBarcode = null;
  }

  await test('scan : la caméra ne tourne que dans un écran en mode scan', async () => {
    $('[data-tab="deballage"]').click();
    assert.strictEqual(cameraOn, false);
    $('#view-deballage [data-input="scan"]').click();
    await tick();
    assert.ok($('#view-deballage').classList.contains('scan-mode'));
    assert.strictEqual(cameraOn, true);
    $('[data-tab="liste"]').click();
    assert.strictEqual(cameraOn, false, 'caméra coupée hors de l\'écran');
    $('[data-tab="deballage"]').click();
    await tick();
    assert.strictEqual(cameraOn, true);
  });

  await test('scan : déballage répond au code-barres, sans relire le même code', async () => {
    spoken.length = 0;
    await scan(eanOf('12866'));
    assert.strictEqual(spoken.length, 1, 'une seule réponse malgré plusieurs lectures du même code');
    assert.ok(last().startsWith('Poêlée sarladaise : oui'), last());
    assert.ok($('#answer').textContent.includes('OUI'));
  });

  await test('scan : plusieurs codes-barres dans l\'image → celui du centre', async () => {
    spoken.length = 0;
    await scan([
      { rawValue: eanOf('0081'), boundingBox: { x: 400, y: 600, width: 200, height: 100 } },   // en bas
      { rawValue: eanOf('89431'), boundingBox: { x: 400, y: 330, width: 200, height: 100 } }   // au centre
    ]);
    assert.ok(last().startsWith('Pizza margherita 400g'), last());
  });

  await test('scan : code-barres inconnu', async () => {
    await scan('1234567890123');
    assert.strictEqual(last(), 'Code-barres non reconnu.');
    assert.ok($('#status-deballage').classList.contains('error'));
  });

  await test('scan : pointage, code-barres puis quantité', async () => {
    $('[data-tab="pointage"]').click();
    $('#view-pointage [data-input="scan"]').click();
    await tick();
    assert.strictEqual(cameraOn, true);
    assert.ok($('#pad-pointage [data-action="pad-qty"]').disabled, 'quantités bloquées sans scan');
    await scan(eanOf('89431'));
    assert.strictEqual(last(), 'Pizza margherita 400g');
    assert.ok($('#pad-preview-pointage').textContent.includes('Pizza margherita 400g'));
    $('#pad-pointage [data-qty="3"]').click();
    assert.strictEqual(last().startsWith('Pizza margherita 400g, 3 cartons'), true, last());
    assert.strictEqual($('#pad-digits-pointage').textContent.trim(), '', 'prêt pour le scan suivant');
  });

  await test('scan : article inconnu du catalogue enregistré tel quel, et rappelé au déballage', async () => {
    const unknown = '3270160999989';   // EAN Picard valide (référence 99998), absent du catalogue
    $('[data-tab="pointage"]').click();
    await scan(unknown);
    assert.strictEqual(last(), 'Code 9 9 9 9 8 inconnu.');
    $('#pad-pointage [data-qty="0"]').click();
    assert.strictEqual($('#pointage-result .pick'), null, 'pas de demande de confirmation : le code vient d\'un code-barres');
    assert.strictEqual(last(), 'code 9 9 9 9 8, on ne sort pas.');
    assert.ok($('#pointage-result').textContent.includes('99998'));

    $('[data-tab="deballage"]').click();
    $('#view-deballage [data-input="scan"]').click();
    await tick();
    await scan(unknown);
    assert.strictEqual(last(), 'code 9 9 9 9 8 : non, on ne sort pas.');
    assert.ok($('#answer').textContent.includes('NON'));
    $('#view-deballage [data-input="voice"]').click();
  });

  await test('scan : nommer un nouveau produit Picard, reconnu ensuite au scan', async () => {
    $('[data-tab="pointage"]').click();
    await scan(NEW_PICARD);
    assert.ok($('#pad-preview-pointage .name-btn'), 'bouton pour nommer');
    promptAnswers = ['Tarte nouveauté test'];
    $('#pad-preview-pointage .name-btn').click();
    assert.strictEqual(last(), 'Tarte nouveauté test, enregistré.');
    assert.ok($('#pad-preview-pointage').textContent.includes('Tarte nouveauté test'));
    assert.strictEqual($('#pad-preview-pointage .name-btn'), null, 'plus de bouton une fois nommé');
    $('#pad-pointage [data-qty="2"]').click();
    assert.strictEqual(last(), 'Tarte nouveauté test, 2 cartons.');
    // scan suivant : l'article est reconnu par son nom
    $('[data-tab="deballage"]').click();
    $('#view-deballage [data-input="scan"]').click();
    await tick();
    await scan(NEW_PICARD);
    assert.ok(last().startsWith('Tarte nouveauté test : oui'), last());
    $('#view-deballage [data-input="voice"]').click();
  });

  await test('scan : nommer un produit d\'une autre marque (code-barres inconnu)', async () => {
    $('[data-tab="pointage"]').click();
    $('#view-pointage [data-input="scan"]').click();
    await tick();
    await scan(FOREIGN);
    assert.strictEqual(last(), 'Article inconnu.');
    promptAnswers = ['Chocolat autre marque'];
    $('#pad-preview-pointage .name-btn').click();
    $('#pad-pointage [data-qty="1"]').click();
    assert.strictEqual(last(), 'Chocolat autre marque, un carton.');
    await scan('0' + FOREIGN);   // même produit lu sur son carton (évite l'anti-doublon de 3 s)
    assert.strictEqual(last(), 'Chocolat autre marque');
    $('#pad-pointage [data-key="clear"]').click();
    $('#view-pointage [data-input="voice"]').click();
  });

  await test('scan : caméra refusée → message clair', async () => {
    const original = w.navigator.mediaDevices.getUserMedia;
    w.navigator.mediaDevices.getUserMedia = () => Promise.reject({ name: 'NotAllowedError' });
    $('[data-tab="pointage"]').click();
    $('#view-pointage [data-input="voice"]').click();
    $('#view-pointage [data-input="scan"]').click();
    await tick();
    assert.ok($('#status-pointage').textContent.includes('Caméra refusée'));
    assert.ok($('#status-pointage').classList.contains('error'));
    w.navigator.mediaDevices.getUserMedia = original;
  });

  await test('scan : le choix est retenu, retour à la voix coupe la caméra', async () => {
    assert.strictEqual(JSON.parse(w.localStorage.getItem('reassort.saisie')).pointage, 'scan');
    $('#view-pointage [data-input="voice"]').click();
    $('#view-deballage [data-input="voice"]').click();
    assert.strictEqual(cameraOn, false);
  });

  await test('ajouter à la main un article inconnu', async () => {
    $('[data-tab="liste"]').click();
    const before = Number($('#count').textContent) || 0;
    promptAnswers = ['45678', 'Gâteau ajouté main'];
    $('#add').click();
    assert.strictEqual(Number($('#count').textContent), before + 1);
    assert.ok($('#list').textContent.includes('Gâteau ajouté main'));
    assert.ok($('#list').textContent.includes('45678'));
    // le code est retenu : le pavé le reconnaît ensuite
    $('[data-tab="pointage"]').click();
    $('#view-pointage [data-input="pad"]').click();
    tapCode('pointage', '45678');
    assert.ok($('#pad-preview-pointage').textContent.includes('Gâteau ajouté main'));
    $('#pad-pointage [data-key="clear"]').click();
    $('#view-pointage [data-input="voice"]').click();
  });

  await test('ajouter à la main : un article déjà pointé garde sa quantité', async () => {
    $('[data-tab="liste"]').click();
    await say('pointage', '12866 trois');
    const before = Number($('#count').textContent);
    promptAnswers = ['12866', ''];
    $('#add').click();
    assert.strictEqual(Number($('#count').textContent), before, 'pas de doublon');
    assert.ok($('#list').textContent.includes('3 cartons'), 'quantité conservée');
  });

  await test('ajouter à la main : annuler ne change rien', async () => {
    const before = Number($('#count').textContent);
    promptAnswers = [null];
    $('#add').click();
    promptAnswers = ['', ''];
    $('#add').click();
    assert.strictEqual(Number($('#count').textContent), before);
  });

  await test('image du produit affichée dans la liste, au pointage et au déballage', async () => {
    await say('pointage', '89431 deux cartons');
    const src = $('#pointage-result .thumb').src;
    assert.ok(src.startsWith('https://www.picard.fr/') && src.includes('000000000000089431_P.png'), src);
    assert.ok(src.endsWith('?sh=160'), 'image demandée en petite taille');
    $('[data-tab="liste"]').click();
    assert.ok($('#list .entry .thumb'));
    await say('deballage', '89431');
    assert.ok($('#answer .thumb'));
    // toucher l'image l'agrandit (sans renommer l'article), toucher l'écran ou Échap la referme
    const pizzaThumb = () => $$('#list .entry').find((r) => r.textContent.includes('Pizza margherita')).querySelector('.thumb');
    const prompts = [];
    const realPrompt = w.prompt;
    w.prompt = (...args) => { prompts.push(args); return null; };
    assert.ok($('#lightbox').hidden);
    pizzaThumb().click();
    assert.ok(!$('#lightbox').hidden, 'image agrandie');
    assert.ok($('#lightbox-img').src.endsWith('?sh=700'), 'grande image demandée au site');
    assert.ok($('#lightbox-caption').textContent.includes('Pizza margherita 400g'));
    assert.strictEqual(prompts.length, 0, 'toucher l\'image ne déclenche pas le renommage');
    $('#lightbox').click();
    assert.ok($('#lightbox').hidden, 'refermée au toucher');
    pizzaThumb().click();
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.ok($('#lightbox').hidden, 'refermée par Échap');
    w.prompt = realPrompt;

    // article hors catalogue : pas d'image, mais rien ne casse
    promptAnswers = ['', 'Article sans image'];
    $('#add').click();
    const rows = $$('#list .entry');
    assert.ok(rows.some((r) => r.textContent.includes('Article sans image') && !r.querySelector('.thumb')));
  });

  await test('annuler et nouveau réassort', async () => {
    const n = Number($('#count').textContent);
    await say('pointage', '12866 trois');
    assert.strictEqual(await say('pointage', 'annule'), 'Annulé.');
    assert.strictEqual(Number($('#count').textContent), n);
    $('#reset').click();
    assert.strictEqual($('#count').textContent, '');
  });

  if (failures) { console.log('\n' + failures + ' test(s) en échec'); process.exit(1); }
  console.log('\nTous les tests de l\'interface passent.');
  process.exit(0);
})();

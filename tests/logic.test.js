// Lancer avec : node tests/logic.test.js
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var R = require('../logic.js');

var failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

// Le vrai catalogue (catalog.js définit window.CATALOG).
var sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'catalog.js'), 'utf8'), sandbox);
var catalog = R.createCatalog(sandbox.window.CATALOG);

function digits(text) { return R.readDigits(R.tokenize(text)); }

function point(text) {
  var p = R.parsePointage(text, catalog);
  assert.strictEqual(p.action, 'set', text);
  return p;
}

function pointCode(text, code, qty, out) {
  var p = point(text);
  assert.strictEqual(p.target.kind, 'item', text + ' → ' + JSON.stringify(p.target));
  assert.strictEqual(p.target.item.code, code, text + ' → code');
  assert.strictEqual(p.qty, qty, text + ' → quantité');
  assert.strictEqual(p.out, out === undefined ? true : out, text + ' → sortie');
}

test('lecture des nombres dictés', function () {
  assert.strictEqual(digits('89431'), '89431');
  assert.strictEqual(digits('89 431'), '89431');
  assert.strictEqual(digits('8 9 4 3 1'), '89431');
  assert.strictEqual(digits('huit neuf quatre trois un'), '89431');
  assert.strictEqual(digits('quatre-vingt-neuf mille quatre cent trente et un'), '89431');
  assert.strictEqual(digits('quatre-vingt-neuf quatre cent trente et un'), '89431');
  assert.strictEqual(digits('89 quatre cent trente et un'), '89431');
  assert.strictEqual(digits('soixante-dix-sept mille deux cent quatre-vingt-dix-neuf'), '77299');
  assert.strictEqual(digits('douze trente-quatre cinquante-six'), '123456');
  assert.strictEqual(digits('cent vingt'), '120');
  assert.strictEqual(digits('zéro un deux'), '012');
});

test('le catalogue contient la pizza margherita 400g', function () {
  assert.ok(catalog.items.length > 1000);
  assert.strictEqual(catalog.byCode['89431'].name, 'Pizza margherita 400g');
});

test('pointage par code', function () {
  pointCode('89431 deux cartons', '89431', 2);
  pointCode('89 431 un demi', '89431', 0.5);
  pointCode('code 89431 un carton et demi', '89431', 1.5);
  pointCode('huit neuf quatre trois un deux cartons', '89431', 2);
  pointCode('quatre-vingt-neuf mille quatre cent trente et un un carton', '89431', 1);
  pointCode('quatre-vingt-neuf mille quatre cent trente et un deux', '89431', 2);
  pointCode('89431 on sort pas', '89431', 0, false);
  pointCode('89431', '89431', 1);
});

test('code inconnu → propositions proches', function () {
  var p = point('89421 deux cartons');
  if (catalog.byCode['89421']) return; // le code existe finalement : rien à tester
  assert.strictEqual(p.target.kind, 'unknownCode');
  assert.strictEqual(p.target.code, '89421');
  assert.ok(p.target.suggestions.some(function (i) { return i.code === '89431'; }));
  assert.strictEqual(p.qty, 2);
});

test('chiffre avalé par la reconnaissance → propositions', function () {
  var p = point('89 31 deux cartons');
  assert.strictEqual(p.target.kind, 'unknownCode');
  assert.ok(p.target.suggestions.some(function (i) { return i.code === '89431'; }), JSON.stringify(p.target.suggestions.map(function (i) { return i.code; })));
  assert.strictEqual(p.qty, 2);
  var r = R.ask('89 31', [{ id: 1, code: '89431', name: 'Pizza margherita 400g', qty: 2, out: true }], catalog);
  assert.strictEqual(r.kind, 'notNoted');
  assert.strictEqual(r.near[0].id, 1);
});

test('un poids n\'est pas pris pour un code', function () {
  var p = point('pizza margherita 400 deux cartons');
  assert.notStrictEqual(p.target.kind, 'unknownCode');
});

test('pointage par nom', function () {
  var p = point('pizza margherita deux cartons');
  assert.strictEqual(p.qty, 2);
  var found = p.target.kind === 'item' ? [p.target.item] : p.target.candidates;
  assert.ok(found.some(function (i) { return i.code === '89431'; }), JSON.stringify(p.target));

  p = point('poêlée sarladaise un demi');
  assert.strictEqual(p.target.kind, 'item');
  assert.strictEqual(p.target.item.name, 'Poêlée sarladaise');

  p = point('nems un carton');
  assert.strictEqual(p.target.kind, 'choose', 'plusieurs nems au catalogue');
  assert.ok(p.target.candidates.length >= 2);

  p = point('truc inventé machin deux cartons');
  assert.strictEqual(p.target.kind, 'free');
  assert.strictEqual(p.target.name, 'Truc inventé machin');
});

test('quantités et négations', function () {
  var cases = [
    ['nems au poulet un demi', 0.5, true],
    ['croissants un carton et demi', 1.5, true],
    ['frites 3', 3, true],
    ['deux cartons de nems', 2, true],
    ['croissants on sort pas', 0, false],
    ['pas de croissants', 0, false],
    ['pizza zéro carton', 0, false]
  ];
  cases.forEach(function (c) {
    var p = point(c[0]);
    assert.strictEqual(p.qty, c[1], c[0]);
    assert.strictEqual(p.out, c[2], c[0]);
  });
  assert.ok(point('poêlée sarladaise').qtyGuessed);
  assert.strictEqual(R.parsePointage('annule', catalog).action, 'undo');
  assert.strictEqual(R.parsePointage('', catalog).action, 'unknown');
});

test('la meilleure transcription gagne', function () {
  var best = R.bestPointage(['pizza marguerite de cartons', '89431 deux cartons'], catalog);
  assert.strictEqual(best.parsed.target.item.code, '89431');
});

var entries = [
  { id: 1, code: '89431', name: 'Pizza margherita 400g', qty: 2, out: true, done: 0 },
  { id: 2, code: '39691', name: '8 nems poulet avec sauce nuoc mam', qty: 0.5, out: true, done: 0 },
  { id: 3, code: '39881', name: '8 nems légumes avec sauce aigre douce', qty: 1, out: true, done: 0 },
  { id: 4, code: null, name: 'Croissants', qty: 0, out: false, done: 0 }
];

function ask(q) { return R.ask(q, entries, catalog); }

test('questions au déballage', function () {
  assert.strictEqual(ask('89431').entry.id, 1);
  assert.strictEqual(ask('huit neuf quatre trois un').entry.id, 1);
  assert.strictEqual(ask('est-ce qu\'on sort la pizza margherita').entry.id, 1);
  assert.strictEqual(ask('les croissants').entry.id, 4);
  assert.strictEqual(ask('nems poulet').entry.id, 2);
  var r = ask('les nems');
  assert.strictEqual(r.kind, 'ambiguous');
  assert.strictEqual(r.candidates.length, 2);
});

test('pas noté', function () {
  var r = ask('poêlée sarladaise');
  assert.strictEqual(r.kind, 'notNoted');
  assert.strictEqual(r.item.name, 'Poêlée sarladaise');
  r = ask('12866');
  assert.strictEqual(r.kind, 'notNoted');
  assert.strictEqual(r.item.code, '12866');
  r = ask('89421');
  if (!catalog.byCode['89421']) {
    assert.strictEqual(r.kind, 'notNoted');
    assert.strictEqual(r.near[0].id, 1, 'propose la pizza pointée à un chiffre près');
  }
});

test('réponses et quantités', function () {
  assert.strictEqual(R.answer(entries[0]).speech, 'Pizza margherita 400g : oui, 2 cartons.');
  assert.strictEqual(R.answer(entries[3]).speech, 'Croissants : non, on ne sort pas.');
  assert.strictEqual(R.answer({ name: 'Frites', qty: 2, out: true, done: 1 }).speech, 'Frites : oui, 2 cartons, reste un carton.');
  assert.strictEqual(R.formatQty(2.5), '2 cartons et demi');
});

test('même article au re-pointage', function () {
  assert.strictEqual(R.findSameArticle({ code: '89431' }, entries).id, 1);
  assert.strictEqual(R.findSameArticle({ code: null, name: 'croissants' }, entries).id, 4);
  assert.strictEqual(R.findSameArticle({ code: '12866' }, entries), null);
});

test('codes proches', function () {
  var codes = ['89431', '12345', '89413'];
  assert.deepStrictEqual(R.nearCodes('89432', codes), ['89431']);
  assert.deepStrictEqual(R.nearCodes('89341', codes), ['89431']); // deux chiffres inversés
  assert.deepStrictEqual(R.nearCodes('8943', codes), ['89431', '89413']);  // un chiffre oublié
});

test('code-barres : l\'EAN du produit donne le code article', function () {
  var r = R.codeFromBarcode('3270160894314', catalog);
  assert.strictEqual(r.code, '89431');
  assert.strictEqual(r.item.name, 'Pizza margherita 400g');
});

test('code-barres : carton (ITF-14) et GS1-128 contiennent l\'EAN du produit', function () {
  assert.strictEqual(R.codeFromBarcode('03270160894314', catalog).code, '89431');
  assert.strictEqual(R.codeFromBarcode('0103270160894314', catalog).code, '89431');
  assert.strictEqual(R.codeFromBarcode('(01)03270160894314', catalog).code, '89431');
});

test('code-barres : lecture fausse (clé de contrôle) ou pas un EAN → refusé', function () {
  assert.strictEqual(R.codeFromBarcode('3270160894315', catalog), null);
  assert.strictEqual(R.codeFromBarcode('abc', catalog), null);
  assert.strictEqual(R.codeFromBarcode('', catalog), null);
  assert.strictEqual(R.validEan('3270160894314'), true);
});

test('code-barres : EAN Picard absent du catalogue → code déduit, sans article', function () {
  // 327016 + 099998 + clé : référence 99998, inconnue du catalogue
  var ean = '327016099998';
  var sum = 0;
  for (var i = 0; i < 12; i++) sum += Number(ean[i]) * (i % 2 ? 3 : 1);
  ean += (10 - sum % 10) % 10;
  var r = R.codeFromBarcode(ean, catalog);
  assert.strictEqual(r.code, '99998');
  assert.strictEqual(r.item, null);
});

test('le catalogue connaît la photo de la boîte des articles', function () {
  assert.strictEqual(catalog.byCode['89431'].image, '000000000000089431_P.png');
  var withImage = catalog.items.filter(function (i) { return i.image; }).length;
  assert.ok(withImage > 1000, withImage + ' articles avec image');
});

test('code-barres : EAN valide d\'une autre marque → l\'EAN sert de code, sans article', function () {
  var r = R.codeFromBarcode('4006381333931', catalog);
  assert.strictEqual(r.code, '4006381333931');
  assert.strictEqual(r.item, null);
  assert.strictEqual(R.codeFromBarcode('04006381333931', catalog).code, '4006381333931', 'carton : on garde l\'EAN du produit');
});

test('code-barres : un article du catalogue perso est retrouvé par son EAN', function () {
  var perso = R.createCatalog([['45678', 'Gâteau perso', '4006381333931']]);
  var r = R.codeFromBarcode('4006381333931', perso);
  assert.strictEqual(r.code, '45678');
  assert.strictEqual(r.item.name, 'Gâteau perso');
});

test('code-barres : tous les articles du catalogue se retrouvent par leur EAN', function () {
  var checked = 0;
  catalog.items.forEach(function (item) {
    if (!item.ean || !R.validEan(item.ean)) return;
    checked++;
    assert.strictEqual(R.codeFromBarcode(item.ean, catalog).code, item.code, item.code + ' ' + item.ean);
  });
  assert.ok(checked > 1400, checked + ' articles vérifiés');
});

test('rapidité de la recherche dans le catalogue', function () {
  var t = Date.now();
  for (var i = 0; i < 20; i++) R.parsePointage('poêlée de légumes du soleil deux cartons', catalog);
  var ms = (Date.now() - t) / 20;
  assert.ok(ms < 150, ms + ' ms par recherche');
  console.log('     (' + ms.toFixed(1) + ' ms par recherche sur le PC)');
});

if (failures) { console.log('\n' + failures + ' test(s) en échec'); process.exit(1); }
console.log('\nTous les tests passent.');

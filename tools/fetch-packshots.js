// Vérifie, pour chaque article de tools/fiches.json, si le site de Picard a la photo de la boîte
// (« 000000000000089431_P.png », le packshot sur fond blanc) et le note dans fiches.json (champ packshot,
// '' si elle n'existe pas). Reprend là où il s'est arrêté. Lancer avec : node tools/fetch-packshots.js
// (à lancer après tools/fetch-fiches.js, qui fournit les références).
'use strict';
var fs = require('fs');
var path = require('path');

var FICHES = path.join(__dirname, 'fiches.json');
var BASE = 'https://www.picard.fr/dw/image/v2/AAHV_PRD/on/demandware.static/-/Sites-catalog-picard/default/produits/';
var HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36' };
var DELAY_MS = 300;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  var fiches = JSON.parse(fs.readFileSync(FICHES, 'utf8'));
  var todo = Object.keys(fiches).filter(function (c) { return fiches[c].ref && fiches[c].packshot === undefined; });
  console.log(todo.length + ' articles à vérifier');

  var done = 0;
  var failed = 0;
  for (var i = 0; i < todo.length; i++) {
    var code = todo[i];
    var file = ('000000000000000000' + fiches[code].ref).slice(-18) + '_P.png';
    try {
      var res = await fetch(BASE + file + '?sh=40', { method: 'HEAD', headers: HEADERS });
      if (res.status === 200) fiches[code].packshot = file;
      else if (res.status === 404) fiches[code].packshot = '';
      else throw new Error('HTTP ' + res.status);
      done++;
    } catch (e) {
      failed++;
      console.error(code + ' : ' + e.message);
      if (failed >= 20) { console.error('Trop d\'échecs, arrêt.'); break; }
      await sleep(5000);
    }
    if (done % 50 === 0) fs.writeFileSync(FICHES, JSON.stringify(fiches, null, 1));
    if (done % 200 === 0 && done) console.log(done + ' / ' + todo.length);
    await sleep(DELAY_MS);
  }
  fs.writeFileSync(FICHES, JSON.stringify(fiches, null, 1));
  var withShot = Object.keys(fiches).filter(function (c) { return fiches[c].packshot; }).length;
  console.log('Terminé : ' + done + ' vérifiés, ' + failed + ' échecs, ' + withShot + ' articles avec la photo de la boîte.');
}

main().catch(function (e) { console.error('Échec : ' + e.message); process.exit(1); });

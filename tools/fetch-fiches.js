// Visite les fiches produit de picard.fr (celles du plan du site) et garde pour chaque article
// sa référence officielle, son nom complet, son code-barres (EAN-13) et le nom de son image dans tools/fiches.json.
// Reprend là où il s'est arrêté (le fichier sert de cache) et attend entre deux fiches.
// Lancer avec : node tools/fetch-fiches.js [nombre-max-de-fiches]
'use strict';
var fs = require('fs');
var path = require('path');

var SITEMAP = 'https://www.picard.fr/sitemap_0.xml';
var OUT = path.join(__dirname, 'fiches.json');
var DELAY_MS = 1000;
var HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36' };
var limit = parseInt(process.argv[2], 10) || Infinity;

var NAMED = { amp: '&', quot: '"', nbsp: ' ', rsquo: "'", lsquo: "'", oelig: 'œ', OElig: 'Œ', reg: '®', deg: '°' };
var ACCENT = { acute: '́', grave: '̀', circ: '̂', uml: '̈', cedil: '̧' };

function decode(text) {
  return text
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    // &eacute; &Ucirc; &ccedil;… : la lettre puis son accent, recomposés en un seul caractère
    .replace(/&([A-Za-z])(acute|grave|circ|uml|cedil);/g, function (_, l, a) { return (l + ACCENT[a]).normalize('NFC'); })
    .replace(/&([A-Za-z]+);/g, function (all, n) { return Object.prototype.hasOwnProperty.call(NAMED, n) ? NAMED[n] : all; })
    .replace(/\s+/g, ' ').trim();
}

module.exports = { decode: decode, parseFiche: parseFiche };

// Une fiche → { ref, name, ean } (champ absent si introuvable).
function parseFiche(html) {
  var ref = /Ref:\s*(\d+)/.exec(html);
  var ean = /gtin13"\s+content="(\d{8,14})"/.exec(html);
  var name = /<h1[^>]*pi-ProductPage-title[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  var out = {};
  if (ref) out.ref = ref[1];
  if (name) out.name = decode(name[1].replace(/<[^>]+>/g, ' '));
  if (ean) out.ean = ean[1];
  // Image du produit : chemin sous /produits/ (« 000000000000089431_E_.jpg »), '' si la fiche n'en a pas.
  var image = /property="og:image"\s+content="[^"]*\/produits\/([^"?]+)/.exec(html);
  out.image = image ? image[1] : '';
  return out;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  var cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  var res = await fetch(SITEMAP, { headers: HEADERS });
  if (!res.ok) throw new Error('Plan du site : HTTP ' + res.status);
  var xml = await res.text();

  var re = /<loc>(https:\/\/www\.picard\.fr\/produits\/[a-z0-9-]+-0*(\d{4,6})\.html)<\/loc>/g;
  var todo = [];
  var m;
  // À visiter : les fiches jamais lues, et celles lues avant l'ajout de l'image.
  while ((m = re.exec(xml))) if (!cache[m[2]] || cache[m[2]].image === undefined) todo.push({ code: m[2], url: m[1] });
  console.log(todo.length + ' fiches à visiter (' + Object.keys(cache).length + ' déjà en cache)');

  var done = 0;
  var failed = 0;
  for (var i = 0; i < todo.length && done < limit; i++) {
    try {
      var page = await fetch(todo[i].url, { headers: HEADERS });
      if (!page.ok) throw new Error('HTTP ' + page.status);
      cache[todo[i].code] = parseFiche(await page.text());
      done++;
    } catch (e) {
      failed++;
      console.error(todo[i].code + ' : ' + e.message);
      if (failed >= 20) { console.error('Trop d\'échecs, arrêt.'); break; }
      await sleep(5000);
    }
    if (done % 25 === 0) fs.writeFileSync(OUT, JSON.stringify(cache, null, 1));
    if (done % 100 === 0 && done) console.log(done + ' / ' + todo.length);
    await sleep(DELAY_MS);
  }
  fs.writeFileSync(OUT, JSON.stringify(cache, null, 1));
  console.log('Terminé : ' + done + ' fiches lues, ' + failed + ' échecs, ' + Object.keys(cache).length + ' en cache.');
}

module.exports = { decode: decode, parseFiche: parseFiche };

if (require.main === module) main().catch(function (e) { console.error('Échec : ' + e.message); process.exit(1); });

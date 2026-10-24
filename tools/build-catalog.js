// Construit catalog.js à partir du plan du site picard.fr (sitemap public).
// Les adresses des fiches produit contiennent le code article :
//   /produits/pizza-margherita-400g-000000000000089431.html → 89431 « Pizza margherita 400g »
// Lancer avec : node tools/build-catalog.js
'use strict';
var fs = require('fs');
var path = require('path');

var SITEMAP = 'https://www.picard.fr/sitemap_0.xml';
var OUT = path.join(__dirname, '..', 'catalog.js');
var WORDS_OUT = path.join(__dirname, 'words.txt');

// Les adresses n'ont pas d'accents : on les remet sur les mots courants.
var ACCENTS = require('./accents.json');

function prettyName(slug) {
  var words = slug.split('-').filter(Boolean).map(function (w) {
    return Object.prototype.hasOwnProperty.call(ACCENTS, w) ? ACCENTS[w] : w;
  });
  var text = words.join(' ')
    .replace(/\b(\d+) (\d+)(g|kg|cl|ml|l)\b/g, '$1,$2$3')
    .replace(/\bd (?=[aeiouyhéèêâîôû])/g, 'd\'')
    .replace(/\bl (?=[aeiouyhéèêâîôû])/g, 'l\'');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

fetch(SITEMAP, { headers: { 'User-Agent': 'reassort-perso/1.0' } })
  .then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  })
  .then(function (xml) {
    var re = /\/produits\/([a-z0-9-]+)-0*(\d{4,6})\.html<\/loc>/g;
    var byCode = {};
    var wordCount = {};
    var m;
    while ((m = re.exec(xml))) {
      byCode[m[2]] = prettyName(m[1]);
      m[1].split('-').forEach(function (w) { wordCount[w] = (wordCount[w] || 0) + 1; });
    }
    var codes = Object.keys(byCode).sort();
    var lengths = {};
    codes.forEach(function (c) { lengths[c.length] = (lengths[c.length] || 0) + 1; });

    var lines = codes.map(function (c) { return '  [' + JSON.stringify(c) + ', ' + JSON.stringify(byCode[c]) + ']'; });
    fs.writeFileSync(OUT,
      '// Généré par tools/build-catalog.js le ' + new Date().toISOString().slice(0, 10) +
      ' depuis le plan du site picard.fr. Ne pas modifier à la main.\n' +
      'window.CATALOG = [\n' + lines.join(',\n') + '\n];\n');

    // Mots sans accents les plus fréquents, pour compléter accents.json.
    var words = Object.keys(wordCount)
      .filter(function (w) { return !/\d/.test(w) && !ACCENTS[w]; })
      .sort(function (a, b) { return wordCount[b] - wordCount[a]; });
    fs.writeFileSync(WORDS_OUT, words.map(function (w) { return wordCount[w] + ' ' + w; }).join('\n'));

    console.log(codes.length + ' articles écrits dans catalog.js');
    console.log('Longueur des codes : ' + JSON.stringify(lengths));
  })
  .catch(function (e) {
    console.error('Échec : ' + e.message);
    process.exit(1);
  });

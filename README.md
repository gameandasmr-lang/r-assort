# Réassort

Petite application web (installable sur le téléphone) pour le réassort :

1. **Pointage** : en passant en rayon, on dicte ce qu'on sort de la chambre
   (« nems au poulet, un demi », « croissants, on sort pas », « code 12345, deux cartons »).
2. **Déballage** : devant le roll, on demande « on sort les nems ? » et l'app répond à voix haute
   OUI / NON / PAS NOTÉ, avec la quantité et ce qui reste à déballer.
3. **Liste** : tout ce qui a été pointé, quantités modifiables (− / +), renommer en touchant le nom.
4. **Test** : l'app affiche un code au hasard, on le lit, elle compte combien sont bien compris.

Les données restent sur le téléphone (stockage du navigateur). « Nouveau réassort » vide la liste.

## Catalogue

`catalog.js` contient les articles du site picard.fr avec leur code article (tiré de l'adresse
des fiches produit : `pizza-margherita-400g-000000000000089431` → 89431). Pour le mettre à jour :

```
node tools/build-catalog.js
```

Les noms viennent des adresses (sans accents à l'origine) : `tools/accents.json` remet les accents
sur les mots courants. Un article absent du site peut être ajouté depuis l'app (toucher son nom
dans la liste) ; il est retenu sur le téléphone.

Les codes se suivent de près (89421, 89422, 89423…) : un chiffre mal entendu donne souvent un
autre article qui existe. C'est pour ça que l'app affiche et lit toujours le nom de l'article.

## Fichiers

- `catalog.js` : catalogue généré (code, nom).
- `logic.js` : compréhension des phrases (quantités, négations, codes) et recherche des articles.
- `app.js` : interface, micro (reconnaissance vocale de Chrome), voix, liste.
- `index.html`, `style.css`, `manifest.webmanifest`, `sw.js`, icônes : l'application installable.
- `tests/logic.test.js` : tests de la logique — `node tests/logic.test.js`.

## Essayer sur le PC

```
python -m http.server 8765
```
puis ouvrir http://localhost:8765 dans Chrome.

## Sur le téléphone

Le micro n'est autorisé que sur un site en **https**. Il faut donc héberger le dossier
(par ex. GitHub Pages), ouvrir l'adresse dans Chrome sur le Pixel, puis
menu ⋮ → « Ajouter à l'écran d'accueil ».

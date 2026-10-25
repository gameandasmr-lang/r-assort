# Réassort

Application web (installable sur le téléphone) pour le réassort chez Picard.

**En ligne : https://gameandasmr-lang.github.io/r-assort/**
(dépôt : https://github.com/gameandasmr-lang/r-assort — GitHub a transformé « réassort » en « r-assort »)

## Le besoin

Au réassort, on regarde sur la tablette le stock de la chambre froide, on passe en rayon, et on
pointe ce qu'on sort (en cartons pleins ou en demis). Ensuite on sort un roll de cartons en vrac :
à l'ouverture d'un carton, on doute souvent de ce qui devait sortir, et retrouver l'article sur la
tablette en tapant le code prend du temps. Le but : ne pas créer d'écart entre la tablette et le réel.

## Ce que fait l'app

1. **Pointage** : on dit (ou on tape au pavé) le code ou le nom de l'article et la quantité :
   « 89431, deux cartons », « poêlée sarladaise, un demi », « 89431, on sort pas ».
   L'app affiche **le code et le nom** de l'article et lit le nom à voix haute pour confirmer.
   S'il y a plusieurs articles possibles, ou un code inconnu, elle propose de choisir à l'écran.
2. **Déballage** : devant un carton, on dit son code ou son nom. L'app répond à voix haute
   **OUI** (avec la quantité pointée), **NON** ou **PAS NOTÉ**. C'est une simple **indication** : aucun
   bouton d'action, aucun décompte (la tablette Picard garde le stock, l'app ne sert qu'à se souvenir de ce qu'on a
   sorti de la chambre froide).
3. **Liste** : tout le pointage, quantités modifiables (− / +). « + Ajouter un article » ajoute à la main un
   article absent du catalogue (code et nom ; le code est retenu pour les prochaines fois). Toucher un article permet de
   corriger son code ou son nom ; la correction est retenue sur le téléphone (catalogue perso).
4. **Test** : un code au hasard s'affiche, on le lit, l'app compte les réussites et garde les ratés
   (ce qu'elle a entendu), pour améliorer la reconnaissance.

Pointage et Déballage ont un sélecteur **🎤 Voix / 🔢 Pavé / 📷 Scan**. Au scan, la caméra arrière lit le
code-barres (EAN du produit, ou de son carton) : au déballage la réponse OUI / NON / PAS NOTÉ vient tout de
suite et le scan continue ; au pointage, l'article s'affiche puis on touche la quantité. La caméra ne tourne que
dans un écran en mode scan. Un code-barres valide mais absent du catalogue (nouveau produit Picard, autre
marque) devient un article à pointer ; au pointage, « ✎ Donner un nom » le nomme, et le code-barres est retenu
avec le nom (catalogue perso du téléphone) pour les scans suivants. Au pavé : 5 chiffres puis la quantité
au pointage ; au déballage la réponse vient dès le 5e chiffre.

Les données restent sur le téléphone (stockage du navigateur). « Nouveau réassort » vide la liste.

## Où on en est (24/10/2026)

- L'app est en ligne et installée sur le Pixel (Chrome → ⋮ → Ajouter à l'écran d'accueil).
- Reconnaissance vocale « pas folle » : **dire le nom marche mieux que dire le code**.
  Premier test des codes sur PC : environ 4/8. En disant « 89 431 », la reconnaissance avale
  parfois un chiffre → l'app propose maintenant les codes à un chiffre près.
- Certains codes du catalogue semblent faux ou mal nommés (à confirmer avec des exemples).
- Catalogue enrichi (24/10) : chaque article a maintenant son **code-barres (EAN-13)** et le **nom complet de sa fiche** (`tools/fiches.json`). Pas encore utilisés par l'app.
- Les 32 codes à 4 chiffres (ex. 2277, référence du site `002277`) sont à vérifier : comment la tablette les affiche-t-elle ? Le pavé attend 5 chiffres.

## Pistes pour la suite

- **Tester le mode 📷 Scan en magasin** (testé le 24/10 sur le Pixel avec un code-barres affiché sur un écran de PC : lecture correcte ; pas encore essayé sur un vrai carton) : le code-barres d'un carton est-il celui du produit (EAN), ou un code logistique ? Si ce n'est ni l'un ni l'autre, noter ce que la caméra lit (message « Code-barres non reconnu : … ») et adapter `codeFromBarcode` dans `logic.js`. Le lecteur intégré à Chrome (`BarcodeDetector`) n'existe pas sur PC Windows : le scan se teste sur le Pixel.
- **Vraie application Android (APK)**, si les demandes d'autorisation (micro, caméra) restent gênantes : le même code emballé avec Capacitor, permission demandée une seule fois, lecteur ML Kit de Google plus fiable. Contrepartie : Android Studio sur le PC, et un nouvel APK à chaque mise à jour (plus de simple `git push`). À décider après le test en magasin.
- Reconnaître un article sans code-barres à partir de sa photo : bien plus dur (emballages semblables), service payant probable, en réserve.
- Utiliser le **nom complet de la fiche** comme second nom de recherche à la voix.
- **Corriger le catalogue** avec des photos d'étiquettes de rayon (code + nom) : les lire, comparer
  avec `catalog.js`, lister les différences, puis corriger (ajouter un fichier de corrections fusionné
  par `tools/build-catalog.js`, pour qu'une mise à jour du site ne les écrase pas).
- **Noms tels qu'on les dit en magasin** : la voix marche mieux par le nom, donc améliorer les noms
  (abréviations des adresses du site : « chev », « framb »…, voir `tools/accents.json`).
- Exporter le catalogue perso du téléphone (bouton « copier mes corrections ») pour l'intégrer ici.
- Si la voix reste trop imprécise : reconnaissance plus puissante via un service payant
  (Claude ne fait pas de reconnaissance vocale ; ce serait un service dédié, à quelques centimes).

## Catalogue

`catalog.js` contient les ~1 557 articles du site picard.fr avec leur code article, tiré de
l'adresse des fiches produit (`pizza-margherita-400g-000000000000089431` → 89431), via le plan du
site public (sitemap). Les noms n'y ont pas d'accents : `tools/accents.json` les remet sur les mots
courants. Les articles vendus en magasin mais absents du site manquent.

Chaque ligne du catalogue est `[code, nom, code-barres, nom complet de la fiche, photo de la boîte]`. Les trois derniers viennent de `tools/fiches.json`, lu sur les fiches produit du site par `npm run fiches` (environ 26 minutes, une fiche par seconde, reprend où il s'est arrêté) ; `npm run catalogue` les fusionne. 1 556 fiches lues, 27 sans code-barres affiché, 1 335 avec la photo de la boîte.

**Images** : la photo de la **boîte** (le « packshot » `000000000000089431_P.png`, pas la photo d'ambiance du plat) est repérée par `tools/fetch-packshots.js` (environ 10 minutes) ; 219 articles n'en ont pas chez Picard et n'ont donc pas d'image. L'app affiche une miniature (liste, pointage, déballage) chargée depuis le site de Picard à l'affichage (`?sh=160`, environ 15 Ko), jamais copiée dans ce dépôt ; toucher la miniature l'ouvre en grand (`?sh=700`, chargée à ce moment-là). Sans réseau ou si l'image n'existe plus, elle disparaît sans erreur. Le service worker ne met pas ces images en cache (cela gonflerait le stockage du téléphone). La référence du site est le code sur 6 chiffres (`089431`) : notre code est la même chose sans le zéro de tête.

Les codes se suivent de près (89421, 89422, 89423…) : un chiffre mal entendu donne souvent un autre
article qui existe. C'est pour ça que l'app affiche et lit toujours le nom de l'article.

## Travailler dessus (sur n'importe quel PC)

Il faut **git**, **Node.js** (pour les tests et le catalogue) et **Python** (pour le serveur local).

```
git clone https://github.com/gameandasmr-lang/r-assort.git
cd r-assort
npm install          # installe jsdom pour les tests d'interface
npm test             # tests de la logique + tests de l'interface simulée
npm run serve        # puis ouvrir http://localhost:8765 dans Chrome
npm run catalogue    # régénère catalog.js depuis picard.fr
```

**Mettre en ligne une modification** : `git add -A`, `git commit -m "…"`, `git push`.
GitHub Pages republie en une minute ; le téléphone récupère la nouvelle version à la prochaine
ouverture (avec du réseau). Penser à changer le numéro de `CACHE` dans `sw.js` **et** `APP_VERSION` dans `app.js`
à chaque version (un test vérifie qu'ils vont ensemble). La version en cours s'affiche en bas de l'écran du téléphone :
c'est le moyen de savoir si la mise à jour est arrivée. Depuis la v12, le service worker interroge toujours le
serveur (GitHub Pages garde sinon les fichiers 10 minutes) et l'app se recharge seule quand une nouvelle version
s'active ; la v12 elle-même doit d'abord être récupérée (voir ci-dessous si le téléphone reste sur une ancienne version).

## Fichiers

- `index.html`, `style.css` : l'interface.
- `app.js` : onglets, micro (reconnaissance vocale de Chrome), voix, pavé, scan, liste, test.
- `scanner.js` : caméra et lecture des codes-barres (`BarcodeDetector`), sans rien savoir du catalogue.
- `logic.js` : compréhension des phrases (codes dictés de toutes les façons, quantités, négations),
  recherche dans le catalogue et dans le pointage. Sans DOM, testable avec Node.
- `catalog.js` : catalogue généré (code, nom). Ne pas modifier à la main.
- `manifest.webmanifest`, `sw.js`, `icon-*.png` : application installable, fonctionne hors ligne.
- `tools/build-catalog.js`, `tools/accents.json` : génération du catalogue.
- `tools/fetch-fiches.js`, `tools/fiches.json` : lecture des fiches produit (référence, nom complet, EAN).
- `tests/logic.test.js` : tests de la logique sur le vrai catalogue.
- `tests/ui.test.js` : tests de l'interface dans un navigateur simulé (micro et voix simulés).

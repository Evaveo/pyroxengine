import { deEsm } from './engine-env.mjs';
// UNE ICÔNE QUI N'EXISTE PAS NE FAIT PAS DE BRUIT — elle rend un carré vide.
//
// POURQUOI CE TEST EXISTE. Un nom d'icône est une chaîne libre qui part dans une classe CSS.
// `ph-arrows-out-cardinal` mal orthographié ne lève rien, ne journalise rien : la fonte n'a
// pas ce glyphe, le navigateur affiche du vide, et on ne le voit qu'en ouvrant la page — ce
// qu'aucun test ne fait ici (le harnais n'a pas de moteur de rendu). La garde compare donc
// les noms ÉCRITS dans js/ à ceux que la fonte vendorée déclare vraiment.
//
// Elle garde aussi le vendoring lui-même : la maquette Claude Design chargeait Phosphor
// depuis unpkg, et une icône servie par un CDN est une icône qui disparaît hors ligne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => deEsm(fs.readFileSync(path.join(root, p), 'utf8'));

const PHOSPHOR = 'vendor/phosphor/phosphor.css';

// ---------- Le vendoring ----------

test('les fichiers de la fonte sont DANS le depot', () => {
  ['vendor/phosphor/phosphor.css', 'vendor/phosphor/Phosphor.woff2',
   'vendor/phosphor/Phosphor-Fill.woff2', 'vendor/phosphor/LICENSE'].forEach((f) => {
    assert.ok(fs.existsSync(path.join(root, f)), 'absent du depot : ' + f);
  });
});

test('la feuille de la fonte ne reclame QUE les deux woff2 vendores', () => {
  const src = lire(PHOSPHOR);
  // Chaque `url(...)` d'un @font-face doit designer un fichier present a cote. L'amont
  // declarait aussi .woff, .ttf et .svg : les laisser ferait trois 404 par graisse.
  const urls = [...src.matchAll(/url\("\.\/([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(urls.sort(), ['Phosphor-Fill.woff2', 'Phosphor.woff2']);
});

test('aucune page ne charge une icone depuis un CDN', () => {
  const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
  const fautes = [];
  pages.forEach((page) => {
    const html = lire(page);
    [...html.matchAll(/<link[^>]+href="(https?:\/\/[^"]+)"/g)].forEach((m) => {
      if(/phosphor|icon/i.test(m[1])) fautes.push(page + ' -> ' + m[1]);
    });
  });
  assert.deepEqual(fautes, [], 'icones servies par un CDN : ' + fautes.join(', '));
});

test('editor.html charge la feuille de la fonte', () => {
  assert.ok(lire('editor.html').indexOf(PHOSPHOR) !== -1,
    'editor.html ne charge pas ' + PHOSPHOR + ' : toutes les icones seront vides');
});

test('la feuille de la fonte n ecrit aucune couleur — sinon elle devrait vivre dans css/', () => {
  // Un glyphe prend `currentColor`. C'est ce qui autorise cette feuille a vivre hors de css/,
  // ou test/tokens-css.test.mjs interdit les couleurs : si elle en ecrivait une, elle
  // echapperait a cette garde-la sans que personne ne le voie.
  const code = lire(PHOSPHOR).replace(/\/\*[\s\S]*?\*\//g, ' ');
  const couleurs = [...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  assert.deepEqual(couleurs, []);
});

// ---------- Les noms employes ----------

function glyphesDeLaFonte(){
  const src = lire(PHOSPHOR);
  const noms = new Set();
  for(const m of src.matchAll(/\.ph-([a-z0-9-]+):before/g)) noms.add(m[1]);
  return noms;
}

function fichiersJs(dir, out){
  fs.readdirSync(path.join(root, dir), {withFileTypes: true}).forEach((e) => {
    const rel = dir + '/' + e.name;
    if(e.isDirectory()) fichiersJs(rel, out);
    else if(e.name.endsWith('.js')) out.push(rel);
  });
  return out;
}

test('la fonte declare bien des glyphes — sinon la garde suivante ne mesure rien', () => {
  assert.ok(glyphesDeLaFonte().size > 500, 'la feuille vendoree semble tronquee');
});

test('TOUT nom d icone ecrit dans js/ existe dans la fonte', () => {
  const connus = glyphesDeLaFonte();
  const fautes = [];
  fichiersJs('js', []).forEach((f) => {
    const src = lire(f);
    // Les trois portes d'entree du module, et elles seules : ecrire `ph-xxx` a la main dans
    // du markup echappe a cette garde — c'est precisement ce que le module existe pour eviter.
    for(const m of src.matchAll(/Icons\.(?:html|el|className)\(\s*'([^']+)'/g)){
      if(!connus.has(m[1])) fautes.push(f + " : '" + m[1] + "'");
    }
  });
  assert.deepEqual(fautes, [], 'icones inexistantes — elles rendront du vide :\n' + fautes.join('\n'));
});

test('TOUT nom d icone ecrit dans une PAGE existe aussi dans la fonte', () => {
  // Le markup statique n'appelle pas js/ui/icon.js : il écrit `class="ph ph-play"` en clair.
  // Sans cette garde, une faute de frappe dans editor.html échapperait entièrement au test
  // précédent — et c'est là que se trouvent les icônes de la barre du haut, celles qu'on voit
  // en premier.
  const connus = glyphesDeLaFonte();
  const familles = new Set(['fill', 'bold', 'duotone', 'light', 'thin']);
  const fautes = [];
  fs.readdirSync(root).filter((f) => f.endsWith('.html')).forEach((page) => {
    for(const attr of lire(page).matchAll(/class="([^"]*\bph[- ][^"]*)"/g)){
      attr[1].split(/\s+/).forEach((cls) => {
        if(cls === 'ph' || !cls.startsWith('ph-')) return;
        const nom = cls.slice(3);
        // `ph-fill` &co nomment la GRAISSE, pas un glyphe : elles n'ont pas de `:before`.
        if(familles.has(nom) || connus.has(nom)) return;
        fautes.push(page + " : '" + cls + "'");
      });
    }
  });
  assert.deepEqual(fautes, [], 'icones inexistantes dans le markup :\n' + fautes.join('\n'));
});

// ---------- Le module lui-meme ----------

// `js/ui/icon.js` est un script classique (pas un module ES) : il se pose sur globalThis.
// On l'evalue dans une fonction pour recuperer `Icons` sans navigateur ni dependance npm.
function chargerIcons(){
  const src = lire('js/ui/icon.js');
  return new Function(src + '; return Icons;')();
}

test('le markup porte la famille ET le glyphe — une seule des deux ne rend rien', () => {
  const Icons = chargerIcons();
  assert.equal(Icons.className('cube'), 'ph ph-cube');
  assert.equal(Icons.className('cube', {weight: 'fill'}), 'ph-fill ph-cube');
});

test('une icone est decorative par defaut, et annoncee des qu elle porte du sens', () => {
  const Icons = chargerIcons();
  assert.match(Icons.html('cube'), /aria-hidden="true"/);
  const avecTitre = Icons.html('cube', {title: 'Objet'});
  assert.match(avecTitre, /role="img"/);
  assert.match(avecTitre, /aria-label="Objet"/);
  assert.doesNotMatch(avecTitre, /aria-hidden/);
});

test('un titre est ECHAPPE — il vient parfois du nom d un objet de la scene', () => {
  const Icons = chargerIcons();
  const sortie = Icons.html('cube', {title: '<img src=x onerror="boum">'});
  assert.doesNotMatch(sortie, /<img/);
  assert.match(sortie, /&lt;img/);
});

test('un nom invalide LEVE au lieu de rendre du vide', () => {
  const Icons = chargerIcons();
  [' cube', 'Cube', 'cube ', 'ph cube', '', null, 42].forEach((n) => {
    assert.throws(() => Icons.className(n), /nom d'icône invalide/,
      'accepte en silence : ' + String(n));
  });
  assert.throws(() => Icons.className('cube', {weight: 'bold'}), /graisse d'icône inconnue/);
});

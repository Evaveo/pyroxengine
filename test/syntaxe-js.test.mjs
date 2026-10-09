// Tout fichier de js/ et mcp/ doit au moins SE PARSER.
//
// Ce test existe parce qu'une parenthèse manquante dans un fichier neuf est passée jusqu'au
// navigateur. Le symptôme n'était pas « erreur de syntaxe » : c'était « outil inconnu :
// capture_view ». Un `<script>` qui ne parse pas est simplement IGNORÉ par le navigateur — le reste de
// la page fonctionne, et il manque tout ce que ce fichier déclarait. On cherche alors pourquoi
// l'enregistrement n'a pas eu lieu, pas pourquoi le fichier n'a pas été lu.
//
// `lint-ordre-chargement.mjs` vérifiait l'ORDRE des fichiers, jamais leur contenu.
//
// L'outil est `node --check`, l'analyseur de noeud lui-même : il parse sans exécuter, et il connaît la
// différence entre un script classique et un module. Une première version découpait les `import` à la
// regex pour les compiler à la main — elle rendait le code invalide et accusait `protocole-mcp.mjs`
// d'une faute qu'il n'avait pas. Vérifier avec un outil approximatif fabrique de faux coupables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function lister(rel, ext, acc){
  acc = acc || [];
  for(const e of readdirSync(path.join(root, rel), {withFileTypes: true})){
    const sous = rel + '/' + e.name;
    if(e.isDirectory()) lister(sous, ext, acc);
    else if(e.name.endsWith(ext)) acc.push(sous);
  }
  return acc;
}

/** Rend le message d'erreur de syntaxe, ou `null` si le fichier parse. */
function faute(rel){
  try{
    execFileSync(process.execPath, ['--check', path.join(root, rel)], {stdio: 'pipe'});
    return null;
  } catch(e){
    const output = String((e.stderr || '') + (e.stdout || ''));
    // La ligne fautive vaut mieux que le seul message : c'est la différence entre corriger et
    // chercher.
    const utiles = output.split('\n').filter(function(l){
      return /SyntaxError|\^|^\S+:\d+/.test(l);
    }).slice(0, 3);
    return utiles.join(' | ') || output.split('\n')[0];
  }
}

test('CHAQUE script de js/ se parse — un script qui ne parse pas est IGNORE en silence', () => {
  const files = lister('js', '.js');
  assert.ok(files.length > 40, 'seulement ' + files.length + ' files trouvés — motif changé ?');
  const fautes = [];
  for(const f of files){
    const m = faute(f);
    if(m) fautes.push(f + ' : ' + m);
  }
  assert.deepEqual(fautes, [],
    'Ces fichiers ne se parsent pas. Le navigateur les IGNORERA sans un mot, et tout ce qu\'ils\n'
    + 'déclarent manquera — le symptôme sera « fonction inconnue », jamais « erreur de syntaxe ».\n'
    + fautes.join('\n'));
});

test('CHAQUE module de js/ et mcp/ se parse aussi', () => {
  const modules = lister('js', '.mjs').concat(lister('mcp', '.mjs'));
  assert.ok(modules.length >= 3, 'seulement ' + modules.length + ' modules trouvés');
  const fautes = [];
  for(const f of modules){
    const m = faute(f);
    if(m) fautes.push(f + ' : ' + m);
  }
  assert.deepEqual(fautes, [], fautes.join('\n'));
});

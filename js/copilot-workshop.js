// ---------- L'atelier du copilote : fabriquer, revenir, se souvenir ----------
//
// Quatre manques, tous constatés en essayant de faire concevoir un jeu entier :
//
//   4. IL NE POUVAIT CRÉER AUCUN PIXEL. `slice_sheet` découpe une planche existante ; sans art
//      déjà importé, « conçois-me un platformer » butait sur l'absence de la première image.
//   7. IL NE POUVAIT PAS ABANDONNER UNE PISTE. `pushHistory` est par commande : essayer une
//      approche sur dix commandes puis y renoncer demandait dix annulations, à l'aveugle.
//   8. IL REPARTAIT DE ZÉRO À CHAQUE SESSION. La scène dit ce qui EST, jamais ce qu'on VOULAIT — ni
//      les contraintes, ni ce qui a déjà été essayé et écarté.
//   9. DES PANS ENTIERS DU MOTEUR LUI ÉCHAPPAIENT : caméra 2D, assemblage d'atlas, taille de map,
//      lumières. Tout ce qui avait été livré récemment était hors de sa portée.

// ---------- 4. Fabriquer des pixels ----------

import { assets, newAssetScript, createAssetAnimation, createAssetData, createAssetSprite, folderCurrent, createAssetTexture, replaceContentAssetTexture, importFiles, moveAssetTo, newClipId, previewObject3D, removeAsset, removeClipAssetsOfModel, setFolderCurrent, takesOfModel, updateProject } from './assets.js';
import { describePivot, explicitPivotParams, mergeReplacedParams, modelRootsIn, reconcileClips, transferModelContent } from './model-replace.js';
import { cloneModel } from './anim-models.js';
import { applyComponents } from './component-migration.js';
import { ShadowFit } from './shadow-fit.js';
import { busOfSource } from './audio-bus.js';
import { validateFalloffAudio } from './audio-falloff.js';
import { applyKindDefaultsAudio, createAssetAudio, createAssetLoop, createAssetSfx, ensureAudio, freeAudioFileName, playSoundGlobal, setLoopRecipe, setProjectBusVolumes, setSfxRecipe } from './audio.js';
import { describeSfx, mergeSfx, mutateSfx, presetSfx, validateSfx } from './chip-synth.js';
import { isPlayableAudio } from './component-data.js';
import { describeLoop, mergeLoop, presetLoop, retuneLoop, validateLoop } from './music-loop.js';
import { rebuildTilemap } from './components/component-tilemap.js';
import { kindProjectADate } from './copilot-observer.js';
import { CopilotTools } from './copilot.js';
import { pushHistory, restoreState, stateCurrent } from './history.js';
import { enforceScriptAssets } from './script-asset-lint.js';
import { syncScriptVarsOfAsset } from './scripts.js';
import { auditProject, formatAudit, formatGraveIssues, isGenericName } from './project-audit.js';
import { assetFingerprint, changedSinceValidation, isValidated, ruleMessage, violationCounts } from './ai-rules.js';
import { askInPage } from './mcp-link.js';
import { propMaterialByKey, validatePropMaterial } from './material-props.js';
import { applyMaterialEverywhere, createAssetMaterial } from './materials.js';
import { applyImportModel, ensureParamsImport, rebuildInstancesStructure, refreshSpritesOfLAsset } from './import-settings.js';
import { buildInspector } from './inspector.js';
import { exposeModelInstance, objects, isSceneObject } from './objects.js';
import { SOUND_PROC_SR, makeSoundProc, validateSoundProc } from './proc-sound.js';
import { makeTextureProc, validateTextureProc } from './proc-texture.js';
import { packIsoSheet, renderIsoModel } from './iso-sprite.js';
import { projectNetworkSettings } from './project-settings.js';
import { writeAssetInFolder } from './project-folder.js';
import { project } from './project.js';
import { findRefs, registerInProjectOpen, serializeComponentsOf, slugFile } from './serialization.js';
import { assembleAtlasSprite } from './sprite-atlas-ui.js';
import { validateAtlas } from './sprite-atlas.js';
import { loop, mode } from './viewport.js';
import { addSpriteToPalette } from './tile-palette.js';
import { invalidateTilemapsOfPalette } from './palette-ui.js';

/** Une toile de pixels (js/proc-texture.js) posée sur un canvas, puis en fichier PNG. */
export function canvasToFile(t, name){
  const cv = document.createElement('canvas');
  cv.width = t.l; cv.height = t.h;
  const cx = cv.getContext('2d');
  cx.putImageData(new ImageData(t.px, t.l, t.h), 0, 0);
  return new Promise(function(res, rej){
    cv.toBlob(function(blob){
      if(!blob){ rej(new Error('le PNG n\'a pas pu être produit')); return; }
      res(new File([blob], slugFile(name) + '.png', {type: 'image/png'}));
    }, 'image/png');
  });
}

/**
 * Crée un asset de texture procédurale, et la planche de sprite qui la découpe s'il y a lieu.
 *
 * Rend `{texture, planche}`. La planche n'est créée que pour les genres qui ont une grille — une
 * planche de tuiles, une planche de personnage : c'est elle que les composants 2D consomment, et la
 * créer d'office économise un aller-retour à chaque fois.
 */
export async function createTextureProc(d){
  const soucis = validateTextureProc(d);
  if(soucis.length) throw new Error(soucis.join(' '));
  const t = makeTextureProc(d);
  if(!t) throw new Error('la texture n\'a pas pu être fabriquée');
  const name = String(d.name || d.kind);
  const file = await canvasToFile(t, name);
  const tex = createAssetTexture(file, {name: name});
  // Au plus proche et sans mipmaps : un substitut de pixel-art lissé n'a plus de bords nets, et
  // l'auteur croirait que son import est bad.
  const p = ensureParamsImport(tex);
  if(p){ p.filtrage = 'near'; p.mipmaps = false; }

  let sheet = null;
  if(d.kind === 'tuiles16' || d.kind === 'character'){
    // La texture arrive de façon asynchrone (TextureLoader) : la découpe a besoin de ses dimensions,
    // qu'on connaît déjà — on ne les attend donc pas, on les donne.
    const cell = (d.kind === 'tuiles16') ? Math.round(t.l / 4) : Math.round(t.h);
    sheet = createAssetSprite(tex, name);
    sheet.regions = sliceGrid(t.l, t.h, cell, cell, {margin: 0, spacing: 0});
    sheet.ppu = cell;
    updateProject();
  }
  return {texture: tex, sheet: sheet, canvas: t};
}

/**
 * Crée un asset audio depuis un bruitage fabriqué.
 *
 * Factorisée hors de la commande pour que le BOUTON et l'IA passent par le MÊME chemin. Deux
 * chemins qui fabriquent le même genre de son finiraient par ne plus produire le même fichier, et
 * la divergence ne s'entendrait qu'après coup, sur un mélange qu'on croyait réglé.
 * `createTextureProc` l'était déjà : ceci comble l'asymétrie.
 */
export function createSoundProc(d){
  const soucis = validateSoundProc(d);
  if(soucis.length) throw new Error(soucis.join(' '));
  const wav = makeSoundProc(d);
  if(!wav) throw new Error('le son n\'a pas pu être fabriqué');
  // ⚠ CE PAS D'HISTORIQUE NE REND PAS L'ASSET ANNULABLE. `stateCurrent()` photographie la scène —
  // objets, pistes, environnement — et PAS la liste des assets : Ctrl+Z laissera le son en place.
  // Il est conservé pour rester identique aux autres commandes, et parce qu'une commande peut être
  // suivie d'une autre qui, elle, touche la scène. Le fait est dit dans l'aide plutôt que masqué :
  // on retire un asset par la croix de sa tile, dans le panneau Projet.
  pushHistory();
  const name = String(d.name || d.kind);
  // Un nom LIBRE : deux « saut » de suite écrasaient le premier fichier sur le disque.
  const asset = createAssetAudio(new File([wav], freeAudioFileName(folderCurrent, slugFile(name), '.wav'), {type: 'audio/wav'}),
                                {name: name});
  // La durée est relue dans les OCTETS produits, jamais dans la demande : c'est le seul chiffre qui
  // décrive le fichier réel. Une durée hors bounds est ramenée par le fabricant, sans le dire.
  return {asset: asset, wav: wav, secondes: (wav.length - 44) / 2 / SOUND_PROC_SR};
}

// ---------- 7. Points de reprise ----------
//
// `pushHistory` empile un pas d'annulation par commande. C'est juste pour un humain qui corrige
// un geste, et inutilisable pour un agent qui veut ESSAYER une approche : dix commandes plus tard, il
// faudrait dix annulations et il n'a aucun medium de savoir combien.
//
// Un point de reprise NOMMÉ est un état complet, repris d'un coup. Les instantanés vivent en mémoire
// et pas dans le projet : ce sont des brouillons de session, et les register gonflerait chaque
// fichier de projet de tentatives abandonnées.

export const resumes = new Map();

export function setPointOfResume(name){
  const n = String(name || 'defaut');
  resumes.set(n, JSON.parse(JSON.stringify(stateCurrent())));
  return n;
}

export function goBackAtPointOfResume(name){
  const n = String(name || 'defaut');
  const state = resumes.get(n);
  if(!state) return null;
  // Un pas d'annulation AVANT de revenir : sinon le retour lui-même serait irréversible, et un agent
  // qui se trompe de point de reprise aurait détruit son travail sans recours.
  pushHistory();
  restoreState(JSON.parse(JSON.stringify(state)));
  return n;
}

// ---------- 8. Le document de conception ----------
//
// La scène dit ce qui EST. Elle ne dit ni l'intention, ni les contraintes, ni ce qui a été essayé et
// écarté — or c'est exactement ce dont on a besoin pour reprendre un travail. Un agent qui rouvre un
// project sans ça redécouvre tout, et refait souvent les mêmes erreurs.
//
// Le document vit DANS le projet (`project.conception`), donc il voyage avec le `.p3d` et le dossier.
// Du texte libre : ni schéma ni champs imposés, parce qu'on ne sait pas d'avance ce qu'un jeu a besoin
// de retenir, et qu'un format trop étroit se contourne par des notes ailleurs.

export const DESIGN_MAX = 20000;   // ~5 pages : de quoi tenir une intention, pas un roman

export function readDesign(){
  return String((project && project.design) || '');
}

export function writeDesign(text, add){
  const avant = readDesign();
  let apres = add ? (avant ? avant + '\n' + String(text) : String(text)) : String(text);
  let tronque = false;
  if(apres.length > DESIGN_MAX){
    // On coupe la TÊTE et pas la queue : dans un document qu'on complète, le récent count plus que
    // l'ancien. Couper la fin perdrait ce qu'on vient d'écrire.
    apres = '…(début tronqué)…\n' + apres.slice(apres.length - DESIGN_MAX);
    tronque = true;
  }
  project.design = apres;
  return {size: apres.length, tronque: tronque};
}

// ---------- 6. Un résumé, plutôt qu'un dépotoir ----------
//
// `list_scene` rend tout. Sur un vrai projet c'est des milliers de lignes, et une map de 48 × 27
// fait 1 296 entiers à elle seule. Un agent qui commence par tout lire n'a plus de place pour
// travailler — et il le fait, parce que c'est la seule lecture qu'on lui offre.

export function summarizeScene(){
  const byType = {};
  objects.forEach(function(o){
    if(o.userData.modelNode !== undefined) return;   // compté avec son modèle
    const t = o.userData.type || '(sans type)';
    byType[t] = (byType[t] || 0) + 1;
  });
  const comp = {};
  objects.forEach(function(o){
    (o.userData.components || []).forEach(function(c){
      const n = c.constructor.typeName;
      comp[n] = (comp[n] || 0) + 1;
    });
  });
  const assetsByKind = {};
  assets.forEach(function(a){ assetsByKind[a.kind] = (assetsByKind[a.kind] || 0) + 1; });

  // Les BORNES du monde 2D : c'est la mesure qui manque le plus souvent quand une caméra montre le
  // empty, et elle tient en quatre nombres.
  let bounds = null;
  if(typeof gatherWorld2d === 'function' && typeof boundsFromObstacles2d === 'function'){
    const b = boundsFromObstacles2d(gatherWorld2d(objects).obstacles);
    if(b) bounds = [+b.xMin.toFixed(1), +b.yMin.toFixed(1), +b.xMax.toFixed(1), +b.yMax.toFixed(1)];
  }
  return {
    project: project.name,
    kind: kindProjectADate(),
    scenes: project.scenes.map(function(s){ return s.name; }),
    objects: objects.length,
    byType: byType,
    components: comp,
    assets: assetsByKind,
    boundsOfDecor2d: bounds,
    design: readDesign() ? readDesign().length + ' caractères' : 'vide',
    pointsOfResume: [...resumes.keys()]
  };
}

// ---------- Enregistrement des commandes ----------

CopilotTools.register({
  name: 'create_texture',
  description: 'FABRIQUE une image et l\'ajoute au projet, sans aucun fichier source. C\'est ce qui '
    + 'permet de construire un niveau jouable avant que l\'art existe. Genres : `tuiles16` (une '
    + 'planche de 16 tuiles prête pour l\'auto-tuilage d\'une map — le genre à utiliser pour un '
    + 'décor), `character` (des images d\'un bonhomme qui oscille, pour voir une animation jouer), '
    + '`solid`, `checker` (idéal pour juger une échelle), `gradient` (un ciel), `noise` (à graine, donc '
    + 'reproductible), `text` (un mot ou un nombre centré sur un aplat — un chiffre sur un cube, '
    + 'une étiquette sur un panneau ; la taille se règle toute seule). '
    + 'reproductible). Pour `tuiles16` et `character`, la planche de sprite est créée et découpée '
    + 'aussi : elle est utilisable immédiatement par une map de tuiles ou un animateur.',
  schema: {type: 'object', properties: {
    kind: {type: 'string', enum: ['tuiles16', 'character', 'solid', 'checker', 'gradient', 'noise', 'text']},
    name: {type: 'string', description: 'nom de l\'asset créé'},
    size: {type: 'number', description: 'tuiles16 : côté d\'une tuile en pixels (16, 32…)'},
    cell: {type: 'number', description: 'personnage : côté d\'une image en pixels'},
    images: {type: 'number', description: 'personnage : nombre d\'images (défaut 4)'},
    width: {type: 'number', description: 'unie/damier/degrade/bruit : largeur en pixels'},
    height: {type: 'number', description: 'unie/damier/degrade/bruit : hauteur en pixels'},
    color: {type: 'string', description: 'couleur principale, #rrggbb'},
    color2: {type: 'string', description: 'seconde couleur : le contour des tuiles, le bas du dégradé…'},
    thickness: {type: 'number', description: 'tuiles16 : épaisseur du contour en pixels'},
    seed: {type: 'number', description: 'bruit : la graine, pour un résultat reproductible'},
    // Le texte se met a l echelle TOUT SEUL et se centre : demander une taille de police
    // obligerait a la recalculer a chaque changement de texte, et « 2 » puis « 2048 » ne
    // peuvent pas avoir la meme taille sur une face de cube.
    text: {type: 'string', description: 'texte : ce qui est ecrit — chiffres, A-Z, espace, + - = . ! ? *'},
    margin: {type: 'number', description: 'texte : marge autour du texte, en pixels'}
  }, required: ['kind'], additionalProperties: false},
  exec: async function(a){
    pushHistory();
    const r = await createTextureProc(a);
    let txt = 'texture « ' + r.texture.name + ' » créée (' + r.canvas.l + ' × ' + r.canvas.h + ' px)';
    if(r.sheet){
      txt += ', et la planche « ' + r.sheet.name + ' » découpée en ' + r.sheet.regions.length
        + ' image(s) de ' + r.sheet.ppu + ' px';
      if(a.kind === 'tuiles16'){
        txt += '. Les 16 images suivent la convention d\'auto-tuilage : utilisez-la comme matériau '
          + 'd\'une map de tuiles, le moteur choisira l\'image tout seul.';
      }
    }
    return txt;
  }
});

// IMPORTER UNE IMAGE DONNÉE PAR L'AGENT. `create_texture` ne sait fabriquer que ses genres
// procéduraux : un agent qui dessine son propre pixel art n'avait aucun moyen de le poser dans le
// projet, et le dessinait donc dans un script, au lancement (mesuré : un jeu façon Terraria
// refaisait plusieurs centaines de canvas à chaque démarrage). L'image devient un asset texture
// ordinaire — fichier PNG sur le disque en mode dossier, retouchable, publiée avec le jeu.
export function decodePngBase64(s){
  const b64 = String(s || '').replace(/^data:image\/png;base64,/, '').replace(/\s+/g, '');
  if(!b64) throw new Error('l\'image est vide');
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // signature PNG, puis l'en-tête IHDR qui donne la taille
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if(bytes.length < 24 || sig.some(function(v, i){ return bytes[i] !== v; })) throw new Error('ce n\'est pas un PNG');
  const dv = new DataView(bytes.buffer);
  return {bytes: bytes, width: dv.getUint32(16), height: dv.getUint32(20)};
}

CopilotTools.register({
  name: 'import_image',
  description: 'IMPORTE une image PNG (base64, avec ou sans préfixe data:) comme asset texture du '
    + 'projet — c\'est ainsi qu\'on pose un pixel art qu\'on a dessiné soi-même, au lieu de le '
    + 'générer dans un script au lancement. Filtrage au plus proche, sans mipmaps (net pour le pixel '
    + 'art). Avec `cell`, une planche de sprite découpée en grille est créée aussi, utilisable par '
    + 'les composants 2D ; un script lit l\'image avec api.image(nom). `folder` range l\'asset '
    + '(défaut « Textures »). Un nom déjà pris remplace l\'image de l\'asset existant.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom de l\'asset'},
    png: {type: 'string', description: 'contenu PNG en base64'},
    folder: {type: 'string', description: 'dossier du panneau Projet (défaut « Textures »)'},
    cell: {type: 'object', properties: {l: {type: 'number'}, h: {type: 'number'}}, required: ['l', 'h'],
      description: 'taille d\'une case pour découper une planche de sprite (optionnel)'},
    // `ppu` et `replace` étaient LUS par exec mais absents du schéma : avec `additionalProperties:
    // false`, un client MCP qui valide les retirait ou refusait l'appel — le réimport découpé
    // retombait alors sur la création d'une seconde texture et d'une seconde planche.
    ppu: {type: 'number', description: 'pixels par unité de la planche (défaut : largeur de la case)'},
    replace: {type: 'boolean', description: 'remplacer en place une texture du même nom (défaut : oui) ; false crée un asset distinct'}
  }, required: ['name', 'png'], additionalProperties: false},
  exec: function(a){
    const name = String(a.name || '').trim();
    if(!name) throw new Error('le nom de l\'image est vide');
    const img = decodePngBase64(a.png);
    const folder = String(a.folder === undefined ? 'Textures' : a.folder).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if(folder.split('/').some(function(s){ return s === '..'; })) throw new Error('chemin de dossier invalide');
    const prior = assets.find(function(x){ return x.kind === 'texture' && x.name === name; });
    if(prior && isValidated(project.settings.validatedAssets, prior)){
      throw new Error('« ' + name + ' » est VALIDÉ — ' + ruleMessage('assets.validated_overwrite'));
    }
    if(a.ppu !== undefined && !(Number(a.ppu) > 0)) throw new Error('le ppu doit être positif');
    if(a.cell && !(Math.round(a.cell.l) > 0 && Math.round(a.cell.h) > 0)) throw new Error('la taille de case doit être positive');
    // REMPLACER EN PLACE EST LE DÉFAUT dès qu'une texture porte ce nom (la description l'annonce :
    // « un nom déjà pris remplace l'image »). Seul `replace:false` explicite crée un asset distinct.
    // Avant, il fallait `replace:true` — absent du schéma : un réimport AVEC `cell` d'une texture
    // déjà découpée créait une seconde texture ET une seconde planche, les objets liés gardant
    // l'ancien art.
    if(prior && a.replace !== false){
      // REMPLACEMENT EN PLACE : même asset, même id ⇒ planches, palettes et matériaux restent liés.
      pushHistory();
      const file = new File([img.bytes], slugFile(name) + '.png', {type: 'image/png'});
      // Déplacer AVANT de remplacer : l'écriture du nouveau contenu est asynchrone, et un
      // déplacement lancé pendant qu'elle court laissait une copie à l'ancien emplacement.
      if(a.folder !== undefined) moveAssetTo(prior, folder, {silent: true});
      replaceContentAssetTexture(prior, file);
      let txt = 'image « ' + name + ' » remplacée en place (id ' + prior.id + ', ' + img.width + ' × ' + img.height + ' px)';
      const sheets = assets.filter(function(x){ return x.kind === 'sprite' && x.textureId === prior.id; });
      if(a.cell && !sheets.length){
        // Pas encore de planche : on la crée SUR la texture gardée, jamais sur une copie.
        const sh = createAssetSprite(prior, name, folder);
        sheets.push(sh);
      }
      if(a.cell){
        const l = Math.round(a.cell.l), h = Math.round(a.cell.h);
        sheets.forEach(function(sh){
          sh.regions = sliceGrid(img.width, img.height, l, h, {margin: 0, spacing: 0});
          sh.ppu = a.ppu !== undefined ? Number(a.ppu) : l;
          refreshSpritesOfLAsset(sh);
        });
        txt += ', ' + sheets.length + ' planche(s) redécoupée(s) en cases de ' + l + ' × ' + h + ' px (id '
          + sheets.map(function(sh){ return sh.id; }).join(', ') + ')';
      } else if(sheets.length){
        if(a.ppu !== undefined) sheets.forEach(function(sh){ sh.ppu = Number(a.ppu); });
        txt += ', ' + sheets.length + ' planche(s) toujours liée(s)';
      }
      updateProject();
      return txt;
    }
    pushHistory();
    // REMPLACER plutôt que doubler : un agent qui retouche sa planche la réimporte sous le même
    // nom, et deux textures homonymes feraient lire à api.image la première, l'ancienne.
    const old = assets.find(function(x){ return x.kind === 'texture' && x.name === name; });
    const oldSheets = old ? assets.filter(function(x){ return x.kind === 'sprite' && x.textureId === old.id; }) : [];
    if(old && !oldSheets.length) removeAsset(old);
    const file = new File([img.bytes], slugFile(name) + '.png', {type: 'image/png'});
    const tex = createAssetTexture(file, {name: name, folder: folder});
    const p = ensureParamsImport(tex);
    if(p){ p.filtrage = 'near'; p.mipmaps = false; }
    let txt = 'image « ' + name + ' » importée (' + img.width + ' × ' + img.height + ' px) dans ' + (folder || 'la racine');
    if(a.cell){
      const l = Math.round(a.cell.l), h = Math.round(a.cell.h);
      if(!(l > 0 && h > 0)) throw new Error('la taille de case doit être positive');
      const sheet = createAssetSprite(tex, name, folder);
      sheet.regions = sliceGrid(img.width, img.height, l, h, {margin: 0, spacing: 0});
      sheet.ppu = a.ppu !== undefined ? Number(a.ppu) : l;
      updateProject();
      txt += ', planche découpée en ' + sheet.regions.length + ' case(s) de ' + l + ' × ' + h + ' px';
    }
    if(oldSheets.length) txt += ' ⚠ une texture « ' + name + ' » existait déjà et reste utilisée par une planche : supprimez-la (delete_asset) si elle ne sert plus, ou réimportez avec replace:true pour garder les liens';
    return txt;
  }
});

// CUIRE DES SPRITES ISOMÉTRIQUES (js/iso-sprite.js). Un modèle décrit en primitives 3D devient
// une planche : n directions × n images, ombre portée, masque de couleur d'équipe, et une table
// qui dit où est chaque image et son point d'ancrage au sol. Né d'un jeu façon Age of Empires où
// il fallait ~1 300 sprites : sans cet outil, il a fallu un moteur de rendu hors du moteur.
async function replaceTexture(name, toile, folder){
  const old = assets.find(function(x){ return x.kind === 'texture' && x.name === name; });
  if(old && !assets.some(function(x){ return x.kind === 'sprite' && x.textureId === old.id; })) removeAsset(old);
  const tex = createAssetTexture(await canvasToFile(toile, name), {name: name, folder: folder || undefined});
  const p = ensureParamsImport(tex);
  if(p){ p.filtrage = 'near'; p.mipmaps = false; }
  return tex;
}
// RELIER UNE PLANCHE À SA TEXTURE. Manquait le jour où des planches ont perdu leur `textureId`
// (projet Donjon, 2026-10-06) : l'image était intacte, la planche aussi, seul le lien manquait —
// et import_image en créait une SECONDE planche au lieu de reprendre l'existante.
CopilotTools.register({
  name: 'link_sprite_texture',
  description: 'Relie une planche de sprite (asset sprite) à une texture du projet, sans toucher à sa '
    + 'découpe. `sprite` et `texture` : id (a123) ou nom de l\'asset. Les objets qui utilisent la planche '
    + 'retrouvent leur image aussitôt.',
  schema: {type: 'object', properties: {
    sprite: {type: 'string', description: 'id ou nom de la planche'},
    texture: {type: 'string', description: 'id ou nom de la texture'}
  }, required: ['sprite', 'texture'], additionalProperties: false},
  exec: function(a){
    const find = function(kind, ref){
      const r = String(ref || '').trim();
      const l = assets.filter(function(x){ return x.kind === kind && (x.id === r || x.name === r); });
      const byId = l.find(function(x){ return x.id === r; });
      if(byId) return byId;
      if(l.length > 1) throw new Error('plusieurs assets ' + kind + ' s\'appellent « ' + r + ' » ('
        + l.map(function(x){ return x.id; }).join(', ') + ') : donner l\'id');
      if(!l.length) throw new Error('aucun asset ' + kind + ' « ' + r + ' »');
      return l[0];
    };
    const sheet = find('sprite', a.sprite);
    const tex = find('texture', a.texture);
    pushHistory();
    sheet.textureId = tex.id;
    refreshSpritesOfLAsset(sheet);
    updateProject();
    return 'planche « ' + sheet.name + ' » (' + sheet.id + ') reliée à la texture « ' + tex.name + ' » (' + tex.id + ')';
  }
});

CopilotTools.register({
  name: 'bake_iso_sprites',
  description: 'CUIT des sprites ISOMÉTRIQUES (vue d\'Age of Empires, dimétrie 2:1) à partir d\'un modèle 3D '
    + 'décrit en primitives JSON, dans 1 à 16 directions et autant d\'images d\'animation qu\'on veut. '
    + 'Crée la texture « name », son masque de couleur d\'équipe « name_M » (si des primitives ont team:true) '
    + 'et la table « name_Sprites » : sprites["image/direction"] = [x, y, l, h, ox, oy], (ox, oy) = point '
    + 'd\'ancrage au sol. Repère : unités de tuile, +X devant, +Y à gauche, +Z en haut, origine au sol '
    + '(pieds d\'une unité, centre de l\'emprise d\'un bâtiment). Direction 0 = vers le bas de l\'écran, puis '
    + 'sens horaire (n/4 = vers la droite) ; en jeu : d = round(atan2(dx-dy, (dx+dy)/2) / (2π/n)) mod n. '
    + 'Écran : x = (X-Y)·tile/2, y = (X+Y)·tile/4. Primitives (type) : box {min,max}, tube {from,to,radius,'
    + 'radius2}, sphere/ellipsoid {center,radius nombre ou [rx,ry,rz]}, quad {points 3-4}, disc {center,'
    + 'normal,radius}, cone {center,radius,height}, hipRoof/gableRoof {min,max,overhang,axis,wallColor}. '
    + 'Chacune : color #rrggbb, material (solid, bricks, planks, timbered, thatch, tiles, slate, leaves), '
    + 'noise, team, twoSided. Une animation = une image par pose, les membres déplacés à la main.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom de la texture créée (la table s\'appelle name_Sprites)'},
    primitives: {type: 'array', items: {type: 'object'}, description: 'une seule image : ses primitives'},
    frames: {type: 'array', items: {type: 'object', properties: {name: {type: 'string'}, primitives: {type: 'array', items: {type: 'object'}}}, required: ['primitives']},
      description: 'plusieurs images (poses d\'animation) : [{name, primitives}]'},
    directions: {type: 'number', description: '1, 2, 4, 8 ou 16 (défaut 1)'},
    tile: {type: 'number', description: 'largeur d\'une tuile au sol en pixels (défaut 96 → tuile 96 × 48)'},
    height: {type: 'number', description: 'échelle des hauteurs (défaut 0.92)'},
    scale: {type: 'number', description: 'agrandit le modèle (défaut 1)'},
    extent: {type: 'number', description: 'taille de la zone de rendu en tuiles (défaut 2 ; 5 pour un grand bâtiment)'},
    shadow: {type: 'boolean', description: 'ombre portée au sol (défaut vrai)'},
    outline: {type: 'boolean', description: 'liseré sombre sur la silhouette (défaut vrai)'},
    folder: {type: 'string', description: 'dossier du panneau Projet (défaut « Textures/Iso »)'}
  }, required: ['name'], additionalProperties: false},
  exec: async function(a){
    const name = String(a.name || '').trim();
    if(!name) throw new Error('le nom de la planche est vide');
    const pose = 'idle', frames = a.frames || (a.primitives ? [{name: pose, primitives: a.primitives}] : null);
    const r = renderIsoModel({frames: frames, directions: a.directions, tile: a.tile, height: a.height, scale: a.scale, extent: a.extent, shadow: a.shadow, outline: a.outline});
    const packed = packIsoSheet(r.images);
    const folder = String(a.folder === undefined ? 'Textures/Iso' : a.folder).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if(folder.split('/').some(function(s){ return s === '..'; })) throw new Error('chemin de dossier invalide');
    pushHistory();
    await replaceTexture(name, packed.sheet, folder);
    if(r.hasTeam) await replaceTexture(name + '_M', packed.mask, folder);
    const table = JSON.stringify({tile: a.tile || 96, directions: a.directions || 1, frames: frames.map(function(f, i){ return String(f.name === undefined ? i : f.name); }),
      mask: r.hasTeam ? name + '_M' : null, sprites: packed.sprites});
    const dataName = name + '_Sprites', old = assets.find(function(x){ return x.kind === 'data' && x.name === dataName; });
    if(old){ old.text = table; updateProject(); } else createAssetData(dataName, table);
    return 'planche « ' + name + ' » cuite : ' + r.images.length + ' image(s) (' + frames.length + ' pose(s) × '
      + (a.directions || 1) + ' direction(s)), ' + packed.sheet.l + ' × ' + packed.sheet.h + ' px'
      + (r.hasTeam ? ', masque d\'équipe « ' + name + '_M »' : '') + ', table « ' + dataName + ' ». '
      + 'Dans un script : img = api.image(name), s = api.data(\'' + dataName + '\').sprites[\'pose/dir\'], '
      + 'drawImage(img, s[0], s[1], s[2], s[3], X - s[4], Y - s[5], s[2], s[3]) où (X, Y) = point au sol à l\'écran.';
  }
});

CopilotTools.register({
  name: 'configure_camera_2d',
  description: 'Règle une caméra 2D : mode de cadrage, pixels par unité, objet suivi, bounds du '
    + 'niveau. LE MODE « largeur » EST PRESQUE TOUJOURS LE BON — le plus petit rapport pixel entier '
    + 'qui garde la vue dans le niveau. Un rapport non entier est la seule cause du « c\'est flou », '
    + 'et `check` le donne. Sans bounds, la caméra finit par montrer le vide au-delà du décor ; '
    + '`bornes_du_decor` les déduit des tuiles et des colliders statiques.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom de l\'objet caméra ; à défaut la première caméra 2D'},
    mode: {type: 'string', enum: ['width', 'height', 'fixed']},
    ppu: {type: 'number', description: 'pixels d\'art par unité du monde'},
    levelWidth: {type: 'number', description: 'largeur du niveau en unités (mode « largeur »)'},
    ratio: {type: 'number', description: 'rapport pixel imposé (mode « fixe »)'},
    follows: {type: 'string', description: 'nom de l\'objet à suivre ; chaîne vide pour une caméra fixe'},
    viewHeight: {type: 'number', description: 'décalage vers le haut, en fraction de la hauteur de vue'},
    pixelSnap: {type: 'boolean'},
    bounds_from_scene: {type: 'boolean', description: 'déduire les bounds horizontales du décor'}
  }, additionalProperties: false},
  exec: function(a){
    const estCam2d = function(o){
      const c = cameraSettingOf(o);
      return !!(c && c.projection === 'orthographic');
    };
    // SANS NOM, LA CAMÉRA QUE LE JEU RENDRA — la principale (`cameraMain2d`, même règle que
    // `rtCameraMain`), pas la première du tableau. Avec deux caméras 2D (celle de la scène et une
    // créée ensuite), la commande réglait l'une et le jeu filmait par l'autre, restée à
    // `orthoSize` : `cam.top = 5` au lieu du cadrage demandé.
    const cam = a.name
      ? objects.find(function(o){ return o.name === a.name && estCam2d(o); })
      : ((typeof cameraMain2d === 'function') ? cameraMain2d(objects) : objects.find(estCam2d));
    if(!cam) throw new Error(a.name
      ? 'aucune caméra 2D nommée « ' + a.name + ' »'
      : 'aucune caméra 2D dans la scène — créez-en une avec create_object_2d type=camera');
    pushHistory();
    const r = cameraSettingOf(cam);
    // Les réglages de cadrage vont sur `Camera`, ceux de suivi sur `CameraFollow` : deux
    // composants, une seule commande — c'est la commande qui répartit, pas l'auteur.
    let f = cameraFollowOf(cam);
    ['mode', 'ppu', 'ratio'].forEach(function(k){
      if(a[k] !== undefined) r[k] = a[k];
    });
    if(a.levelWidth !== undefined) r.widthLevel = a.levelWidth;
    // Régler le cadrage, c'est demander le cadrage pixel-perfect : sans ce drapeau le moteur
    // cadre sur `orthoSize` et ignore mode/ppu/rapport — la commande « réussissait » sans effet.
    if(a.mode !== undefined || a.ppu !== undefined || a.ratio !== undefined || a.levelWidth !== undefined){
      r.pixelPerfect = true;
    }
    if(a.follows !== undefined){
      if(!f) f = cam.addComponent('CameraFollow', {});
      f.targetName = a.follows || '';
    }
    if(f){
      if(a.viewHeight !== undefined) f.topOfView = a.viewHeight;
      if(a.pixelSnap !== undefined) f.snapPixel = !!a.pixelSnap;
    }
    if(a.bounds_from_scene){
      const b = (typeof gatherWorld2d === 'function' && typeof boundsFromObstacles2d === 'function')
        ? boundsFromObstacles2d(gatherWorld2d(objects).obstacles) : null;
      if(!b) throw new Error('aucun décor trouvé : posez les tuiles ou les colliders d\'abord');
      // HORIZONTALES SEULEMENT. Les bounds verticales déduites d'un simple sol donnent une bande d'une
      // unité de haut, et un niveau plus étroit que la vue est CENTRÉ : la caméra se retrouverait
      // clouée sur la ligne du sol, à montrer du sous-sol. Mesuré.
      if(!f) f = cam.addComponent('CameraFollow', {});
      f.xMin = b.xMin; f.xMax = b.xMax;
      r.widthLevel = Math.max(1, Math.round((b.xMax - b.xMin) * 100) / 100);
    }
    const soucis = validateCamera2d(settingCam2d(r)).concat(validateCameraFollow(f));
    // La caméra réglée doit être celle que le jeu choisira : sinon le réglage est juste et
    // l'écran ne le montre pas.
    if(typeof isCameraMain === 'function' && !isCameraMain(cam)){
      const others = objects.filter(function(o){ return o !== cam && cameraSettingOf(o) && isCameraMain(o); });
      if(others.length) soucis.push('« ' + cam.name + ' » n\'est PAS la caméra principale (« ' + others[0].name
        + ' » l\'est) : le jeu rendra par l\'autre. configure_camera {name, main:true} pour la désigner.');
    }
    buildInspector();
    if(r.applyProjection) r.applyProjection();
    // Recadrer TOUT DE SUITE, par la même décision que le jeu : `applyProjection` reconstruit au
    // frustum `orthoSize`, et la réponse doit annoncer le cadrage réel, pas celui de construction.
    const framing = (typeof frameOrthoCamera === 'function' && r.objectThree)
      ? frameOrthoCamera(r.objectThree, r, 1920, 1080) : null;
    return 'caméra « ' + cam.name + ' » réglée : ' + JSON.stringify(r.serialize())
      + (framing ? ' — cadrage à 1920 × 1080 : rapport ' + framing.ratio + ', vue de '
        + (Math.round(framing.heightView * 100) / 100) + ' u de haut' : '')
      + (soucis.length ? '\n⚠ ' + soucis.join(' ') : '');
  }
});

CopilotTools.register({
  name: 'configure_network',
  description: 'Lit ou modifie les RÉGLAGES MULTIJOUEUR du projet. Sans argument, rend les réglages '
    + 'actuels. `transport` : `relay` (tout passe par le serveur relais) ou `p2p` (pair-à-pair en '
    + 'étoile autour de l’autorité, signalisation par le relais, repli sur le relais si la liaison '
    + 'échoue et que `p2pFallbackRelay` est vrai). `server` : origine http(s) du relais, vide = '
    + 'automatique. `gameKey` : clé de jeu du cloud (mj_...). `maxPlayers` 1..32, `sendRate` 5..60 Hz. '
    + '`replication` : `owner` (chaque joueur diffuse ses objets) ou `authority` (l’autorité simule tout).',
  schema: {type: 'object', properties: {
    enabled: {type: 'boolean', description: 'le jeu est-il multijoueur'},
    transport: {type: 'string', enum: ['relay', 'p2p']},
    server: {type: 'string', description: 'origine http(s) du relais / de la signalisation ; vide = automatique'},
    gameKey: {type: 'string', description: 'clé de jeu multijoueur du cloud (mj_...)'},
    maxPlayers: {type: 'number', description: 'joueurs max par salon, 1..32'},
    sendRate: {type: 'number', description: 'cadence d’envoi en Hz, 5..60'},
    replication: {type: 'string', enum: ['owner', 'authority']},
    p2pFallbackRelay: {type: 'boolean', description: 'repli sur le relais si le pair-à-pair échoue'},
    iceServers: {type: 'array', description: 'serveurs STUN/TURN : [{urls, username?, credential?}]',
      items: {type: 'object', properties: {
        urls: {type: 'string'}, username: {type: 'string'}, credential: {type: 'string'}
      }, required: ['urls']}}
  }, additionalProperties: false},
  exec: function(a){
    const keys = Object.keys(a || {});
    if(a && a.server !== undefined && a.server !== '' && !/^https?:\/\//.test(String(a.server).trim())){
      throw new Error('« server » doit être une origine http(s)://…, ou vide pour l’adresse automatique');
    }
    if(a && a.transport !== undefined && ['relay', 'p2p'].indexOf(a.transport) === -1){
      throw new Error('« transport » vaut relay ou p2p');
    }
    if(a && a.replication !== undefined && ['owner', 'authority'].indexOf(a.replication) === -1){
      throw new Error('« replication » vaut owner ou authority');
    }
    const r = projectNetworkSettings(keys.length ? a : null);
    const shown = Object.assign({}, r, {gameKey: r.gameKey ? r.gameKey.slice(0, 6) + '…' : ''});
    return (keys.length ? 'réglages multijoueur mis à jour : ' : 'réglages multijoueur : ')
      + JSON.stringify(shown);
  }
});

CopilotTools.register({
  name: 'resize_tilemap',
  description: 'Change la taille de la grille d\'une map de tuiles, ou la taille d\'une tuile en '
    + 'unités. Le contenu déjà peint est CONSERVÉ, le coin haut-gauche servant d\'anchor ; rétrécir '
    + 'perd ce qui sort.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom de l\'objet portant la map ; à défaut la première'},
    columns: {type: 'number'}, rows: {type: 'number'},
    tile: {type: 'number', description: 'taille d\'une tuile en unités du monde (0.5 par défaut)'}
  }, additionalProperties: false},
  exec: function(a){
    const hasMap = function(o){ return !!(o.getComponent && o.getComponent('Tilemap')); };
    const n = a.name ? objects.find(function(o){ return o.name === a.name && hasMap(o); })
                     : objects.find(hasMap);
    if(!n) throw new Error('aucune map de tuiles trouvée');
    pushHistory();
    const c = n.getComponent('Tilemap');
    if(a.columns !== undefined || a.rows !== undefined){
      resizeMap(c, a.columns !== undefined ? a.columns : c.width,
                             a.rows !== undefined ? a.rows : c.height);
    }
    if(a.tile !== undefined) c.cellSize = Math.max(0.01, Number(a.tile) || c.cellSize);
    rebuildTilemap(n);
    buildInspector();
    return 'map « ' + n.name + ' » : ' + c.width + ' × ' + c.height + ' cases de ' + c.cellSize + ' unité, '
      + (c.cells || []).filter(function(v){ return v !== 0; }).length + ' posée(s), '
      + collidingBands(c, c.tileDefs()).length + ' boîte(s) de collision';
  }
});

CopilotTools.register({
  name: 'build_atlas',
  description: 'Réunit PLUSIEURS planches de sprite en une seule, parce qu\'un animateur de sprite lit '
    + 'toutes ses suites dans UNE planche. Un personnage livré en plusieurs fichiers — un par état — '
    + 'ne peut pas être animé sans cette étape. Les planches doivent avoir le même nombre de pixels '
    + 'par unité. Les originales ne sont pas touchées, et une suite est créée par planche source.',
  schema: {type: 'object', properties: {
    sheets: {type: 'array', items: {type: 'string'}, description: 'noms des planches à réunir'}
  }, required: ['sheets'], additionalProperties: false},
  exec: async function(a){
    const sources = (a.sheets || []).map(function(name){
      const s = assets.find(function(x){ return x.kind === 'sprite' && x.name === name; });
      if(!s) throw new Error('planche introuvable : « ' + name + ' »');
      return s;
    });
    const soucis = validateAtlas(sources);
    if(soucis.length) throw new Error(soucis.join(' '));
    const atlas = await assembleAtlasSprite(sources);
    return 'planche « ' + atlas.name + ' » : ' + atlas.regions.length + ' image(s) de '
      + sources.length + ' planche(s), et ' + atlas.sequences.length + ' suite(s) nommées '
      + atlas.sequences.map(function(s){ return s.name; }).join(', ');
  }
});

CopilotTools.register({
  name: 'configure_light',
  description: 'Règle une lumière : couleur, intensité, portée, angle et pénombre pour un spot. '
    + 'Sans lumière, un décor 3D est noir ; avec une seule directionnelle trop forte, il est plat. '
    + 'Pour une directionnelle : shadowMapSize, shadowExtent, shadowBias règlent son ombre (sauvegardés avec '
    + 'la scène, appliqués dans l\'éditeur et le jeu). L\'ambiance hémisphérique (ciel/sol) : configure_environment.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom de l\'objet lumière'},
    color: {type: 'string', description: '#rrggbb'},
    intensity: {type: 'number'}, range: {type: 'number'},
    angle: {type: 'number', description: 'spot : demi-angle en degrés'},
    penumbra: {type: 'number', description: 'spot : douceur du bord, 0 à 1'},
    shadowMapSize: {type: 'number', description: 'directionnelle : résolution de la carte d\'ombre (256 à 8192 ; 0 = celle du projet)'},
    shadowExtent: {type: 'number', description: 'directionnelle : demi-largeur de la boîte d\'ombre en unités (0 = automatique, suit la portée du projet)'},
    shadowBias: {description: 'directionnelle : biais de profondeur (nombre, négatif, ex. -0.0005 ; "auto" = automatique)'}
  }, required: ['name'], additionalProperties: false},
  exec: function(a){
    const o = objects.find(function(x){ return x.name === a.name; });
    if(!o) throw new Error('objet introuvable : « ' + a.name + ' »');
    const l = findRefs(o).light;
    if(!l) throw new Error('« ' + a.name + ' » n\'est pas une lumière');
    pushHistory();
    if(a.color !== undefined){
      l.color.set(a.color);
      if(o.material && o.material.emissive) o.material.emissive.set(a.color);
      o.userData.emissiveBase = l.color.getHex();
    }
    if(a.intensity !== undefined) l.intensity = Math.max(0, Number(a.intensity));
    if(a.range !== undefined && l.distance !== undefined) l.distance = Math.max(0, Number(a.range));
    if(a.angle !== undefined && l.angle !== undefined) l.angle = Math.max(0.01, Number(a.angle)) * Math.PI / 180;
    if(a.penumbra !== undefined && l.penumbra !== undefined) l.penumbra = Math.max(0, Math.min(1, Number(a.penumbra)));
    const c = o.getComponent && o.getComponent('Light');
    if(c){
      c.color = l.color.getHex(); c.intensity = l.intensity;
      if(l.distance !== undefined) c.range = l.distance;
      if(l.angle !== undefined) c.angle = l.angle;
      if(l.penumbra !== undefined) c.penumbra = l.penumbra;
    }
    const shadow = ShadowFit.toolFields(a);
    let shadowText = '';
    if(Object.keys(shadow).length){
      if(!l.isDirectionalLight) throw new Error('les réglages d\'ombre (shadowMapSize, shadowExtent, shadowBias) ne valent que pour une directionnelle');
      if(!c) throw new Error('« ' + a.name + ' » n\'a pas de composant Light');
      // Dans le SAC du composant : sérialisé avec la scène, relu par le recadrage d'ombre à
      // chaque image (éditeur et jeu). 0 / null remettent l'automatique.
      Object.keys(shadow).forEach(function(k){
        if(shadow[k] === null) delete c.data[k]; else c.data[k] = shadow[k];
      });
      c.applyShadowSettings();
      shadowText = ' ; ombre : ' + JSON.stringify({shadowMapSize: c.data.shadowMapSize || 'auto',
        shadowExtent: c.data.shadowExtent || 'auto', shadowBias: c.data.shadowBias === undefined ? 'auto' : c.data.shadowBias});
    }
    buildInspector();
    return 'lumière « ' + o.name + ' » : #' + l.color.getHexString() + ', intensité ' + l.intensity + shadowText;
  }
});

CopilotTools.register({
  name: 'checkpoint',
  description: 'Enregistre l\'état COMPLET de la scène sous un nom, pour pouvoir y revenir d\'un seul '
    + 'geste. À poser AVANT d\'essayer une approche dont on n\'est pas sûr : sans lui, abandonner une '
    + 'piste de dix commandes demande dix annulations, sans savoir combien. Les points de reprise ne '
    + 'sont pas enregistrés dans le projet — ce sont des brouillons de session.',
  schema: {type: 'object', properties: {name: {type: 'string'}}, additionalProperties: false},
  exec: function(a){
    const n = setPointOfResume(a.name);
    return 'point de reprise « ' + n + ' » posé (' + objects.length + ' objet(s)). '
      + 'Points existants : ' + [...resumes.keys()].join(', ');
  }
});

// ENREGISTRER. Sans cet outil, tout ce qu'un agent construisait par le pont MCP ne vivait que
// dans l'onglet : un rechargement effaçait un niveau entier, et le serveur gardait la version
// d'avant sans rien signaler. registerInProjectOpen aiguille seul vers le cloud ou le dossier.
CopilotTools.register({
  name: 'save_project',
  description: 'ENREGISTRE le projet là où il vit (cloud pour un projet hébergé, dossier sur le '
    + 'disque sinon). Rien de ce que font les autres outils n\'est enregistré tant que ceci n\'est '
    + 'pas appelé : un rechargement de page perd tout. À appeler à la fin de chaque étape cohérente '
    + '(niveau posé, script qui marche) et TOUJOURS avant de rendre la main.',
  schema: {type: 'object', properties: {}, additionalProperties: false},
  exec: async function(){
    if(!project.cloud && !project.handleFolder){
      throw new Error('aucun emplacement d\'enregistrement : le projet n\'est ni hébergé ni ouvert '
        + 'depuis un dossier — demandez à l\'utilisateur de l\'enregistrer une première fois');
    }
    await registerInProjectOpen();
    return 'projet enregistré (' + (project.cloud ? 'cloud, version ' + (project.cloud.versionId || '?') : 'dossier') + ')';
  }
});

CopilotTools.register({
  name: 'move_asset',
  description: 'Range un asset (script, matériau, prefab, texture, son, donnée…) dans un dossier du '
    + 'panneau Projet. folder = chemin relatif à assets/, ex. "Scripts/Joueur" ; "" = racine. '
    + 'Voir list_assets pour les noms et dossiers actuels. Quand plusieurs assets portent le même nom '
    + '(un script et une donnée « Decor »), `kind` et/ou `from` (dossier actuel) désignent lequel ; '
    + '`all` range tous les homonymes restants ; `id` (voir list_assets) vise un asset précis.',
  schema: {type: 'object', properties: {name: {type: 'string'}, folder: {type: 'string'},
    id: {type: 'string', description: 'id de l\'asset visé (à la place de name, pour un homonyme)'},
    kind: {type: 'string', description: 'genre de l\'asset visé (script, data, model, prefab…)'},
    from: {type: 'string', description: 'dossier actuel de l\'asset visé ("" = racine)'},
    all: {type: 'boolean', description: 'ranger TOUS les homonymes qui correspondent'}},
    required: ['folder'], additionalProperties: false},
  exec: function(a){
    if(!a.name && !a.id) throw new Error('donner `name` ou `id` de l\'asset');
    // Prendre le PREMIER homonyme rangeait le mauvais : move_asset('Decor', 'Data') a envoyé le
    // script dans Data et laissé la donnée à la racine. Ambigu ⇒ refus, avec de quoi préciser.
    const found = matchAssets(a, a.from);
    if(!found.length) throw new Error('asset « ' + (a.id || a.name) + ' » introuvable (voir list_assets)');
    if(found.length > 1 && !a.all) throw new Error('plusieurs assets « ' + a.name + ' » : précisez kind et/ou from ('
      + found.map(function(x){ return x.kind + ' dans "' + (x.folder || '') + '"'; }).join(', ') + '), ou all:true');
    const folder = String(a.folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if(folder.split('/').some(function(s){ return s === '..'; })) throw new Error('chemin de dossier invalide');
    found.forEach(function(asset){ moveAssetTo(asset, folder, {silent: true}); });
    return '« ' + found[0].name + ' »' + (found.length > 1 ? ' ×' + found.length : '') + ' rangé dans ' + (folder || 'la racine');
  }
});

// AJOUTER À UNE PALETTE EXISTANTE. Chaque tuile porte son propre `spriteId` : une palette mêle
// donc sans difficulté des tuiles de plusieurs planches (c'est déjà ce que fait le glisser du
// panneau Palette). Sans cet outil, l'IA ne pouvait qu'en créer une neuve par planche.
CopilotTools.register({
  name: 'add_palette_tiles',
  description: 'Ajoute à une palette de tuiles EXISTANTE les tuiles d\'une planche (asset sprite, '
    + 'éventuellement d\'une autre texture) : une tuile par image de la découpe, ou une seule tuile '
    + 'auto-tuilée avec `autotile`. Les images déjà présentes ne sont pas dupliquées. Les tilemaps '
    + 'qui utilisent la palette gardent leurs indices (les tuiles sont ajoutées à la fin).',
  schema: {type: 'object', properties: {
    palette: {type: 'string', description: 'nom ou id de la palette (voir list_assets)'},
    sheet: {type: 'string', description: 'nom ou id de la planche à ajouter'},
    autotile: {type: 'boolean', description: 'la planche entière devient UNE tuile auto-tuilée (16 images, 4 voisins)'},
    blob: {type: 'boolean', description: 'avec autotile : auto-tuilage 8 voisins (coins intérieurs), planche de 47 images '
      + 'dans l’ordre croissant du masque N=1 NE=2 E=4 SE=8 S=16 SO=32 O=64 NO=128 (un coin ne compte que si ses deux côtés sont pleins)'},
    collision: {type: 'string', description: 'solid (défaut), none…'}
  }, required: ['palette', 'sheet'], additionalProperties: false},
  exec: function(a){
    const byRef = function(kind, ref){
      return assets.find(function(x){ return x.kind === kind && x.id === ref; })
        || assets.find(function(x){ return x.kind === kind && x.name === ref; }) || null;
    };
    const pal = byRef('tilePalette', a.palette);
    if(!pal || !pal.palette) throw new Error('palette introuvable : ' + a.palette + '. Palettes : '
      + (assets.filter(function(x){ return x.kind === 'tilePalette'; }).map(function(x){ return x.name; }).join(', ') || '(aucune)'));
    const sheet = byRef('sprite', a.sheet);
    if(!sheet) throw new Error('planche introuvable : ' + a.sheet + ' (une texture doit d\'abord devenir une planche : import_image avec cell, ou slice_sheet)');
    pushHistory();
    const n = addSpriteToPalette(pal.palette, sheet, {autotile: !!a.autotile || !!a.blob, blob: !!a.blob, collision: a.collision});
    if(!n) return '« ' + sheet.name + ' » est déjà dans la palette « ' + pal.name + ' » : rien ajouté';
    invalidateTilemapsOfPalette(pal.id);
    updateProject();
    return n + ' tuile(s) de « ' + sheet.name + ' » ajoutée(s) à la palette « ' + pal.name + ' » ('
      + pal.palette.tiles.length + ' au total ; indices ' + (pal.palette.tiles.length - n + 1) + '…' + pal.palette.tiles.length + ')';
  }
});

// Le pendant de move_asset : sans lui, un doublon créé par erreur (prefab rappelé, matériau
// recréé) restait dans le projet pour toujours, faute de commande pour le retirer.
CopilotTools.register({
  name: 'delete_asset',
  description: 'Supprime un asset du projet. REFUSÉ s\'il est encore utilisé par un objet de la scène '
    + '(matériau porté, instance de prefab, script attaché). Quand plusieurs assets portent le même '
    + 'nom, `folder` ou `id` (voir list_assets) désigne lequel.',
  schema: {type: 'object', properties: {name: {type: 'string'}, folder: {type: 'string'},
    id: {type: 'string', description: 'id de l\'asset visé (à la place de name, pour un homonyme)'},
    kind: {type: 'string', description: 'genre de l\'asset visé (script, data, model, prefab…)'},
    all: {type: 'boolean', description: 'supprimer TOUS les homonymes non utilisés (doublons identiques)'},
    confirm: {type: 'boolean', description: 'obligatoire pour un asset VALIDÉ (validate_asset) ; l\'utilisateur doit en plus confirmer dans la page'}},
    additionalProperties: false},
  exec: async function(a){
    if(!a.name && !a.id) throw new Error('donner `name` ou `id` de l\'asset');
    const found = matchAssets(a, a.folder);
    if(!found.length) throw new Error('asset « ' + (a.id || a.name) + ' » introuvable (voir list_assets)');
    if(a.all){
      const out = [];
      for(const x of found){ try{ out.push(await removeOne(x, a)); } catch(e){ out.push(e.message); } }
      return out.join(' · ');
    }
    if(found.length > 1) throw new Error('plusieurs assets « ' + a.name + ' » : précisez folder ('
      + found.map(function(x){ return '"' + (x.folder || '') + '"'; }).join(', ') + ')');
    return removeOne(found[0], a);
  }
});

/** Les assets visés par move_asset / delete_asset : par `id` (exact) ou par nom + filtres. */
function matchAssets(a, folder){
  return assets.filter(function(x){
    return (a.id !== undefined ? x.id === a.id : x.name === a.name)
      && (a.name === undefined || x.name === a.name)
      && (folder === undefined || (x.folder || '') === folder)
      && (a.kind === undefined || x.kind === a.kind);
  });
}

async function removeOne(asset, a){
    if(asset.byDefault) throw new Error('le matériau par défaut du projet ne se supprime pas');
    // Référencé = son id apparaît dans les données d'un objet (materialId, prefabId, composants).
    const users = objects.filter(function(o){
      try{ return JSON.stringify(o.userData).indexOf('"' + asset.id + '"') !== -1; } catch(e){ return false; }
    });
    if(users.length) throw new Error('« ' + asset.name + ' » est utilisé par ' + users.length + ' objet(s) ('
      + users.slice(0, 5).map(function(o){ return o.name; }).join(', ') + ') : rien supprimé');
    // Un asset VALIDÉ par l'utilisateur ne part pas sur la seule parole de l'IA : confirm:true ET un
    // accord dans la page (js/ai-rules.js, règle assets.validated_delete).
    const validated = project.settings.validatedAssets;
    if(isValidated(validated, asset)){
      if(!a.confirm) throw new Error('« ' + asset.name + ' » est VALIDÉ — ' + ruleMessage('assets.validated_delete'));
      const ok = await askInPage('L\'IA demande de supprimer l\'asset validé « ' + asset.name + ' ». Autoriser ?');
      if(!ok) throw new Error('suppression de « ' + asset.name + ' » refusée par l\'utilisateur');
      delete validated[asset.id];
    }
    removeAsset(asset);
    return '« ' + asset.name + ' » supprimé' + (asset.folder ? ' (' + asset.folder + ')' : '');
}

CopilotTools.register({
  name: 'validate_asset',
  description: 'Marque un asset comme VALIDÉ (ou retire la validation avec validated:false) — à n\'appeler que sur '
    + 'demande de l\'utilisateur, une fois qu\'il a approuvé le résultat. Un asset validé ne se supprime pas '
    + 'sans confirm:true et sans son accord dans la page, ne s\'écrase pas par un réimport, et audit_project '
    + 'signale toute modification ultérieure. `folder` / `kind` départagent des homonymes.',
  schema: {type: 'object', properties: {name: {type: 'string'}, folder: {type: 'string'},
    kind: {type: 'string', description: 'genre de l\'asset visé (model, prefab, texture…)'},
    validated: {type: 'boolean', description: 'défaut true ; false retire la validation'}},
    required: ['name'], additionalProperties: false},
  exec: function(a){
    const found = assets.filter(function(x){
      return x.name === a.name && (a.folder === undefined || (x.folder || '') === a.folder)
        && (a.kind === undefined || x.kind === a.kind);
    });
    if(!found.length) throw new Error('asset « ' + a.name + ' » introuvable (voir list_assets)');
    if(found.length > 1) throw new Error('plusieurs assets « ' + a.name + ' » : précisez kind ou folder');
    const asset = found[0];
    const table = project.settings.validatedAssets;
    if(a.validated === false){
      delete table[asset.id];
      return 'validation de « ' + a.name + ' » retirée';
    }
    table[asset.id] = {name: asset.name, fp: assetFingerprint(asset), at: new Date().toISOString()};
    return '« ' + a.name + ' » VALIDÉ : il ne sera ni supprimé ni écrasé sans accord';
  }
});

CopilotTools.register({
  name: 'go_back',
  description: 'Revient à un point de reprise. Le retour lui-même est annulable par Ctrl+Z : se '
    + 'tromper de point ne détruit rien.',
  schema: {type: 'object', properties: {name: {type: 'string'}}, additionalProperties: false},
  exec: function(a){
    const n = goBackAtPointOfResume(a.name);
    if(!n) throw new Error('aucun point de reprise « ' + (a.name || 'defaut') + ' » — connus : '
      + ([...resumes.keys()].join(', ') || 'none'));
    return 'revenu au point « ' + n + ' » : ' + objects.length + ' objet(s) dans la scène';
  }
});

CopilotTools.register({
  name: 'read_design',
  description: 'Lit le document de conception du projet : l\'intention, les contraintes, ce qui a été '
    + 'essayé et écarté. À LIRE EN PREMIER quand on reprend un projet — la scène dit ce qui est, '
    + 'jamais ce qu\'on voulait. Il voyage avec le projet.',
  schema: {type: 'object', properties: {}, additionalProperties: false},
  exec: function(){
    const t = readDesign();
    return t || '(le document de conception est vide — écrivez-y l\'intention du jeu avant de '
      + 'construire, et ce que vous écartez en chemin)';
  }
});

CopilotTools.register({
  name: 'write_design',
  description: 'Écrit ou complète le document de conception. Y consigner l\'intention, les règles du '
    + 'game, les réglages choisis et POURQUOI, et ce qui a été essayé sans succès — c\'est ce dernier '
    + 'point qui évite de refaire deux fois la même error à la session suivante.',
  schema: {type: 'object', properties: {
    text: {type: 'string'},
    add: {type: 'boolean', description: 'vrai pour ajouter à la suite, faux pour remplacer'}
  }, required: ['text'], additionalProperties: false},
  exec: function(a){
    const r = writeDesign(a.text, a.add !== false);
    return 'document de conception : ' + r.size + ' caractères'
      + (r.tronque ? ' (le début a été tronqué : la limite est ' + DESIGN_MAX + ')' : '');
  }
});

// ---------- Le son, enfin atteignable ----------
//
// Le moteur audio était complet — assets avec leurs octets dans le build, listener sur la caméra de
// game, spatialisation, pitch, API de script — et le copilote n'avait AUCUN medium d'y toucher : la seule
// façon d'attacher un son était le glisser-déposer, qui n'est pas une commande. On venait donc de lui
// donner la capacité de construire un jeu entier depuis une phrase, et ce jeu était muet.

CopilotTools.register({
  name: 'configure_audio',
  description: 'Attache un son à un objet et le règle. Le son doit être un asset audio du projet '
    + '(voir `list_assets`, kind « audio »). `spatial` fait dépendre le volume de la distance à la '
    + 'caméra — bon pour une source dans le décor, bad pour une musique ou un bruitage '
    + 'd\'interface, qui doivent s\'entendre partout. ATTENTION : `range` n\'est pas une limite mais '
    + 'la distance à laquelle le son garde son volume plein ; au-delà il décroît sans jamais '
    + 's\'annuler, donc dix sources lointaines restent audibles en fond.',
  schema: {type: 'object', properties: {
    object: {type: 'string', description: 'nom de l\'objet qui porte le son'},
    sound: {type: 'string', description: 'nom de l\'asset audio ; chaîne vide pour retirer le son'},
    volume: {type: 'number', description: '0 à 2'},
    loop: {type: 'boolean'},
    auto: {type: 'boolean', description: 'jouer au démarrage du jeu'},
    spatial: {type: 'boolean', description: 'le volume dépend de la distance à la caméra'},
    range: {type: 'number', description: 'distance de volume plein, en unités'},
    pitch: {type: 'number', description: 'vitesse de lecture, 0.25 à 4'},
    maxDistance: {type: 'number', description: 'distance à laquelle le son s\'éteint — n\'a d\'effet '
      + 'RÉEL qu\'avec le modèle « lineaire »'},
    slope: {type: 'number', description: 'raideur de l\'atténuation (1 par défaut ; 0 = aucune)'},
    model: {type: 'string', enum: ['inverse', 'lineaire', 'exponentiel'],
      description: '« inverse » (défaut) ne se tait JAMAIS, quelle que soit la distance max ; '
        + '« lineaire » éteint vraiment le son à distanceMax — à préférer pour un décor sonore, sans '
        + 'quoi dix sources lointaines restent audibles en fond et brouillent le mélange'},
    bus: {type: 'string', enum: ['sfx', 'music'],
      description: 'bus de mixage : « sfx » (défaut, bruitages) ou « music ». Chaque bus a son volume '
        + '(`configure_audio_mix`) — une musique sur « sfx » baisserait avec les bruitages'}
  }, required: ['object'], additionalProperties: false},
  exec: function(a){
    const o = objects.find(function(x){ return x.name === a.object; });
    if(!o) throw new Error('objet introuvable : « ' + a.object + ' »');
    pushHistory();
    if(a.sound !== undefined && a.sound === ''){
      const c = o.getComponent && o.getComponent('AudioSource');
      if(c) o.removeComponent(c); else delete o.userData.audio;
      buildInspector();
      return 'source audio retirée de « ' + o.name + ' »';
    }
    const ua = ensureAudio(o);
    if(a.sound !== undefined){
      const asset = assets.find(function(x){ return isPlayableAudio(x) && x.name === a.sound; });
      if(!asset){
        const dispo = assets.filter(isPlayableAudio)
                            .map(function(x){ return x.name; });
        throw new Error('aucun son nommé « ' + a.sound + ' ». Sons du projet : '
          + (dispo.join(', ') || 'aucun — importez un fichier audio d\'abord'));
      }
      ua.asset = asset.id;
      // Les défauts du GENRE d'abord (une boucle = musique de fond), les réglages explicites ensuite.
      applyKindDefaultsAudio(asset, ua);
    }
    if(a.volume !== undefined)  ua.volume = Math.max(0, Math.min(2, Number(a.volume)));
    if(a.pitch !== undefined)   ua.pitch = Math.max(0.25, Math.min(4, Number(a.pitch)));
    if(a.range !== undefined)  ua.range = Math.max(0.5, Number(a.range));
    if(a.loop !== undefined)  ua.loop = !!a.loop;
    if(a.auto !== undefined)    ua.auto = !!a.auto;
    if(a.spatial !== undefined) ua.spatial = !!a.spatial;
    // `distanceMax` et `rolloff` : les noms que lisent le moteur et l'inspecteur (AUDIO_DEFAULT,
    // js/audio-falloff.js). La commande écrivait `maxDistance` et `slope`, que personne ne relisait :
    // le réglage était accepté, rapporté comme fait, et sans aucun effet sur le son.
    if(a.maxDistance !== undefined) ua.distanceMax = Math.max(1, Number(a.maxDistance));
    if(a.slope !== undefined)  ua.rolloff = Math.max(0, Number(a.slope));
    if(a.model !== undefined)  ua.model = a.model;
    if(a.bus !== undefined)    ua.bus = busOfSource({bus: a.bus});
    // Le composant, sans quoi le réglage existerait sans être visible ni modifiable dans l'inspecteur.
    if(o.addComponent && !o.getComponent('AudioSource')) o.addComponent('AudioSource', ua);
    buildInspector();
    const asset = ua.asset ? assets.find(function(x){ return x.id === ua.asset; }) : null;
    // Le VERDICT d'atténuation part avec le réglage. Il donne le gain réel à dix fois la portée : sans
    // ce chiffre, « inverse » et « lineaire » ne se distinguent que par un mot, et le modèle choisirait
    // le défaut sans savoir qu'il ne coupe jamais.
    const att = (typeof validateFalloffAudio === 'function') ? validateFalloffAudio(ua) : [];
    return 'source audio sur « ' + o.name + ' » : ' + (asset ? '« ' + asset.name + ' »' : 'aucun son')
      + ', ' + JSON.stringify({volume: ua.volume, loop: ua.loop, auto: ua.auto,
                               spatial: ua.spatial, range: ua.range, pitch: ua.pitch,
                               maxDistance: ua.distanceMax, slope: ua.rolloff, model: ua.model,
                               bus: busOfSource(ua)})
      + (att.length ? '\n' + att.join('\n') : '');
  }
});

CopilotTools.register({
  name: 'configure_audio_mix',
  description: 'Lit ou règle le MIXAGE du projet : le volume des bus « master » (tout le jeu), « music » '
    + 'et « sfx » (bruitages, api.playSound, notes du synthé). 0 à 2, 1 par défaut. Sans argument, rend '
    + 'les volumes actuels. Ce sont les niveaux de départ du jeu publié ; un script les change en partie '
    + 'avec `api.audioBus("music").volume(v)`.',
  schema: {type: 'object', properties: {
    master: {type: 'number', description: '0 à 2'},
    music: {type: 'number', description: '0 à 2'},
    sfx: {type: 'number', description: '0 à 2'}
  }, additionalProperties: false},
  exec: function(a){
    if(!project || !project.settings) throw new Error('aucun projet ouvert');
    const patch = {};
    ['master', 'music', 'sfx'].forEach(function(k){ if(a[k] !== undefined) patch[k] = a[k]; });
    // La porte commune : elle marque aussi le projet modifié, sans quoi ce réglage pouvait être perdu.
    return 'mixage : ' + JSON.stringify(setProjectBusVolumes(patch));
  }
});

CopilotTools.register({
  name: 'create_sound',
  description: 'FABRIQUE un bruitage et l\'ajoute au projet, sans aucun fichier source — le pendant de '
    + '`create_texture`. Genres : `beep` (vérifier qu\'une source joue), `jump` (hauteur qui MONTE), '
    + '`fall` (qui descend, pour un dégât), `impact` (choc, atterrissage), `pas`, `coin` '
    + '(ramassage). Un saut sans bruit ne se juge pas : la sensation d\'un platformer se règle autant '
    + 'à l\'oreille qu\'à l\'œil, et attendre une banque de sons revient à ne jamais la régler.',
  schema: {type: 'object', properties: {
    kind: {type: 'string', enum: ['beep', 'jump', 'fall', 'impact', 'step', 'coin']},
    name: {type: 'string', description: 'nom de l\'asset créé'},
    duration: {type: 'number', description: 'en secondes (défaut 0,15 — un bruitage est court)'},
    frequency: {type: 'number', description: 'hauteur de départ en Hz (440 = un la)'},
    volume: {type: 'number', description: '0 à 1 (défaut 0,7)'},
    seed: {type: 'number', description: 'pour les genres à bruit : rend le son reproductible'}
  }, required: ['kind'], additionalProperties: false},
  exec: function(a){
    const r = createSoundProc(a);
    return 'son « ' + r.asset.name + ' » créé : ' + r.secondes.toFixed(2) + ' s, '
      + Math.round(r.wav.length / 1024) + ' Ko, WAV mono ' + Math.round(SOUND_PROC_SR / 1000)
      + ' kHz. Attachez-le avec `configure_audio`, ou écoutez-le avec `play_sound`. '
      + 'L\'auteur devant l\'écran peut aussi le fabriquer à la main, et l\'ÉCOUTER avant de le '
      + 'créer : bouton « 🎲 Fabriquer » du panneau Projet.';
  }
});

// ---------- Les bruitages à recette (asset `sfx`, js/chip-synth.js) ----------
//
// Le pendant réglable de `create_sound` : l'asset garde sa RECETTE, donc « le même, plus grave » est
// une commande et pas un nouveau fichier. Les trois commandes passent par les MÊMES fonctions que le
// Rack sonore (createAssetSfx, setSfxRecipe) — règle de ce fichier, voir createSoundProc plus haut.
//
// Chaque retour décrit ce qu'on ENTEND en chiffres (describeSfx) : l'agent n'écoute pas, et sans la
// hauteur de départ et d'arrivée il ne saurait pas s'il a fait un saut qui monte ou qui descend.

const SFX_PRESETS_LIST = ['jump', 'coin', 'laser', 'explosion', 'hit', 'powerUp', 'blip', 'step'];

const SFX_RECIPE_SCHEMA = {type: 'object', description: 'recette, complète ou PARTIELLE (fusionnée '
  + 'champ par champ). Champs : wave (square|triangle|sawtooth|sine|noise), duty (0.05-0.5, timbre de '
  + 'la carrée), pitch {start Hz, slide demi-tons/s, slideAccel, min Hz}, vibrato {depth demi-tons, '
  + 'speed Hz}, arpeggio {semitones, at 0-1}, envelope {attack, sustain, punch 0-1, decay} en secondes, '
  + 'filter {lowpass 0-1 (1 = ouvert), resonance, highpass}, crush {bits 1-16, downsample 1-16}, '
  + 'repeat (s, relance la hauteur), volume 0-1, seed'};

/** Une liste de messages sans doublons, dans l'ordre. */
function dedupe(list){
  return list.filter(function(m, i){ return list.indexOf(m) === i; });
}

function sfxAssetNamed(name){
  const a = assets.find(function(x){ return x.kind === 'sfx' && x.name === name; });
  if(!a){
    const dispo = assets.filter(function(x){ return x.kind === 'sfx'; }).map(function(x){ return x.name; });
    throw new Error('aucun bruitage nommé « ' + name + ' ». Bruitages du projet : '
      + (dispo.join(', ') || 'aucun — créez-en un avec create_sfx'));
  }
  return a;
}

function sfxReport(verbe, a, avertissements){
  return 'bruitage « ' + a.name + ' » ' + verbe + ' : ' + JSON.stringify(describeSfx(a.recipe))
    + (avertissements && avertissements.length ? '\n' + avertissements.join('\n') : '')
    + '\nÉcoutez-le avec `play_sound`, attachez-le avec `configure_audio`.';
}

CopilotTools.register({
  name: 'create_sfx',
  description: 'FABRIQUE un bruitage RÉGLABLE (asset « sfx ») : un preset, une recette, ou un preset '
    + 'retouché par une recette partielle. Contrairement à `create_sound`, la recette est gardée : '
    + '`edit_sfx` et `mutate_sfx` la retouchent ensuite. Presets : jump (monte), coin (deux notes), '
    + 'laser (descend vite), explosion (bruit grave), hit, powerUp, blip (interface), step (pas). '
    + 'Une autre `seed` donne une autre variante du même preset.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom de l\'asset créé'},
    preset: {type: 'string', enum: SFX_PRESETS_LIST},
    seed: {type: 'number', description: 'variante du preset (entier)'},
    recipe: SFX_RECIPE_SCHEMA
  }, required: ['name'], additionalProperties: false},
  exec: function(a){
    const base = a.preset ? presetSfx(a.preset, a.seed === undefined ? 1 : a.seed) : null;
    if(a.preset && !base) throw new Error('preset inconnu : « ' + a.preset + ' »');
    const soucis = a.recipe ? validateSfx(a.recipe) : [];
    const recipe = mergeSfx(base || {}, a.recipe || {});
    pushHistory();
    const asset = createAssetSfx(recipe, {name: String(a.name)});
    return sfxReport('créé', asset, soucis);
  }
});

CopilotTools.register({
  name: 'edit_sfx',
  description: 'Retouche la recette d\'un bruitage existant : seuls les champs donnés changent '
    + '(« plus grave » = `{pitch: {start: 300}}`). Annulable par Ctrl+Z.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom du bruitage'},
    recipe: SFX_RECIPE_SCHEMA
  }, required: ['name', 'recipe'], additionalProperties: false},
  exec: function(a){
    const asset = sfxAssetNamed(a.name);
    // Deux validations : la recette PARTIELLE (champs inconnus, valeurs hors bornes, telles que
    // l'agent les a écrites) et la recette FUSIONNÉE (la durée totale ne se juge qu'avec l'enveloppe
    // complète — `{decay: 3}` seul ne disait rien d'une attaque et d'un maintien déjà longs).
    const soucis = dedupe(validateSfx(a.recipe).concat(validateSfx(mergeSfx(asset.recipe, a.recipe))));
    setSfxRecipe(asset, mergeSfx(asset.recipe, a.recipe));
    if(typeof refreshSoundRack === 'function') refreshSoundRack();
    return sfxReport('modifié', asset, soucis);
  }
});

CopilotTools.register({
  name: 'mutate_sfx',
  description: 'Une VARIANTE voisine d\'un bruitage : chaque réglage bouge un peu, l\'onde reste. Sert '
    + 'à proposer trois sauts et laisser l\'auteur choisir à l\'oreille. `asNew` crée un nouvel asset '
    + 'au lieu de modifier celui-ci.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom du bruitage de départ'},
    amount: {type: 'number', description: '0 à 1 (défaut 0.3) — de la retouche à la transformation'},
    seed: {type: 'number', description: 'rend la variante reproductible'},
    asNew: {type: 'string', description: 'nom du NOUVEL asset ; absent : modifie l\'asset lui-même'}
  }, required: ['name'], additionalProperties: false},
  exec: function(a){
    const asset = sfxAssetNamed(a.name);
    const seed = a.seed === undefined ? Math.floor(Math.random() * 1000000) + 1 : a.seed;
    const recipe = mutateSfx(asset.recipe, a.amount, seed);
    if(a.asNew){
      pushHistory();
      return sfxReport('créé (variante de « ' + asset.name + ' »)',
        createAssetSfx(recipe, {name: String(a.asNew), folder: asset.folder}));
    }
    setSfxRecipe(asset, recipe);
    if(typeof refreshSoundRack === 'function') refreshSoundRack();
    return sfxReport('muté', asset);
  }
});

// ---------- Les boucles musicales (asset `musicLoop`, js/music-loop.js) ----------
//
// Percussions, basse, mélodie et accords dans une tonalité et une gamme. Le format est fait pour être
// écrit ici : une piste est une chaîne de jetons, un par double croche. Mêmes fonctions que le module
// BX-16 du rack (createAssetLoop, setLoopRecipe).

const LOOP_RECIPE_SCHEMA = {type: 'object', description: 'recette, complète ou PARTIELLE (fusionnée). '
  + 'tempo (40-240), swing (0-0.5), bars (1-4, 16 pas par mesure), key (C, C#, D… B), scale (major, '
  + 'minor, harmonicMinor, dorian, phrygian, mixolydian, pentatonicMajor, pentatonicMinor, blues, '
  + 'chromatic). drums {volume, lanes {kick, snare, closedHat, openHat, clap, tomLow, tomHigh, cowbell : '
  + 'chaîne de pas « x...X... », X = accent}}. bass et melody {instrument, volume, notes : jetons séparés '
  + 'par des espaces, un par pas — « C5 » une note, « - » tenue de la précédente, « . » silence, suffixe '
  + '« ! » accent, « | » ignoré}. chords {instrument, style pad|stab|arp, perBar 1|2, octave 2-6, volume, '
  + 'progression : « Am F C G » (qualités m, 7, maj7, m7, dim, aug, sus2, sus4)}. Instruments : lead, '
  + 'chip, pluck, flute, bass, acid, pad, organ. volume général 0-1.'};

function loopAssetNamed(name){
  const a = assets.find(function(x){ return x.kind === 'musicLoop' && x.name === name; });
  if(!a){
    const dispo = assets.filter(function(x){ return x.kind === 'musicLoop'; }).map(function(x){ return x.name; });
    throw new Error('aucune boucle nommée « ' + name + ' ». Boucles du projet : '
      + (dispo.join(', ') || 'aucune — créez-en une avec create_music_loop'));
  }
  return a;
}

function loopReport(verbe, a, avertissements){
  return 'boucle « ' + a.name + ' » ' + verbe + ' : ' + JSON.stringify(describeLoop(a.recipe))
    + (avertissements && avertissements.length ? '\n' + avertissements.join('\n') : '')
    + '\nPosez-la sur un objet avec `configure_audio` (loop: true, spatial: false, bus: music).';
}

CopilotTools.register({
  name: 'create_music_loop',
  description: 'COMPOSE une boucle musicale (asset « musicLoop ») : percussions, basse, mélodie et '
    + 'accords, dans une tonalité et une gamme. Partir d\'un `preset` (pop, chiptune, lofi) et le '
    + 'retoucher, ou écrire la recette entière. Les notes hors gamme sont signalées. La recette reste '
    + 'modifiable (`edit_music_loop`) et l\'auteur la retouche dans le module BX-16 du Rack sonore.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom de l\'asset créé'},
    preset: {type: 'string', enum: ['pop', 'chiptune', 'lofi']},
    recipe: LOOP_RECIPE_SCHEMA
  }, required: ['name'], additionalProperties: false},
  exec: function(a){
    const base = a.preset ? presetLoop(a.preset) : null;
    if(a.preset && !base) throw new Error('preset inconnu : « ' + a.preset + ' »');
    const recipe = mergeLoop(base || {}, a.recipe || {});
    // La recette BRUTE d'abord : une fois fusionnée elle est normalisée, et une gamme, une tonalité ou
    // un instrument inconnus y sont déjà remplacés en silence. La recette fusionnée ensuite, pour les
    // notes hors gamme (revue du 2026-09-29, § 3.1).
    const soucis = dedupe((a.recipe ? validateLoop(a.recipe) : []).concat(validateLoop(recipe)));
    pushHistory();
    return loopReport('créée', createAssetLoop(recipe, {name: String(a.name)}), soucis);
  }
});

// LIRE avant de retoucher. L'auteur modifie ses boucles et ses bruitages à la main dans le rack : sans
// cette commande, le copilote ne connaîtrait que ce qu'il avait lui-même écrit, et sa retouche suivante
// écraserait le travail de l'auteur sans le savoir.
CopilotTools.register({
  name: 'read_sound_asset',
  description: 'Rend la RECETTE COMPLÈTE d\'un bruitage (sfx) ou d\'une boucle musicale (musicLoop), '
    + 'telle qu\'elle est maintenant — y compris ce que l\'auteur a changé à la main dans le Rack '
    + 'sonore. À lire AVANT `edit_sfx` / `edit_music_loop` quand l\'asset a pu être retouché.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom du bruitage ou de la boucle'}
  }, required: ['name'], additionalProperties: false},
  exec: function(a){
    const asset = assets.find(function(x){ return (x.kind === 'sfx' || x.kind === 'musicLoop') && x.name === a.name; });
    if(!asset){
      const dispo = assets.filter(function(x){ return x.kind === 'sfx' || x.kind === 'musicLoop'; })
        .map(function(x){ return x.name + ' (' + x.kind + ')'; });
      throw new Error('aucun bruitage ni boucle nommé « ' + a.name + ' ». Disponibles : ' + (dispo.join(', ') || 'aucun'));
    }
    const resume = asset.kind === 'sfx' ? describeSfx(asset.recipe) : describeLoop(asset.recipe);
    return asset.kind + ' « ' + asset.name + ' » : ' + JSON.stringify(asset.recipe)
      + '\nCe qu\'on entend : ' + JSON.stringify(resume);
  }
});

CopilotTools.register({
  name: 'edit_music_loop',
  description: 'Retouche une boucle : seuls les champs donnés changent (une piste, une ligne de '
    + 'percussion, le tempo…). `key`/`scale` seuls (sans notes) TRANSPOSENT la boucle et recalent '
    + 'ses notes et ses accords sur la nouvelle gamme. Annulable par Ctrl+Z.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom de la boucle'},
    recipe: LOOP_RECIPE_SCHEMA
  }, required: ['name', 'recipe'], additionalProperties: false},
  exec: function(a){
    const asset = loopAssetNamed(a.name);
    const p = a.recipe || {};
    let base = asset.recipe;
    const touchesNotes = (p.melody && p.melody.notes !== undefined) || (p.bass && p.bass.notes !== undefined)
      || (p.chords && p.chords.progression !== undefined);
    if((p.key !== undefined || p.scale !== undefined) && !touchesNotes) base = retuneLoop(base, p.key, p.scale);
    const recipe = mergeLoop(base, p);
    const soucis = dedupe(validateLoop(p).concat(validateLoop(recipe)));
    setLoopRecipe(asset, recipe);
    if(typeof refreshSoundRack === 'function') refreshSoundRack();
    return loopReport('modifiée', asset, soucis);
  }
});

CopilotTools.register({
  name: 'play_sound',
  description: 'Joue un son UNE FOIS, tout de suite, sans l\'attacher à quoi que ce soit. Sert à '
    + 'écouter un asset pour vérifier qu\'il est bien celui qu\'on croit, avant de le poser sur un '
    + 'objet — un nom de fichier ne dit pas ce qu\'on entend.',
  schema: {type: 'object', properties: {
    sound: {type: 'string', description: 'nom de l\'asset audio'},
    volume: {type: 'number', description: '0 à 2 (défaut 1)'}
  }, required: ['sound'], additionalProperties: false},
  exec: function(a){
    const asset = assets.find(function(x){ return isPlayableAudio(x) && x.name === a.sound; });
    if(!asset){
      const dispo = assets.filter(isPlayableAudio)
                          .map(function(x){ return x.name; });
      throw new Error('aucun son nommé « ' + a.sound + ' ». Sons du projet : '
        + (dispo.join(', ') || 'none'));
    }
    playSoundGlobal(asset.name, a.volume === undefined ? 1 : Number(a.volume), null);
    // On DIT que le son part dans l'éditeur et non dans le jeu : un agent qui ne l'entend pas ne peut
    // pas le savoir autrement, et il conclurait à un échec.
    return 'son « ' + asset.name + ' » joué une fois dans l\'éditeur (l\'agent ne l\'entend pas ; '
      + 'c\'est l\'auteur devant l\'écran qui l\'entend)';
  }
});

CopilotTools.register({
  name: 'summarize_scene',
  description: 'Un RÉSUMÉ compact du projet : compte d\'objets par type, composants utilisés, assets '
    + 'par genre, bounds du décor 2D, points de reprise. À préférer à `list_scene` pour se repérer : '
    + 'lister rend tout, et sur un vrai projet cela remplit le contexte sans rien apprendre.',
  schema: {type: 'object', properties: {}, additionalProperties: false},
  exec: function(){ return JSON.stringify(summarizeScene(), null, 1); }
});

// ---------- Les outils qui font du CONTENU des assets ----------
//
// Constaté en faisant construire un jeu façon Age of Empires par un agent MCP (2026-09-29) : faute
// d'outils, tout le contenu — statistiques, modèles, sons, carte — avait fini dans un seul script
// de 180 000 caractères, invisible dans le panneau Projet. Le moteur savait créer ces assets à la
// main, pas par le copilote. Il manquait :
//
//   create_material  un matériau SANS objet (configure_material_pbr exige un objet porteur) ;
//   import_model     un modèle glTF/GLB (instantiate_model ne pose qu'un modèle déjà importé) ;
//   import_audio     un vrai fichier son (create_sound / create_sfx ne font que du synthétisé) ;
//   read_data        relire une table (create_data écrivait à l'aveugle) ;
//   write_animation  un clip à clés (seuls les clips d'un modèle importé existaient) ;
//   read_asset       relire n'importe quel asset de contenu, pour le retoucher au lieu de le refaire.
//
// Le contrôle symétrique — refuser un script qui porte du contenu — est js/script-asset-lint.js.


/** Un chemin de dossier du panneau Projet, nettoyé ; lève sur `..`. */
function cleanFolder(f, byDefault){
  const folder = String(f === undefined ? byDefault : f).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if(folder.split('/').some(function(s){ return s === '..'; })) throw new Error('chemin de dossier invalide');
  return folder;
}

/** base64 (avec ou sans préfixe data:) → octets. */
function decodeBase64(s, what){
  const b64 = String(s || '').replace(/^data:[^;,]*;base64,/, '').replace(/\s+/g, '');
  if(!b64) throw new Error(what + ' est vide');
  let bin;
  try { bin = atob(b64); } catch(e){ throw new Error(what + ' n\'est pas du base64 valide'); }
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function byName(kind, name){
  return assets.find(function(x){ return x.kind === kind && x.name === name; }) || null;
}

// ---------- create_material ----------
CopilotTools.register({
  name: 'create_material',
  description: 'Crée (ou met à jour) un ASSET matériau du projet, sans objet porteur : il apparaît '
    + 'dans le panneau Projet, se retouche dans l\'inspecteur et s\'affecte ensuite aux objets '
    + '(configure_material_pbr avec `material`). Mêmes propriétés que describe_material ; une '
    + 'propriété texture prend le nom d\'un asset texture.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom de l\'asset matériau'},
    folder: {type: 'string', description: 'dossier (défaut « Materials »)'},
    properties: {type: 'object', additionalProperties: true,
      description: 'clé de describe_material → valeur'}
  }, required: ['name'], additionalProperties: false},
  exec: function(a){
    const name = String(a.name || '').trim();
    if(!name) throw new Error('le nom du matériau est vide');
    const folder = cleanFolder(a.folder, 'Materials');
    // Tout valider AVANT de toucher au projet : un matériau à moitié réglé ne sert à rien.
    const values = {}, refusal = [];
    Object.keys(a.properties || {}).forEach(function(key){
      const d = propMaterialByKey(key);
      if(!d){ refusal.push('propriété inconnue : ' + key); return; }
      const value = a.properties[key];
      if(d.type === 'texture'){
        if(value === null || value === ''){ values[key] = null; return; }
        const tex = byName('texture', value);
        if(!tex){ refusal.push(d.label + ' : texture introuvable : ' + value); return; }
        values[key] = tex.id;
        return;
      }
      values[key] = value;
    });
    if(refusal.length) throw new Error(refusal.join(' · '));
    pushHistory();
    let asset = byName('material', name);
    const created = !asset;
    if(!asset){ asset = createAssetMaterial(); asset.name = name; asset.folder = folder; }
    Object.keys(values).forEach(function(key){
      const d = propMaterialByKey(key);
      if(d.type === 'texture'){ asset.props[key] = values[key]; return; }
      const v = validatePropMaterial(key, values[key], asset.props);
      if(!v.ok){ refusal.push(v.message); return; }
      asset.props[key] = v.value;
    });
    applyMaterialEverywhere(asset);
    updateProject();
    if(refusal.length) throw new Error('matériau « ' + name + ' » ' + (created ? 'créé' : 'gardé') + ', mais : ' + refusal.join(' · '));
    return 'matériau « ' + name + ' » ' + (created ? 'créé dans ' + (folder || 'la racine') : 'mis à jour')
      + ' : ' + JSON.stringify(a.properties || {});
  }
});

// ---------- import_model ----------
/**
 * RÉIMPORT EN PLACE : `fresh` (un modèle tout juste chargé) remplace le contenu de `target`, qui
 * garde son id — instances posées et prefabs qui le référencent suivent. `fresh` et ses clips
 * quittent le projet. `explicit` : réglages d'import donnés par l'appel (centrer, setGround…),
 * qui priment sur ceux de `target`. Rend {instances, prefabs}. Partie pure : js/model-replace.js.
 */
export function replaceModelAsset(target, fresh, explicit){
  if(!target || target.kind !== 'model' || !fresh || fresh.kind !== 'model') throw new Error('remplacement : deux assets modèle attendus');
  // 1. `fresh` sort du projet (et ses clips) : il n'a servi qu'à charger le fichier.
  removeClipAssetsOfModel(fresh);
  const k = assets.indexOf(fresh);
  if(k !== -1) assets.splice(k, 1);
  // 2. Le contenu passe, l'identité reste. Un clip neuf reçoit ses réglages par défaut à la
  //    synchronisation (clipAssetOfModel normalise).
  transferModelContent(target, fresh);
  const p = target.paramsImport = mergeReplacedParams(target.paramsImport, explicit);
  p.clips = reconcileClips(p.clips, takesOfModel(target), function(take){ return {id: newClipId(), name: take, take: take}; });
  if(p.clips === undefined) delete p.clips;
  // 3. Normalisation selon les réglages (clips resynchronisés), puis instances rebâties : la
  //    géométrie a changé, pas seulement la structure.
  applyImportModel(target, true);
  const instances = rebuildInstancesStructure(target);
  // 4. Les gabarits de prefab qui embarquent ce modèle : même reconstruction, HORS scène (un
  //    gabarit n'est pas un objet de la scène : rien n'est indexé).
  let prefabs = 0;
  assets.forEach(function(x){
    if(x.kind !== 'prefab' || !x.template) return;
    const roots = modelRootsIn(x.template, target.id);
    roots.forEach(function(o){
      const overrides = (typeof captureModelOverrides === 'function') ? captureModelOverrides(o, null, serializeComponentsOf) : null;
      o.children.slice().forEach(function(c){
        if(!(isSceneObject(c) && c.userData.modelNode === undefined)) o.remove(c);   // garde les enfants de l'utilisateur
      });
      cloneModel(target.template).children.slice().forEach(function(c){ o.add(c); });
      o.animations = target.template.animations;
      exposeModelInstance(o, target);
      if(overrides && typeof applyModelOverrides === 'function'){
        applyModelOverrides(o, overrides, function(n, list){ applyComponents(n, list); },
          function(n){ if(typeof applyMaterialSlots === 'function') applyMaterialSlots(n); });
      }
    });
    if(roots.length){ prefabs += roots.length; x.preview = previewObject3D(x.template); }
  });
  updateProject();
  return {instances: instances, prefabs: prefabs};
}

/**
 * Importe un fichier modèle et rend {model, replaced} quand il est chargé. `replace` : un modèle
 * déjà nommé `replaceName` est mis à jour EN PLACE (même id) au lieu d'être doublé.
 */
export function importModelFile(file, opts){
  const o = opts || {};
  return new Promise(function(res, rej){
    const timer = setTimeout(function(){ rej(new Error('le modèle ne s\'est pas chargé en ' + Math.round((o.timeoutMs || 30000) / 1000) + ' s (voir read_console)')); }, o.timeoutMs || 30000);
    importFiles([file], {paramsImport: o.paramsImport || {},
      onModel: function(m){
        clearTimeout(timer);
        try{
          const target = o.replace ? assets.find(function(x){ return x.kind === 'model' && x !== m && x.name === o.replaceName; }) : null;
          if(!target) return res({model: m, replaced: null});
          const replaced = replaceModelAsset(target, m, o.paramsImport);
          if(project.handleFolder){
            writeAssetInFolder(project.handleFolder, target).catch(function(e){ console.warn('[réimport] ' + e.message); });
          }
          res({model: target, replaced: replaced});
        } catch(e){ rej(e); }
      },
      onError: function(e){ clearTimeout(timer); rej(e); }});
  });
}
CopilotTools.register({
  name: 'import_model',
  description: 'IMPORTE un modèle 3D comme asset du projet : `glb` (binaire glTF en base64) ou `gltf` '
    + '(JSON glTF dont les buffers et images sont embarqués en data:). Ses matériaux et clips '
    + 'd\'animation deviennent des sous-assets, comme à l\'import manuel. Poser ensuite des exemplaires '
    + 'avec instantiate_model. Par défaut l\'import RECENTRE le modèle en X/Z et pose sa base à Y=0 '
    + '(le pivot bouge) : `center:false` / `setGround:false` gardent le pivot du fichier (charnière, '
    + 'porte…). `replace:true` met à jour le modèle existant de même nom EN PLACE (même id : prefabs et '
    + 'instances suivent) au lieu d\'en créer un second.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom de l\'asset modèle'},
    glb: {type: 'string', description: 'fichier .glb en base64'},
    gltf: {type: 'string', description: 'fichier .gltf (texte JSON, ressources embarquées)'},
    folder: {type: 'string', description: 'dossier (défaut « Models »)'},
    center: {type: 'boolean', description: 'recentrer en X/Z (défaut true)'},
    setGround: {type: 'boolean', description: 'poser la base à Y=0 (défaut true)'},
    replace: {type: 'boolean', description: 'remplacer en place le modèle existant de même nom'}
  }, required: ['name'], additionalProperties: false},
  exec: async function(a){
    const name = String(a.name || '').trim();
    if(!name) throw new Error('le nom du modèle est vide');
    if(!a.glb === !a.gltf) throw new Error('fournir exactement un de `glb` ou `gltf`');
    let file;
    if(a.glb){
      const bytes = decodeBase64(a.glb, 'le GLB');
      // en-tête glTF binaire : « glTF » puis la version
      if(bytes.length < 12 || bytes[0] !== 0x67 || bytes[1] !== 0x6c || bytes[2] !== 0x54 || bytes[3] !== 0x46)
        throw new Error('ce n\'est pas un fichier GLB (signature « glTF » absente)');
      file = new File([bytes], slugFile(name) + '.glb', {type: 'model/gltf-binary'});
    } else {
      let j;
      try { j = JSON.parse(a.gltf); } catch(e){ throw new Error('glTF : JSON invalide : ' + e.message); }
      if(!j.asset || !j.asset.version) throw new Error('glTF : champ asset.version absent');
      const external = (j.buffers || []).concat(j.images || []).filter(function(b){ return b.uri && !/^data:/.test(b.uri); });
      if(external.length) throw new Error('glTF : ' + external.length + ' ressource(s) externe(s) — embarquez-les en data: ou envoyez un GLB');
      file = new File([a.gltf], slugFile(name) + '.gltf', {type: 'model/gltf+json'});
    }
    const folder = cleanFolder(a.folder, 'Models');
    const before = new Set(assets.map(function(x){ return x.id; }));
    const folderBefore = folderCurrent;
    pushHistory();
    // L'importeur range au dossier COURANT, lu quand le chargement aboutit : on le pose le temps
    // de l'import, et on le rend ensuite.
    setFolderCurrent(folder);
    try {
      const r = await importModelFile(file, {paramsImport: explicitPivotParams(a), replace: !!a.replace, replaceName: name});
      const model = r.model;
      model.name = name;
      updateProject();
      const added = assets.filter(function(x){ return !before.has(x.id); });
      const kinds = {};
      added.forEach(function(x){ kinds[x.kind] = (kinds[x.kind] || 0) + 1; });
      const pivotText = describePivot(model.paramsImport) + '.';
      if(r.replaced){
        return 'modèle « ' + name + ' » (id ' + model.id + ') RÉIMPORTÉ EN PLACE : même id, '
          + r.replaced.instances + ' instance(s) et ' + r.replaced.prefabs + ' prefab(s) mis à jour. ' + pivotText;
      }
      return 'modèle « ' + name + ' » (id ' + model.id + ') importé dans ' + (model.folder || 'la racine') + ' — assets créés : '
        + JSON.stringify(kinds) + '. ' + pivotText
        + (a.replace ? ' (replace : aucun modèle de ce nom à remplacer, un nouvel asset a été créé.)' : '')
        + ' Posez-le avec instantiate_model.';
    } finally {
      setFolderCurrent(folderBefore);
    }
  }
});

// ---------- import_audio ----------
const AUDIO_TYPES = {mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4'};
CopilotTools.register({
  name: 'import_audio',
  description: 'IMPORTE un fichier son (mp3, wav, ogg, m4a en base64) comme asset audio du projet — '
    + 'pour une voix, une ambiance, une musique enregistrée. Un script le joue avec api.playSound(nom), '
    + 'une source audio le référence (configure_audio). Pour un bruitage fabriqué, préférer create_sfx.',
  schema: {type: 'object', properties: {
    name: {type: 'string', description: 'nom de l\'asset son'},
    data: {type: 'string', description: 'contenu du fichier en base64'},
    format: {type: 'string', enum: Object.keys(AUDIO_TYPES)},
    folder: {type: 'string', description: 'dossier (défaut « Audio »)'}
  }, required: ['name', 'data', 'format'], additionalProperties: false},
  exec: function(a){
    const name = String(a.name || '').trim();
    if(!name) throw new Error('le nom du son est vide');
    const type = AUDIO_TYPES[a.format];
    if(!type) throw new Error('format inconnu : ' + a.format + ' (' + Object.keys(AUDIO_TYPES).join(', ') + ')');
    const bytes = decodeBase64(a.data, 'le son');
    const folder = cleanFolder(a.folder, 'Audio');
    pushHistory();
    const file = new File([bytes], slugFile(name) + '.' + a.format, {type: type});
    const au = createAssetAudio(file, {name: name});
    if(folder) moveAssetTo(au, folder, {silent: true});
    return 'son « ' + name + ' » importé (' + Math.round(bytes.length / 1024) + ' Ko) dans ' + (folder || 'la racine');
  }
});

// ---------- configure_fog_of_war ----------
CopilotTools.register({
  name: 'configure_fog_of_war',
  description: 'BROUILLARD DE GUERRE. Avec `fog` : pose/règle le composant FogOfWar sur l\'objet `name` '
    + '(origin [x, z] = coin minimal de la grille, cellSize en mètres, cols × rows, team = équipe du joueur, '
    + 'allies, color, exploredOpacity, height de la surface). Avec `vision` : pose/règle le composant Vision '
    + '(radius en mètres, team, remember = reste affiché une fois aperçu — bâtiments, ressources ; radius 0 = '
    + 'ne voit rien mais peut être caché). Actif en jeu seulement. En script : fog.team = n, fog.revealAll = true.',
  schema: {type: 'object', properties: {
    name: {type: 'string'},
    fog: {type: 'object', properties: {
      origin: {type: 'array', items: {type: 'number'}}, cellSize: {type: 'number'}, cols: {type: 'number'}, rows: {type: 'number'},
      team: {type: 'number'}, allies: {type: 'array', items: {type: 'number'}}, color: {type: 'string'},
      exploredOpacity: {type: 'number'}, height: {type: 'number'}, updateInterval: {type: 'number'}}, additionalProperties: false},
    vision: {type: 'object', properties: {radius: {type: 'number'}, team: {type: 'number'}, remember: {type: 'boolean'}}, additionalProperties: false}
  }, required: ['name'], additionalProperties: false},
  exec: function(a){
    const o = objects.find(function(x){ return x.name === a.name; });
    if(!o) throw new Error('objet « ' + a.name + ' » introuvable (utilise list_scene)');
    if(!a.fog && !a.vision) throw new Error('donner `fog` et/ou `vision`');
    if(a.fog && a.fog.origin && !(a.fog.origin.length === 2)) throw new Error('fog.origin = [x, z]');
    if(a.fog && a.fog.color && !/^#[0-9a-fA-F]{6}$/.test(a.fog.color)) throw new Error('fog.color : #rrggbb');
    pushHistory();
    const out = [];
    if(a.fog){
      const f = o.getComponent('FogOfWar') || o.addComponent('FogOfWar', {});
      Object.keys(a.fog).forEach(function(k){ f.data[k] = a.fog[k]; });
      f.reset();
      out.push('brouillard ' + f.data.cols + ' × ' + f.data.rows + ' cases de ' + f.data.cellSize + ' m, équipe ' + f.data.team);
    }
    if(a.vision){
      const v = o.getComponent('Vision') || o.addComponent('Vision', {});
      Object.keys(a.vision).forEach(function(k){ v.data[k] = a.vision[k]; });
      out.push('vision rayon ' + v.radius + ' m, équipe ' + v.team + (v.remember ? ', mémorisée' : ''));
    }
    buildInspector();
    return '« ' + a.name + ' » : ' + out.join(' ; ');
  }
});

// ---------- configure_team_color ----------
CopilotTools.register({
  name: 'configure_team_color',
  description: 'Pose (ou règle) le composant TeamColor d\'un objet : les maillages descendants dont le '
    + 'matériau porte le nom `material` (défaut « Team ») sont teints à `color` pour CET objet seul — '
    + 'le gris du modèle multiplié par la couleur. Un seul modèle d\'unité sert ainsi aux huit joueurs. '
    + 'En jeu : api.me.getComponent(\'TeamColor\').color = \'#rrggbb\'.',
  schema: {type: 'object', properties: {
    name: {type: 'string'}, color: {type: 'string', description: '#rrggbb'},
    material: {type: 'string', description: 'nom du matériau équipe du modèle (défaut « Team »)'}
  }, required: ['name'], additionalProperties: false},
  exec: function(a){
    const o = objects.find(function(x){ return x.name === a.name; });
    if(!o) throw new Error('objet « ' + a.name + ' » introuvable (utilise list_scene)');
    if(a.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(a.color)) throw new Error('couleur invalide : « ' + a.color + ' » (attendu #rrggbb)');
    pushHistory();
    let c = o.getComponent('TeamColor');
    if(!c) c = o.addComponent('TeamColor', {});
    if(a.material !== undefined) c.material = a.material;
    if(a.color !== undefined) c.color = a.color;
    buildInspector();
    return 'couleur d\'équipe de « ' + a.name + ' » : ' + c.color + ' sur le matériau « ' + c.material + ' » — '
      + (c.tinted ? c.tinted + ' maillage(s) teint(s)' : 'aucun maillage ne porte ce matériau pour l\'instant');
  }
});

// ---------- write_script_asset ----------
// Une BIBLIOTHÈQUE (api.lib, js/script-library.js) n'est attachée à aucun objet : attach_script ne
// pouvait donc pas la créer. Même contrôle de contenu que les scripts attachés.
CopilotTools.register({
  name: 'write_script_asset',
  description: 'Crée ou réécrit un asset script SANS l\'attacher à un objet. Sert surtout aux '
    + 'BIBLIOTHÈQUES : un script qui remplit `exports` (exports.f = function(){…}) au lieu de définir '
    + 'start/update, lu depuis n\'importe quel script par api.lib(nom) — exécuté une fois par partie, '
    + 'le même objet pour tous. C\'est ainsi qu\'on découpe une logique en scripts courts qui partagent '
    + 'un noyau. Une bibliothèque reçoit api.lib, api.data, api.log/warn/error — pas api.me.',
  schema: {type: 'object', properties: {
    name: {type: 'string'}, code: {type: 'string'},
    folder: {type: 'string', description: 'dossier (défaut « Scripts »)'}
  }, required: ['name', 'code'], additionalProperties: false},
  exec: function(a){
    const name = String(a.name || '').trim();
    if(!name) throw new Error('le nom du script est vide');
    const warn = enforceScriptAssets(a.code);
    const folder = cleanFolder(a.folder, 'Scripts');
    pushHistory();
    let s = byName('script', name);
    const created = !s;
    if(s) s.code = a.code;
    else { s = newAssetScript(name, a.code); if(folder) moveAssetTo(s, folder, {silent: true}); }
    // Un script RÉÉCRIT peut être attaché : ses porteurs reçoivent les défauts des clés @vars
    // nouvelles dès maintenant, pas seulement à la prochaine compilation en jeu.
    const holders = created ? 0 : syncScriptVarsOfAsset(s);
    updateProject();
    return 'script « ' + name + ' » ' + (created ? 'créé dans ' + (folder || 'la racine') : 'réécrit')
      + ' (' + a.code.length + ' caractères' + (holders ? ', ' + holders + ' objet(s) mis à jour' : '') + ')' + warn;
  }
});

// ---------- read_data ----------
CopilotTools.register({
  name: 'read_data',
  description: 'Rend le contenu JSON d\'une table (asset data). À lire avant de la modifier avec '
    + 'create_data : le créateur a pu la retoucher à la main depuis.',
  schema: {type: 'object', properties: {name: {type: 'string'}}, required: ['name'], additionalProperties: false},
  exec: function(a){
    const d = byName('data', a.name);
    if(!d){
      throw new Error('table « ' + a.name + ' » introuvable. Tables : '
        + (assets.filter(function(x){ return x.kind === 'data'; }).map(function(x){ return x.name; }).join(', ') || '(aucune)'));
    }
    return d.text || '';
  }
});

// ---------- write_animation ----------
// Euler XYZ en degrés → quaternion [x, y, z, w] (même ordre que THREE.Euler par défaut).
export function quatFromEulerDeg(r){
  const h = Math.PI / 360;
  const c1 = Math.cos(r[0] * h), c2 = Math.cos(r[1] * h), c3 = Math.cos(r[2] * h);
  const s1 = Math.sin(r[0] * h), s2 = Math.sin(r[1] * h), s3 = Math.sin(r[2] * h);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
const EASINGS = ['lineaire', 'acc', 'dec', 'douce', 'palier'];
const vec3 = function(v){ return Array.isArray(v) && v.length === 3 && v.every(function(x){ return typeof x === 'number' && isFinite(x); }); };

/** Pistes du copilote → pistes de l'asset ({filePath, os, keys:[{t,pos,quat,ech,easing}]}). */
export function tracksFromSpec(spec){
  if(!Array.isArray(spec) || !spec.length) throw new Error('au moins une piste est requise');
  return spec.map(function(tr, n){
    const keys = (tr.keys || []).slice().sort(function(x, y){ return x.t - y.t; });
    if(keys.length < 2) throw new Error('piste ' + n + ' : au moins deux clés (une seule fige la pose)');
    let pos = null, rot = null, ech = null;
    // `os` : clé du format sérialisé des pistes (js/animation.js), pas un identifiant à renommer.
    return {filePath: String(tr.target || ''), 'os': tr.bone || null, keys: keys.map(function(k, i){
      if(typeof k.t !== 'number' || k.t < 0) throw new Error('piste ' + n + ', clé ' + i + ' : t doit être un nombre ≥ 0');
      if(k.position !== undefined){ if(!vec3(k.position)) throw new Error('piste ' + n + ', clé ' + i + ' : position = [x, y, z]'); pos = k.position; }
      if(k.rotation !== undefined){ if(!vec3(k.rotation)) throw new Error('piste ' + n + ', clé ' + i + ' : rotation = [x, y, z] en degrés'); rot = k.rotation; }
      if(k.scale !== undefined){ if(!vec3(k.scale)) throw new Error('piste ' + n + ', clé ' + i + ' : scale = [x, y, z]'); ech = k.scale; }
      // La PREMIÈRE clé doit tout dire : une piste pose position, rotation ET échelle, et une
      // valeur devinée (0, 0, 0) téléporterait l'objet à l'origine sans que rien ne le signale.
      if(!pos || !rot || !ech) throw new Error('piste ' + n + ' : la première clé doit donner position, rotation et scale');
      if(k.easing !== undefined && EASINGS.indexOf(k.easing) === -1) throw new Error('piste ' + n + ', clé ' + i + ' : easing ∈ ' + EASINGS.join(', '));
      const key = {t: k.t, pos: pos.slice(), quat: quatFromEulerDeg(rot), ech: ech.slice()};
      if(k.easing && k.easing !== 'lineaire') key.easing = k.easing;
      return key;
    })};
  });
}

CopilotTools.register({
  name: 'write_animation',
  description: 'Crée ou réécrit un CLIP d\'animation à clés (asset « animation », éditable dans la '
    + 'timeline) : une piste par objet animé, désigné par son chemin relatif à la racine du clip '
    + '(`target` : "" = la racine, "Bras/Main" = un descendant) ou par `bone` pour un os. Chaque clé : '
    + 't (secondes), position [x,y,z], rotation [x,y,z] en degrés, scale [x,y,z] — la première clé les '
    + 'donne tous, les suivantes reprennent la valeur précédente si omise — et easing '
    + '(lineaire, acc, dec, douce, palier). Brancher ensuite le clip dans un Animator '
    + '(write_animator_machine) ou le jouer par script.',
  schema: {type: 'object', properties: {
    name: {type: 'string'},
    folder: {type: 'string', description: 'dossier (défaut « Animations »)'},
    loop: {type: 'boolean'},
    duration: {type: 'number', description: 'durée en secondes (défaut : la dernière clé)'},
    fps: {type: 'number', description: 'images par seconde de l\'échantillonnage (défaut 60)'},
    tracks: {type: 'array', items: {type: 'object', properties: {
      target: {type: 'string'}, bone: {type: 'string'},
      keys: {type: 'array', items: {type: 'object', properties: {
        t: {type: 'number'}, position: {type: 'array', items: {type: 'number'}},
        rotation: {type: 'array', items: {type: 'number'}}, scale: {type: 'array', items: {type: 'number'}},
        easing: {type: 'string', enum: EASINGS}
      }, required: ['t']}}
    }, required: ['keys']}}
  }, required: ['name', 'tracks'], additionalProperties: false},
  exec: function(a){
    const name = String(a.name || '').trim();
    if(!name) throw new Error('le nom de l\'animation est vide');
    const tracks = tracksFromSpec(a.tracks);
    const folder = cleanFolder(a.folder, 'Animations');
    let asset = assets.find(function(x){ return x.kind === 'animation' && x.name === name && !x.embedded; });
    if(asset && asset.source && asset.source.type !== 'keys')
      throw new Error('« ' + name + ' » est le clip d\'un modèle importé : choisissez un autre nom');
    pushHistory();
    const created = !asset;
    if(!asset){ asset = createAssetAnimation(null, null, name); asset.folder = folder; }
    asset.tracks = tracks;
    let last = 0;
    tracks.forEach(function(p){ p.keys.forEach(function(k){ if(k.t > last) last = k.t; }); });
    asset.duration = Math.max(last, Number(a.duration) || 0, 0.0001);
    if(a.loop !== undefined) asset.loop = !!a.loop;
    if(a.fps) asset.imagesBySeconde = Math.max(1, Math.min(240, Math.round(a.fps)));
    asset.rev = (asset.rev || 0) + 1;
    updateProject();
    const problems = (typeof validateAnimAsset === 'function') ? validateAnimAsset(asset, function(id){ return assets.find(function(x){ return x.id === id; }); }) : [];
    return 'animation « ' + name + ' » ' + (created ? 'créée dans ' + (folder || 'la racine') : 'réécrite')
      + ' : ' + tracks.length + ' piste(s), ' + asset.duration.toFixed(2) + ' s'
      + (problems.length ? ' ⚠ ' + problems.join(' · ') : '');
  }
});

// ---------- read_asset ----------
// Ce qu'un asset de contenu porte, sans ses octets : de quoi le relire et le retoucher.
const READERS = {
  material: function(x){ return {props: x.props, shaderId: x.shaderId || null}; },
  data: function(x){ return {text: x.text}; },
  animation: function(x){ return {source: x.source, duration: x.duration, loop: x.loop, fps: x.imagesBySeconde, tracks: x.tracks || []}; },
  animator: function(x){ return {machine: x.machine}; },
  sfx: function(x){ return {recipe: x.recipe}; },
  musicLoop: function(x){ return {recipe: x.recipe}; },
  tilePalette: function(x){ return {palette: x.palette}; },
  sprite: function(x){ return {textureId: x.textureId, ppu: x.ppu, regions: x.regions}; },
  postProfile: function(x){ return {effects: x.effects}; },
  documentUI: function(x){ return {html: x.html}; },
  sheetStyle: function(x){ return {css: x.css}; },
  script: function(x){ return {code: x.code}; },
  prefab: function(x){ return {tree: x.tree}; },
  texture: function(x){ return {paramsImport: x.paramsImport || null}; },
  audio: function(x){ return {duration: x.duration, paramsImport: x.paramsImport || null}; },
  model: function(x){ return {paramsImport: x.paramsImport || null, clips: ((x.template && x.template.animations) || []).map(function(c){ return c.name; })}; }
};
CopilotTools.register({
  name: 'read_asset',
  description: 'Rend le contenu sérialisé d\'un asset (matériau, table, animation, animator, bruitage, '
    + 'musique, palette, planche, profil, UI, script, prefab…) — sans les octets des fichiers binaires. '
    + 'À lire avant de retoucher un asset que le créateur a pu modifier à la main. `kind` départage '
    + 'deux assets de même nom.',
  schema: {type: 'object', properties: {name: {type: 'string'}, kind: {type: 'string'}}, required: ['name'], additionalProperties: false},
  exec: function(a){
    const list = assets.filter(function(x){ return x.name === a.name && (!a.kind || x.kind === a.kind); });
    if(!list.length) throw new Error('asset « ' + a.name + ' » introuvable (voir list_assets)');
    if(list.length > 1) throw new Error('plusieurs assets « ' + a.name + ' » : précisez `kind` parmi '
      + list.map(function(x){ return x.kind; }).join(', '));
    const x = list[0], rd = READERS[x.kind];
    return JSON.stringify(Object.assign({id: x.id, name: x.name, kind: x.kind, folder: x.folder || ''}, rd ? rd(x) : {}));
  }
});

// ---------- audit_project ----------
// analyze_scene regarde la scène ; ceci regarde le PROJET : le créateur peut-il retoucher ce que
// l'IA a fait ? Né d'Age of Ampyre, jeu entier caché dans un script et scène vide dans l'éditeur.
CopilotTools.register({
  name: 'audit_project',
  description: 'Audit de STRUCTURE du projet : script monolithique, niveau généré par un script au '
    + 'lancement, scène vide, réglages en dur sans @vars, objets à la racine ou mal nommés, assets '
    + 'en vrac. À appeler après une construction, avec analyze_scene, et à corriger avant de rendre la main.',
  schema: {type: 'object', properties: {}, additionalProperties: false},
  exec: function(){ return formatAudit(runProjectAudit()); }
});

/** L'audit du projet ouvert : l'instantané passé à auditProject (js/project-audit.js). */
function runProjectAudit(){
  const holders = {};
  objects.forEach(function(o){
    (o.userData.scripts || []).forEach(function(s){
      if(s && s.scriptId) holders[s.scriptId] = (holders[s.scriptId] || 0) + 1;
    });
  });
  const inScene = new Set(objects);
  const depthOf = function(o){
    let d = 0, p = o.parent;
    while(p && inScene.has(p)){ d++; p = p.parent; }
    return d;
  };
  return auditProject({
    scripts: assets.filter(function(x){ return x.kind === 'script'; }).map(function(x){
      return {name: x.name, folder: x.folder || '', code: x.code || '', holders: holders[x.id] || 0};
    }),
    objects: objects.map(function(o){ return {name: o.name, depth: depthOf(o), generic: isGenericName(o.name)}; }),
    assets: assets.map(function(x){
      const a = {kind: x.kind, name: x.name, folder: x.folder || ''};
      if(isValidated(project.settings.validatedAssets, x)){
        a.validated = true;
        a.changedSinceValidation = changedSinceValidation(project.settings.validatedAssets, x);
      }
      if(x.kind === 'documentUI') a.html = x.html || '';   // pour les classes d'état figées
      return a;
    }),
    violations: violationCounts()
  });
}

// save_project et play_and_measure ajoutent les points graves de l'audit à leur résultat : l'agent
// les lit à chaque étape, sans avoir à penser à appeler audit_project (copRun, js/copilot.js).
CopilotTools.auditGrave = function(){ return formatGraveIssues(runProjectAudit()); };

// copilot-blender.js (blender_import_to_project) passe par le même import : il ne peut pas importer
// ce fichier, absent en balise propre de editor.html (voir la note dans editor.html).
globalThis.importModelFile = importModelFile;

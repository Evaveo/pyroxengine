// ---------- Les RÉGLAGES DE PROJET : une seule place, et un seul exemplaire ----------
//
// Avant, `name`, `layers`, `layers2d`, `ppu2d`, `inputs`, `lightmap`, `design` et
// `versionVisible` étaient huit champs au premier niveau de `project` ET huit champs au premier
// niveau du fichier de projet. Trois conséquences mesurées :
//
//   1. rien ne disait ce qui était un réglage de PROJET et ce qui était une préférence
//      d'ÉDITEUR — les deux se mélangeaient dans le même objet ;
//   2. le manifeste du format dossier n'en écrivait AUCUN : un projet ouvert en dossier perdait
//      ses calques et ses entrées à chaque enregistrement ;
//   3. ajouter un réglage demandait de toucher `project.js`, `serialization.js`, le manifeste et
//      chaque lecteur — donc on n'en ajoutait pas.
//
// Ils vivent maintenant dans `project.settings`, et `project.layers` &co. n'en sont que des
// ACCESSEURS (voir project.js) : une seule donnée, deux façons de l'écrire.
//
// CE QUI N'EST PAS ICI, et pourquoi : les réglages de build, les unités
// et l'échelle, les réglages multijoueur — il n'y a pas de code derrière. Les réglages d'import
// sont par ASSET (assets.js), pas par projet.

// Les huit champs déplacés depuis le premier niveau. `projectName` est traité à part : il
// devient `settings.name`, donc il change aussi de nom.
import { sanitizeAudioBuses } from './audio-bus.js';
import { inputs } from './editor-input.js';
import { ENV_DEFAULT, env } from './environment.js';
import { LIGHTMAP_DEFAULT } from './lightmap-bake.js';
import { LOCALES_DEFAULT } from './locale.js';
import { INPUTS_DEFAULT } from './scripts.js';
import { newScene } from './serialization.js';

export const PROJECT_SETTINGS_KEYS_MIGRATED = ['layers', 'layers2d', 'ppu2d', 'inputs', 'lightmap',
                                        'locales', 'design', 'versionVisible'];

export const PROJECT_SETTINGS_KEYS = ['name', 'studio'].concat(PROJECT_SETTINGS_KEYS_MIGRATED,
                                              ['shadowDistance', 'shadowMapSize', 'newScene', 'network',
                                               'audioBuses', 'plugins', 'startScene', 'validatedAssets']);

// La portée des ombres, en unités monde.
export const SHADOW_DISTANCE_DEFAULT = 40;
export const SHADOW_DISTANCE_MIN = 5;
export const SHADOW_DISTANCE_MAX = 500;

/**
 * Ramène une portée d'ombre lue d'un fichier dans les bornes utilisables.
 *
 * Les deux bornes ne sont pas décoratives. En dessous de 5, la caméra d'ombre est plus petite
 * que la plupart des objets et l'ombre disparaît sous celui qui la projette. Au-dessus de 500,
 * un texte de la carte d'ombre couvre un demi-mètre de terrain : les contours deviennent si
 * mous qu'on ne distingue plus une ombre d'un dégradé, et la profondeur manque de précision
 * au point de faire flotter les objets au-dessus du sol.
 *
 * Une valeur ABSENTE rend le défaut ; une valeur illisible aussi — un `NaN` recopié d'un
 * fichier abîmé ne doit pas éteindre les ombres de tout le projet en silence.
 */
// Les résolutions proposées. Des puissances de deux : une carte d'ombre est une texture, et
// une taille non puissance de deux gaspille de la mémoire sans rien gagner en finesse.
export const SHADOW_MAP_SIZES = [1024, 2048, 4096];
export const SHADOW_MAP_SIZE_DEFAULT = 2048;

/**
 * Ramène une résolution lue d'un fichier sur la valeur proposée la plus proche.
 *
 * On ne « borne » pas ici, on CHOISIT dans la liste : une valeur intermédiaire (1500) donnerait
 * une texture non puissance de deux, que le pilote arrondirait de toute façon — autant que le
 * réglage dise la vérité sur ce qui sera alloué.
 */
export function clampShadowMapSize(value){
  const n = Number(value);
  if(!Number.isFinite(n)) return SHADOW_MAP_SIZE_DEFAULT;
  return SHADOW_MAP_SIZES.reduce(function(best, s){
    return Math.abs(s - n) < Math.abs(best - n) ? s : best;
  }, SHADOW_MAP_SIZE_DEFAULT);
}

export function clampShadowDistance(value){
  const n = Number(value);
  if(!Number.isFinite(n)) return SHADOW_DISTANCE_DEFAULT;
  return Math.min(Math.max(n, SHADOW_DISTANCE_MIN), SHADOW_DISTANCE_MAX);
}

export const LAYERS_DEFAULT = [
  {id:0, name:'Défaut', visible:true, verrouille:false},
  {id:1, name:'Joueur', visible:true, verrouille:false},
  {id:2, name:'Ennemis', visible:true, verrouille:false},
  {id:3, name:'Décor', visible:true, verrouille:false}
];

export const LAYERS2D_DEFAULT = ['Fond', 'Décor', 'Jeu', 'Premier plan', 'Interface'];
export const PPU2D_DEFAULT = 100;

/**
 * Le défaut que possède un AUTRE sous-système, ou `null` s'il n'est pas là.
 *
 * `INPUTS_DEFAULT` appartient à scripts.js, `LIGHTMAP_DEFAULT` à lightmap-bake.js et
 * `ENV_DEFAULT` à environment.js. En recopier la valeur ici en ferait un second exemplaire qui
 * divergerait au premier réglage ajouté — donc on la lit.
 *
 * `null` quand le fichier qui la porte n'est pas chargé : c'est le cas d'un test qui n'exerce
 * qu'une migration, et ce n'est pas grave, parce que `??` traite `null` comme une ABSENCE — le
 * champ sera rempli au prochain passage, celui que l'éditeur fait avec tous ses fichiers
 * (`applyProjectSettings`). Une migration doit DÉPLACER ; inventer le défaut d'un sous-système
 * qu'elle ne connaît pas n'est pas son travail.
 */
export function ownedDefault(value){
  return (value === undefined) ? null : JSON.parse(JSON.stringify(value));
}

/**
 * Lit une variable importée d'un autre module sans planter si ce module est encore en cours
 * d'initialisation (import circulaire : ce fichier est importé par `scripts.js`, qui l'importe
 * en retour, donc `INPUTS_DEFAULT` peut être dans sa zone morte temporelle au moment où
 * `project.js` construit `project.settings` à son chargement). `typeof` seul ne suffit pas : sur
 * un binding d'import en ZMT, il lève la même `ReferenceError` que l'accès direct — d'où le
 * `try/catch`.
 */
function readOwnedDefault(getter){
  try {
    return getter();
  } catch(e) {
    if(e instanceof ReferenceError) return undefined;
    throw e;
  }
}

/**
 * Les réglages de projet lus depuis une source — les données d'un `.p3d`, le manifeste d'un
 * dossier, ou `{}` pour un projet neuf.
 *
 * UN DÉFAUT N'EST POSÉ QUE SI LE CHAMP MANQUE. `??` et non `||` : `versionVisible: false` et
 * `ppu2d: 0` sont des valeurs, qu'un `||` remonterait silencieusement au défaut. C'est
 * exactement le bug que cette fonction existe pour ne pas commettre : reconstruire au lieu de
 * déplacer aurait réinitialisé les calques et les entrées de tout projet existant.
 */
export function projectSettingsOf(source){
  // Une source DÉJÀ migrée porte ses réglages dans `settings` ; une source d'avant les porte à
  // plat. Les deux passent par ici, et c'est ce qui rend la fonction rejouable sans dégât.
  const brut = (source && source.settings) || source || {};
  return {
    name: brut.name ?? (source && source.projectName) ?? 'Mon projet',
    // LE STUDIO qui signe le jeu exporté (description, identifiant d'application, LISEZMOI).
    // Le moteur sert à plusieurs studios : ce n'est jamais une valeur codée en dur.
    studio: (typeof brut.studio === 'string') ? brut.studio : '',
    layers: brut.layers ?? JSON.parse(JSON.stringify(LAYERS_DEFAULT)),
    // Un tableau de calques 2D VIDE n'est pas un choix : `orderOfSort` renverrait tous les
    // sprites au fond. Même règle qu'au palier 13, qui les a posés pour la première fois.
    layers2d: (Array.isArray(brut.layers2d) && brut.layers2d.length)
      ? brut.layers2d : JSON.parse(JSON.stringify(LAYERS2D_DEFAULT)),
    ppu2d: (Number(brut.ppu2d) > 0) ? brut.ppu2d : PPU2D_DEFAULT,
    inputs: brut.inputs ?? ownedDefault(readOwnedDefault(() => INPUTS_DEFAULT)),
    lightmap: brut.lightmap ?? ownedDefault(readOwnedDefault(() => LIGHTMAP_DEFAULT)),
    // LE TEXTE TRADUIT DU JEU. Reglage de PROJET, au meme titre que la table d'entrees :
    // il voyage avec le projet, part dans le build et se relit dans l'editeur. Voir
    // js/locale.js pour pourquoi une cle absente rend la cle plutot que du vide.
    locales: brut.locales ?? ownedDefault(readOwnedDefault(() => LOCALES_DEFAULT)),
    design: brut.design ?? null,
    // LES PLUGINS DU PROJET : `[{name, code, uid}]`. Ils voyagent avec le projet (p3d, dossier,
    // cloud) et partent dans le build, où js/plugin-host.js les rejoue. Voir js/plugins.js.
    plugins: Array.isArray(brut.plugins) ? brut.plugins : [],
    versionVisible: brut.versionVisible ?? true,
    // La PORTÉE DES OMBRES, en unités monde. Réglage de PROJET et non préférence de machine :
    // il décide de ce que le jeu publié montre, donc il doit voyager avec le projet — deux
    // personnes qui ouvrent la même scène doivent voir les mêmes ombres.
    //
    // Il n'existait pas, et son absence était un bug : three.js donne à l'ombre d'une lumière
    // directionnelle une caméra orthographique de 10 × 10 unités, et RIEN dans l'éditeur ne
    // la redimensionnait. Au-delà, les fragments échantillonnent hors de la carte d'ombre et
    // se lisent comme ombrés — d'où une frontière rectiligne, sans rapport avec la géométrie,
    // sur toute scène dépassant dix unités.
    //
    // Ce n'est pas « plus c'est grand, mieux c'est » : la carte d'ombre a une résolution fixe,
    // donc doubler la portée double la taille d'un texel au sol et adoucit d'autant les
    // contours. C'est un arbitrage, et c'est pour ça qu'il se règle.
    shadowDistance: clampShadowDistance(brut.shadowDistance),
    // La RÉSOLUTION de la carte d'ombre. Avec la portée, c'est elle qui décide de la finesse :
    // la taille d'un texel au sol vaut `2 × portée / résolution`. Doubler la résolution est
    // exactement équivalent à diviser la portée par deux — sauf que ça ne réduit pas la
    // distance à laquelle les ombres existent, ça coûte de la mémoire vidéo à la place.
    shadowMapSize: clampShadowMapSize(brut.shadowMapSize),
    // Les valeurs de départ d'une NOUVELLE scène. Un CLONE, jamais la référence : deux scènes
    // qui partageraient leur environnement dériveraient ensemble au premier réglage de ciel.
    // LES RÉGLAGES MULTIJOUEUR (transport relais ou pair-à-pair, serveur, clé de jeu, joueurs
    // max, cadence d'envoi, serveurs ICE). Nettoyés par `sanitizeNetworkSettings`
    // (network-game.js), qui possède leur défaut : ce fichier est aussi embarqué dans le jeu
    // publié, et c'est lui qui relit la config au runtime. `null` quand il n'est pas chargé
    // (test qui n'exerce qu'une migration) : même règle que `ownedDefault`.
    network: (typeof sanitizeNetworkSettings === 'function')
      ? sanitizeNetworkSettings(brut.network) : (brut.network ?? null),
    // LE MÉLANGE : volumes des bus Master / Musique / Effets (js/audio-bus.js). Réglage de PROJET, il
    // part dans le build. Absent d'un projet d'avant les bus : tout à 1, donc rien ne change à l'oreille.
    audioBuses: sanitizeAudioBuses(brut.audioBuses),
    // LES ASSETS VALIDÉS par l'utilisateur : `{idAsset: {name, fp, at}}` (js/ai-rules.js). L'IA ne les
    // supprime ni ne les écrase sans son accord. Additif : absent d'un ancien projet, il vaut `{}`.
    validatedAssets: (brut.validatedAssets && typeof brut.validatedAssets === 'object' && !Array.isArray(brut.validatedAssets))
      ? brut.validatedAssets : {},
    // LA SCÈNE DE DÉPART du jeu, par son NOM (manage_scenes set_start). `null` = la scène active
    // au lancement, comme avant. Additif : absent d'un ancien projet, rien ne change.
    startScene: (typeof brut.startScene === 'string' && brut.startScene) ? brut.startScene : null,
    newScene: {
      env: (brut.newScene && brut.newScene.env)
        ? JSON.parse(JSON.stringify(brut.newScene.env))
        : ownedDefault(typeof ENV_DEFAULT === 'undefined' ? undefined : ENV_DEFAULT)
    }
  };
}


/**
 * Lit ou modifie les réglages multijoueur du projet ouvert. `patch` (facultatif) est FUSIONNÉ
 * dans les réglages existants puis le tout est nettoyé (sanitizeNetworkSettings) : un champ
 * absent du patch ne bouge pas, une valeur hors bornes est ramenée dedans. Rend une COPIE des
 * réglages effectifs. C'est la porte d'entrée du panneau Réseau et de `configure_network`.
 */
export function projectNetworkSettings(patch){
  const p = globalThis.project;
  if(!p || !p.settings) throw new Error('aucun projet ouvert');
  if(typeof sanitizeNetworkSettings !== 'function') throw new Error('le module réseau n’est pas chargé');
  const cur = sanitizeNetworkSettings(p.settings.network);
  if(patch && typeof patch === 'object'){
    p.settings.network = sanitizeNetworkSettings(Object.assign(cur, patch));
  } else if(!p.settings.network){
    p.settings.network = cur;
  }
  return JSON.parse(JSON.stringify(p.settings.network || cur));
}


// EXPOSÉ EN GLOBALE, à dessein. Ces symboles sont appelés depuis des fichiers
// que les mêmes pages ne chargent pas toutes : un `import` y pointerait un
// fichier absent, et la page ne démarrerait pas. Ils gardent donc leur garde
// `typeof` côté appelant, et se déclarent ici.
globalThis.LAYERS_DEFAULT = LAYERS_DEFAULT;
globalThis.PROJECT_SETTINGS_KEYS_MIGRATED = PROJECT_SETTINGS_KEYS_MIGRATED;
globalThis.projectSettingsOf = projectSettingsOf;
globalThis.projectNetworkSettings = projectNetworkSettings;

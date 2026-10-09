// LE NUMÉRO DE VERSION DU MOTEUR, à un seul endroit.
//
// Il sert à identifier un build : quelqu'un qui décrit un problème lit le numéro affiché en bas
// à droite du jeu publié, et l'on sait de quel code il parle. C'est sa seule fonction — aucun
// comportement ne doit en dépendre.
//
// Il est tenu en accord avec le ChangeLog le plus récent par test/version-moteur.test.mjs :
// publier une version sans écrire son ChangeLog, ou l'inverse, fait échouer la garde.
export const VERSION_ENGINE = '1.2.4';

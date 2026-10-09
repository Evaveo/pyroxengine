// post-volume-blend.js
// Fonction de mélange pure des volumes de post-processing (façon Unity Volume).
// Ne dépend que de ses arguments : ni THREE, ni Registry, ni assets. Le câblage avec la
// scène réelle (résolution des profils, position caméra effective) se fait côté appelant.

// État neutre : le point de départ du mélange, c'est-à-dire CE QUE VOIT L'ŒIL quand aucun
// volume n'override quoi que ce soit — donc l'image brute, effets à zéro.
//
// Il valait auparavant les mêmes chiffres que POST_PROFILE_DEFAULT_EFFECTS (bloom 0,7,
// vignette 0,25, tone mapping ACES). Conséquence mesurée, et c'est LE bug du système :
// cocher ou décocher « Actif » sur le Bloom d'un profil laissé à ses valeurs par défaut ne
// changeait strictement rien à l'écran (0,7 override sur 0,7 neutre), et un profil qui ne
// touchait que la gradation imposait quand même un bloom et une vignette que personne
// n'avait demandés. Un neutre doit être neutre — comme la pile vide d'Unity.
//
// Ce n'est donc plus la copie de POST_PROFILE_DEFAULT_EFFECTS (js/post-profile.js) : celui-ci
// porte les valeurs de DÉPART d'un effet qu'on vient d'activer (un bloom à 0 à l'activation
// n'apprendrait rien), celui-ci porte l'absence d'effet. Les deux tables gardent en revanche
// exactement les mêmes CLÉS, et doivent le rester.
export function neutralPostState(){
  return {
    bloom: {threshold:0.8, intensity:0, radius:1},
    vignette: {amount:0},
    grain: {amount:0},
    toneMapping: {mode:'none'},
    colorGrading: {contrast:1, saturation:1, temperature:0, exposure:1}
  };
}

export function lerp(a, b, t){
  return a + (b - a) * t;
}

// Distance signée du point à la surface de la sphère/box (espace monde, sans rotation).
// <= 0 signifie "à l'intérieur".
export function signedDistanceToVolume(volume, point){
  const p = volume.position || {x:0, y:0, z:0};
  if(volume.shape === 'sphere'){
    const dx = point.x - p.x, dy = point.y - p.y, dz = point.z - p.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    return dist - (volume.radius || 0);
  }
  // box : AABB centrée sur position, demi-étendue = size
  const size = volume.size || {x:0, y:0, z:0};
  const dx = Math.max(Math.abs(point.x - p.x) - size.x, 0);
  const dy = Math.max(Math.abs(point.y - p.y) - size.y, 0);
  const dz = Math.max(Math.abs(point.z - p.z) - size.z, 0);
  const outsideDist = Math.sqrt(dx*dx + dy*dy + dz*dz);
  if(outsideDist > 0) return outsideDist;
  // point à l'intérieur de la box : distance négative (profondeur) jusqu'à la face la plus proche
  const insideDist = Math.min(
    size.x - Math.abs(point.x - p.x),
    size.y - Math.abs(point.y - p.y),
    size.z - Math.abs(point.z - p.z)
  );
  return -insideDist;
}

// Poids [0..1] du volume à la position caméra donnée.
export function computeVolumeWeight(volume, cameraPos){
  if(volume.global) return 1;
  const distance = signedDistanceToVolume(volume, cameraPos);
  if(distance <= 0) return 1;
  const blendDistance = volume.blendDistance || 0;
  if(blendDistance <= 0) return 0;
  if(distance >= blendDistance) return 0;
  return 1 - distance / blendDistance;
}

// Mélange une liste de volumes résolus en un état post-processing unique, ou null si rien
// n'est effectivement overridden nulle part (signal pour l'appelant : sauter le pipeline).
export function blendPostVolumes(volumes, cameraPos){
  const state = neutralPostState();
  let anyApplied = false;

  const sorted = volumes.slice().sort((a, b) => (a.priority || 0) - (b.priority || 0));

  for(const volume of sorted){
    const effects = volume.effects;
    if(!effects) continue;
    const weight = computeVolumeWeight(volume, cameraPos);
    if(weight <= 0) continue;

    for(const key of Object.keys(effects)){
      const field = effects[key];
      if(!field || !field.overridden) continue;
      const currentField = state[key];
      if(!currentField) continue;

      for(const propName of Object.keys(field)){
        if(propName === 'overridden') continue;
        const volumeValue = field[propName];
        const currentValue = currentField[propName];
        if(typeof volumeValue === 'number' && typeof currentValue === 'number'){
          currentField[propName] = lerp(currentValue, volumeValue, weight);
        } else if(weight >= 0.5){
          currentField[propName] = volumeValue;
        }
      }
      anyApplied = true;
    }
  }

  return anyApplied ? state : null;
}

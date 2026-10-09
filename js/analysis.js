// ---------- Analyser la scène : détection des problèmes courants ----------
// Passe en revue la scène courante et le projet, liste les avertissements dans
// une modale (menu Édition → Analyser la scène).
import { compileScript } from './script-scope.js';
import { assets } from './assets.js';
import { isPlayableAudio } from './component-data.js';
import { Registry } from './component-registry.js';
import { assetMaterialOf } from './materials.js';
import { escapeHtml, objects } from './objects.js';
import { Editor } from './plugins.js';
import { assetPrefabOf, instanceModified } from './prefabs.js';
import { project } from './project.js';
import { aOfScripts } from './scripts.js';
import { openModal } from './ui.js';

export function analyzeScene(){
  const problemes = [];   // {niveau:'error'|'warn'|'info', texte}
  function pb(level, text){ problemes.push({level:level, text:text}); }

  // caméra principale
  if(!Registry.count('Camera')){
    pb('warn', 'Aucune caméra dans la scène — le build Web utilisera une caméra de secours.');
  }

  // doublons de noms (les cibles d\'événements et api.find s\'appuient sur les noms)
  const byName = {};
  // Les nœuds d'un modèle portent les noms du fichier : deux instances du même personnage ont
  // forcément deux « mixamorigHips ». Ce n'est pas un doublon à signaler.
  objects.forEach(function(o){
    if(o.userData.modelNode !== undefined) return;
    (byName[o.name] = byName[o.name] || []).push(o);
  });
  Object.keys(byName).forEach(function(name){
    if(byName[name].length > 1) pb('warn', 'Nom en double : « ' + name + ' » (' + byName[name].length + ' objets).');
  });

  objects.forEach(function(o){
    const name = '« ' + o.name + ' »';
    // physique
    if(o.userData.phys && o.userData.phys.active && o.userData.phys.masse === 0){
      pb('warn', name + ' : corps rigide de masse nulle (il restera figé en l\'air).');
    }
    if(o.userData.phys && o.userData.phys.active && !visibleIntent(o)){
      pb('warn', name + ' : invisible mais physiquement active.');
    }
    // trigger sans réaction
    if(o.userData.collider && o.userData.collider.trigger
       && !aOfScripts(o)
       && !(o.userData.events && o.userData.events.length)){
      pb('warn', name + ' : collider « déclencheur » sans script ni événement.');
    }
    // transformations suspectes
    if(o.scale.x < 0 || o.scale.y < 0 || o.scale.z < 0){
      pb('warn', name + ' : échelle négative (normales inversées, physique imprévisible).');
    }
    if(o.position.length() > 200){
      pb('info', name + ' : très loin de l\'origine (' + Math.round(o.position.length()) + ' u).');
    }
    // scripts en erreur de compilation
    (o.userData.scripts || []).forEach(function(s, i){
      if(!s.active || !s.code) return;
      try{
        // LA MÊME PORTÉE QU'À L'EXÉCUTION (js/script-scope.js). Valider dans une portée plus
        // large laisserait passer ici un script qui échoue au lancement — par exemple un
        // `let fetch` de premier niveau, qui redéclare un paramètre masqué.
        compileScript(s.code, '');
      } catch(e){
        pb('error', name + ' : script ' + (i + 1) + ' invalide — ' + e.message);
      }
    });
    // prefab modifié non appliqué
    if(o.userData.prefabId && assetPrefabOf(o) && instanceModified(o)){
      pb('info', name + ' : instance de prefab modifiée, non appliquée.');
    }
    // références cassées
    if(o.userData.materialId && !assetMaterialOf(o)){
      pb('error', name + ' : matériau lié introuvable dans le projet.');
    }
    if(o.userData.prefabId && !assetPrefabOf(o)){
      pb('error', name + ' : prefab lié introuvable dans le projet.');
    }
    if(o.userData.audio && !assets.some(function(a){
        return a.id === o.userData.audio.asset && isPlayableAudio(a); })){
      pb('error', name + ' : source audio dont l\'asset est introuvable dans le projet.');
    }
    // événements : cibles et scènes inexistantes
    (o.userData.events || []).forEach(function(ev){
      (ev.actions || []).forEach(function(ac){
        const target = (ac.target || '').trim();
        if(target && !objects.some(function(x){ return x.name === target; })){
          pb('warn', name + ' : action « ' + ac.type + ' » vers une cible introuvable (« ' + target + ' »).');
        }
        if(ac.type === 'changerScene'
           && !project.scenes.some(function(s){ return s.name === (ac.value || '').trim(); })){
          pb('error', name + ' : changement vers une scène inexistante (« ' + ac.value + ' »).');
        }
        if(ac.type === 'jouerSon'
           && !assets.some(function(a){ return isPlayableAudio(a) && a.name === (ac.value || '').trim(); })){
          pb('error', name + ' : action « Jouer le son » vers un audio inexistant (« ' + ac.value + ' »).');
        }
      });
    });
  });

  // validateurs apportés par les plugins
  Editor.validators.forEach(function(v){
    try{ v.check(pb); }
    catch(e){ pb('error', 'validateur « ' + v.name + ' » a échoué : ' + e.message); }
  });

  // assets inutilisés (dans la scène courante)
  assets.forEach(function(a){
    if(a.kind === 'material' && !objects.some(function(o){ return o.userData.materialId === a.id; })){
      pb('info', 'Matériau « ' + a.name + ' » inutilisé dans cette scène.');
    }
  });

  // ---------- jouabilité ----------
  // Les contrôles ci-dessus vérifient l'INTÉGRITÉ (links cassés, scripts
  // invalides). Ceux qui suivent vérifient qu'on peut JOUER : un niveau peut
  // être parfaitement intègre et infranchissable. C'est exactement ce qui s'est
  // produit en construisant le jeu de démonstration — six plateformes posées
  // par des commandes toutes réussies, et qui se chevauchaient au point de ne
  // laisser aucun saut à faire. Rien ne l'avait signalé.
  analyzePlayability(pb);

  // rendu
  const order = {error:0, warn:1, info:2};
  problemes.sort(function(a, b){ return order[a.level] - order[b.level]; });
  return problemes;
}

// Portée de saut estimée à partir du script du joueur. On ne devine pas : on
// lit les constantes du code (vitesse horizontale, impulsion de saut, gravité)
// et on retombe sur des valeurs prudentes si elles sont introuvables. Mieux
// vaut un contrôle approximatif qu'aucun contrôle.
export function rangeOfJump(){
  const joueur = objects.find(function(o){
    return o.userData.game && o.userData.game.tag === 'joueur';
  });
  const code = joueur ? (joueur.userData.scripts || []).map(function(s){ return s.code; }).join('\n') : '';
  const nb = function(motif, defaultValue){
    const m = code.match(motif);
    return m ? parseFloat(m[1]) : defaultValue;
  };
  const speed = nb(/\*\s*([0-9.]+)\s*\*\s*dt/, 6);
  const jump = nb(/vy\s*=\s*([0-9.]+)/, 8);
  const gravity = nb(/vy\s*-=\s*([0-9.]+)/, 20);
  const durationFly = (2 * jump) / gravity;
  return {horizontale: speed * durationFly, height: (jump * jump) / (2 * gravity),
          estime: !joueur || !code};
}

export function analyzePlayability(pb){
  const _b = new THREE.Box3();
  const boites = new Map();
  const boxOf = function(o){
    if(!boites.has(o)){ const b = new THREE.Box3().setFromObject(o); boites.set(o, b.isEmpty() ? null : b); }
    return boites.get(o);
  };
  const sols = objects.filter(function(o){
    return o.userData.game && o.userData.game.tag === 'ground' && boxOf(o);
  });
  if(!sols.length) return;   // pas un niveau de plateforme : rien à dire

  // 1. plateformes qui se chevauchent — le défaut le plus coûteux, parce qu'il
  //    ne se voit pas dans les nombres : il supprime silencieusement le jeu.
  for(let i = 0; i < sols.length; i++){
    for(let j = i + 1; j < sols.length; j++){
      const a = boxOf(sols[i]), b = boxOf(sols[j]);
      if(!a.intersectsBox(b)) continue;
      const recouvX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
      pb('warn', sols[i].name + ' et ' + sols[j].name + ' se chevauchent ('
        + Math.round(recouvX * 100) / 100 + ' u en X) — il n\'y a aucun vide à franchir entre eux.');
    }
  }

  // 2. ATTEIGNABILITÉ — remplace l'ancien contrôle « trier par X et comparer
  //    les voisins », qui ne valait que pour un niveau linéaire et ne disait
  //    rien de la question qui compte : peut-on aller du départ à l'arrivée ?
  //    On construit un graphe des sauts possibles, en 3D, et on le parcourt.
  const range = rangeOfJump();
  const suffix = range.estime
    ? ' (portée estimée : aucun objet tagué « joueur » avec un script)' : '';

  // Un saut relie A à B si l'écart horizontal tient dans la portée et si la
  // marche à monter tient dans la hauteur de saut. Descendre est toujours
  // possible : on tombe.
  function jumpPossible(a, b){
    const ba = boxOf(a), bb = boxOf(b);
    const gapX = Math.max(0, Math.max(ba.min.x, bb.min.x) - Math.min(ba.max.x, bb.max.x));
    const gapZ = Math.max(0, Math.max(ba.min.z, bb.min.z) - Math.min(ba.max.z, bb.max.z));
    const gap = Math.hypot(gapX, gapZ);
    const stepUp = bb.max.y - ba.max.y;
    return gap <= range.horizontale && stepUp <= range.height;
  }

  // Sol de départ : celui sous le joueur, sinon le plus bas (on y retombe).
  const joueur = objects.find(function(o){ return (o.userData.game || {}).tag === 'joueur'; });
  let start = null;
  if(joueur && boxOf(joueur)){
    const bj = boxOf(joueur);
    start = sols.find(function(s){
      const bs = boxOf(s);
      return bs.max.x >= bj.min.x && bs.min.x <= bj.max.x
          && bs.max.z >= bj.min.z && bs.min.z <= bj.max.z && bs.max.y <= bj.min.y + 0.5;
    }) || null;
  }
  if(!start){
    start = sols.reduce(function(m, s){
      return (!m || boxOf(s).max.y < boxOf(m).max.y) ? s : m;
    }, null);
  }

  const atteints = new Set([start]);
  const file = [start];
  while(file.length){
    const cour = file.shift();
    sols.forEach(function(s){
      if(atteints.has(s) || !jumpPossible(cour, s)) return;
      atteints.add(s);
      file.push(s);
    });
  }

  const isoles = sols.filter(function(s){ return !atteints.has(s); });
  if(isoles.length){
    pb('error', isoles.length + ' plateforme(s) hors d\'atteinte depuis « ' + start.name
      + '  » : ' + isoles.map(function(s){ return s.name; }).join(', ')
      + ' — le joueur franchit ' + Math.round(range.horizontale * 10) / 10 + ' u en longueur et '
      + Math.round(range.height * 10) / 10 + ' u en hauteur' + suffix + '.');
  }

  // 3. objets à ramasser et arrivée : le chemin COMPLET doit exister.
  //    Un objet posé sur une plateforme isolée est parfaitement placé et
  //    pourtant inatteignable — c'est ce que l'ancien contrôle, purement local,
  //    ne pouvait pas voir.
  const ramassables = objects.filter(function(o){
    const t = o.userData.game && o.userData.game.tag;
    return (t === 'coin' || t === 'bonus' || t === 'but') && boxOf(o);
  });
  // Un sol « porte » un objet si son dessus n'est pas au-dessus de la MI-HAUTEUR
  // de l'objet. Comparer au bas de l'objet paraissait plus naturel mais tombait
  // sur deux cas réels : un objet posé pile au niveau du sol échoue au bruit
  // numérique des flottants, et un drapeau PLANTÉ dans sa plateforme a son bottom
  // sous la surface — il était donc déclaré flottant alors qu'il y est fiché.
  ramassables.forEach(function(o){
    const b = boxOf(o);
    const tag = o.userData.game.tag;
    const miHeight = (b.min.y + b.max.y) / 2;
    const dessous = sols.filter(function(s){
      const bs = boxOf(s);
      return bs.max.x >= b.min.x && bs.min.x <= b.max.x
          && bs.max.z >= b.min.z && bs.min.z <= b.max.z && bs.max.y <= miHeight;
    });
    if(!dessous.length){
      pb('info', o.name + ' (tag « ' + tag + ' ») n\'a aucun sol en dessous — '
        + 'à ne garder que si on doit l\'attraper en plein saut.');
      return;
    }
    // Le support le plus haut décide de la hauteur à franchir ; l'atteignabilité
    // se juge sur l'ENSEMBLE des supports (il suffit qu'un seul soit accessible).
    const moreTop = Math.max.apply(null, dessous.map(function(s){ return boxOf(s).max.y; }));
    const height = b.min.y - moreTop;
    if(height > range.height){
      pb('warn', o.name + ' est à ' + Math.round(height * 100) / 100
        + ' u au-dessus du sol — hors de portée d\'un saut ('
        + Math.round(range.height * 10) / 10 + ' u).');
      return;
    }
    if(!dessous.some(function(s){ return atteints.has(s); })){
      pb('error', o.name + ' (tag « ' + tag + ' ») repose sur une plateforme hors d\'atteinte — '
        + (tag === 'but' ? 'le niveau ne peut pas être terminé.'
                         : 'l\'objet ne peut pas être ramassé.'));
    }
  });

  // 4. l'arrivée existe-t-elle ? Un niveau sans but ne se termine pas — et un
  //    jeu dont on ne peut pas sortir n'est pas un jeu.
  if(!ramassables.some(function(o){ return o.userData.game.tag === 'but'; })){
    pb('info', 'Aucun objet tagué « but » : rien ne marque la fin du niveau.');
  }
}

// Affiche le résultat de l'analyse. Séparé du calcul pour que le copilote
// puisse LIRE les problèmes sans ouvrir de modale à l'utilisateur.
export function openAnalysisScene(){
  const problemes = analyzeScene();
  const ico = {error:'⛔', warn:'⚠️', info:'ℹ️'};
  let html;
  if(!problemes.length){
    html = '<p>✅ Aucun problème détecté dans la scène courante.</p>';
  } else {
    html = '<p style="margin-bottom:8px">' + problemes.filter(p => p.level === 'error').length
      + ' error(s) · ' + problemes.filter(p => p.level === 'warn').length
      + ' avertissement(s) · ' + problemes.filter(p => p.level === 'info').length + ' info(s)</p>'
      + '<div style="display:flex;flex-direction:column;gap:5px;max-height:50vh;overflow-y:auto">';
    problemes.forEach(function(p){
      html += '<div style="font-size:12px;line-height:1.5">' + ico[p.level] + ' '
        + escapeHtml(p.text) + '</div>';
    });
    html += '</div>';
  }
  openModal('Analyse de la scène', html);
}

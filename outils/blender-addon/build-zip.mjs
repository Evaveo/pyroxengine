// Fabrique le zip de l'addon Blender, à installer par Édition → Préférences → Add-ons → Installer.
//
//   node outils/blender-addon/build-zip.mjs
//
// Le zip est COMMITÉ (exemples/blender/evaveo_blender_bridge.zip) : le moteur n'a pas d'étape de
// build, et l'Atelier Blender le propose au téléchargement tel quel. Il est donc DÉTERMINISTE —
// date fixe, ordre trié — pour que test/blender-addon-zip.test.mjs puisse le refaire en mémoire
// et vérifier qu'il correspond aux sources octet pour octet. Oublier de relancer ce script après
// avoir touché un .py fait rougir ce test.
//
// Écrit sans dépendance npm : un zip, c'est des en-têtes fixes, un CRC32 et zlib.deflateRawSync.

import { deflateRawSync } from 'node:zlib';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ADDON_DIR = path.join(here, 'evaveo_blender_bridge');
export const ZIP_PATH = path.join(here, '..', '..', 'exemples', 'blender', 'evaveo_blender_bridge.zip');
const PACKAGE = 'evaveo_blender_bridge';
// 2026-01-01 00:00, en format DOS : une date fixe, sinon chaque build changerait les octets.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const CRC_TABLE = (function(){
  const t = new Uint32Array(256);
  for(let n = 0; n < 256; n++){
    let c = n;
    for(let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf){
  let c = 0xFFFFFFFF;
  for(let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Les fichiers de l'addon : les .py seulement, triés (pas de __pycache__ ni de fichier local). */
export function addonFiles(){
  return readdirSync(ADDON_DIR).filter((n) => n.endsWith('.py')).sort();
}

export function buildZip(){
  const locals = [];
  const centrals = [];
  let offset = 0;
  for(const file of addonFiles()){
    // Fins de ligne normalisées : un checkout Windows (CRLF) doit donner le même zip qu'un Linux.
    const raw = Buffer.from(readFileSync(path.join(ADDON_DIR, file), 'utf8').replace(/\r\n/g, '\n'), 'utf8');
    const data = deflateRawSync(raw, {level: 9});
    const name = Buffer.from(PACKAGE + '/' + file, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  mkdirSync(path.dirname(ZIP_PATH), {recursive: true});
  const zip = buildZip();
  writeFileSync(ZIP_PATH, zip);
  console.log('écrit ' + path.relative(process.cwd(), ZIP_PATH) + ' (' + zip.length + ' octets, '
    + addonFiles().length + ' fichiers)');
}

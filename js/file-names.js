// ---------- Validation des noms de fichiers/dossiers ----------
// Utilisé lors de la création/renommage de fichiers et dossiers dans un projet
// stocké sur disque (File System Access API).
export const CHARS_FORBIDDEN = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

export function validateNameFile(name){
  if(!name || !name.trim()) return 'Le nom ne peut pas être vide.';
  for(const c of CHARS_FORBIDDEN){
    if(name.includes(c)) return `Le caractère "${c}" n'est pas autorisé dans un nom de fichier.`;
  }
  if(/[.\s]$/.test(name)) return 'Le nom ne peut pas se terminer par un espace ou un point.';
  return null;
}

export function namesEnterInCollision(a, b){
  return a !== b && a.toLowerCase() === b.toLowerCase();
}

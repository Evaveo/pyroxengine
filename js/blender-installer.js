// ---------- Installer l'addon Blender, et ouvrir Blender, depuis l'éditeur ----------
//
// Une page web ne peut ni lancer un programme ni écrire dans les préférences de Blender. Le geste
// automatique passe donc par UN fichier que l'éditeur fabrique et que l'utilisateur ouvre d'un
// double-clic. Ce script :
//   1. trouve Blender (PATH, emplacements d'installation habituels, sinon le demande) ;
//   2. le lance en arrière-plan pour INSTALLER l'addon depuis l'éditeur, l'activer, et y poser le
//      jeton et l'origine de CETTE page — plus rien à copier-coller ensuite ;
//   3. enregistre le lien `evaveo-blender://` (Windows : HKCU, sans droits admin ; Linux :
//      xdg-mime), pour que le bouton « Ouvrir Blender » de l'Atelier lance Blender la fois suivante ;
//   4. ouvre Blender : l'addon démarre la liaison, l'Atelier se connecte seul.
//
// Module PUR (aucun accès au DOM) : les scripts produits sont testés par test/blender-installer.test.mjs.

export const BLENDER_PROTOCOL_URL = 'evaveo-blender://open';

/**
 * Le code exécuté par Blender en arrière-plan. Une seule ligne, sans guillemet double, sans `$`
 * ni `%` : il passe tel quel dans un .cmd comme dans un script shell. Ses trois paramètres (URL
 * du zip, jeton, origine) arrivent APRÈS `--`, jamais concaténés dans le code.
 */
export const INSTALL_PYTHON = [
  'import bpy, sys, os, tempfile, urllib.request',
  'a = sys.argv[sys.argv.index(\'--\') + 1:]',
  'z = os.path.join(tempfile.gettempdir(), \'evaveo_blender_bridge.zip\')',
  'urllib.request.urlretrieve(a[0], z)',
  'bpy.ops.preferences.addon_install(filepath=z, overwrite=True)',
  'bpy.ops.preferences.addon_enable(module=\'evaveo_blender_bridge\')',
  'from evaveo_blender_bridge import guards',
  'p = bpy.context.preferences.addons[\'evaveo_blender_bridge\'].preferences',
  'p.token = a[1]',
  'p.origins = guards.add_origin(p.origins, a[2])',
  'p.autostart = True',
  'bpy.ops.wm.save_userpref()',
  'print(\'EVAVEO : addon installe\')'
].join('; ');

function check(opts){
  const o = opts || {};
  if(!/^https?:\/\/[^\s"'%`$^&|<>]+$/.test(o.zipUrl || '')) throw new Error('adresse du zip invalide');
  if(!/^[A-Za-z0-9_-]{16,128}$/.test(o.token || '')) throw new Error('jeton invalide');
  if(!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(o.origin || '')) throw new Error('origine invalide');
  return o;
}

/** Le script Windows (.cmd). */
export function windowsInstaller(opts){
  const o = check(opts);
  return [
    '@echo off',
    'setlocal',
    'rem EVAVEO - installe l\'addon Blender de l\'editeur, puis ouvre Blender.',
    'rem Fabrique par l\'editeur (Fenetres - Atelier Blender) pour ' + o.origin + '.',
    'set "BLENDER="',
    'for /f "delims=" %%B in (\'where blender 2^>nul\') do if not defined BLENDER set "BLENDER=%%B"',
    'if not defined BLENDER for /d %%D in ("%ProgramFiles%\\Blender Foundation\\Blender *") do if exist "%%D\\blender.exe" set "BLENDER=%%D\\blender.exe"',
    'if not defined BLENDER if exist "%ProgramFiles(x86)%\\Steam\\steamapps\\common\\Blender\\blender.exe" set "BLENDER=%ProgramFiles(x86)%\\Steam\\steamapps\\common\\Blender\\blender.exe"',
    'if not defined BLENDER (',
    '  echo Blender introuvable. Installez Blender 4.5 LTS : https://www.blender.org/download/',
    '  set /p "BLENDER=Ou glissez ici blender.exe puis Entree : "',
    ')',
    'set "BLENDER=%BLENDER:"=%"',
    'if not exist "%BLENDER%" ( echo Blender introuvable. & pause & exit /b 1 )',
    'echo Blender : %BLENDER%',
    'echo Installation de l\'addon EVAVEO Blender Bridge...',
    '"%BLENDER%" -b --python-exit-code 1 --python-expr "' + INSTALL_PYTHON + '" -- "' + o.zipUrl + '" "' + o.token + '" "' + o.origin + '"',
    'if errorlevel 1 ( echo L\'installation a echoue : voir les messages ci-dessus. & pause & exit /b 1 )',
    'reg add "HKCU\\Software\\Classes\\evaveo-blender" /ve /d "URL:EVAVEO Blender" /f >nul',
    'reg add "HKCU\\Software\\Classes\\evaveo-blender" /v "URL Protocol" /d "" /f >nul',
    'reg add "HKCU\\Software\\Classes\\evaveo-blender\\shell\\open\\command" /ve /d "\\"%BLENDER%\\"" /f >nul',
    'echo Termine : Blender s\'ouvre, l\'editeur se connecte tout seul.',
    'start "" "%BLENDER%"',
    ''
  ].join('\r\n');
}

/** Le script macOS / Linux (sh). */
export function unixInstaller(opts){
  const o = check(opts);
  return [
    '#!/bin/sh',
    '# EVAVEO - installe l\'addon Blender de l\'editeur, puis ouvre Blender.',
    '# Fabrique par l\'editeur (Fenetres - Atelier Blender) pour ' + o.origin + '. Lancer : sh ce-fichier',
    'B="$(command -v blender)"',
    'for c in /Applications/Blender.app/Contents/MacOS/Blender "$HOME/Applications/Blender.app/Contents/MacOS/Blender" /snap/bin/blender; do',
    '  [ -z "$B" ] && [ -x "$c" ] && B="$c"',
    'done',
    'if [ -z "$B" ]; then printf "Chemin de Blender : "; read -r B; fi',
    '[ -x "$B" ] || { echo "Blender introuvable : installez Blender 4.5 LTS (https://www.blender.org/download/)"; exit 1; }',
    'echo "Blender : $B"',
    '"$B" -b --python-exit-code 1 --python-expr "' + INSTALL_PYTHON + '" -- "' + o.zipUrl + '" "' + o.token + '" "' + o.origin + '" || { echo "L\'installation a echoue."; exit 1; }',
    'if [ "$(uname)" = Linux ] && command -v xdg-mime >/dev/null; then',
    '  mkdir -p "$HOME/.local/share/applications"',
    '  printf "[Desktop Entry]\\nType=Application\\nName=EVAVEO Blender\\nExec=%s\\nMimeType=x-scheme-handler/evaveo-blender;\\nNoDisplay=true\\n" "$B" > "$HOME/.local/share/applications/evaveo-blender.desktop"',
    '  xdg-mime default evaveo-blender.desktop x-scheme-handler/evaveo-blender',
    'fi',
    'echo "Termine : Blender s\'ouvre, l\'editeur se connecte tout seul."',
    '(nohup "$B" >/dev/null 2>&1 &)',
    ''
  ].join('\n');
}

/** Windows, macOS ou Linux, d'après le navigateur. */
export function detectPlatform(userAgent){
  const ua = String(userAgent || '');
  if(/Windows/i.test(ua)) return 'windows';
  if(/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  return 'linux';
}

/** Le fichier à télécharger pour cette plateforme : {name, type, text}. */
export function installerFor(platform, opts){
  if(platform === 'windows'){
    return {name: 'installer-blender-evaveo.cmd', type: 'application/octet-stream', text: windowsInstaller(opts)};
  }
  return {name: 'installer-blender-evaveo.sh', type: 'application/x-sh', text: unixInstaller(opts)};
}

/** Un jeton neuf (base64url, 32 caractères). */
export function newBlenderToken(){
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  let s = '';
  b.forEach(function(x){ s += String.fromCharCode(x); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

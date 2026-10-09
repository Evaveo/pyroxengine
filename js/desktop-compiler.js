// ---------- Compiler l'exécutable Windows depuis l'éditeur : le lien pyrox-build:// ----------
//
// Une page web ne lance aucun programme. Le geste « un clic, un .exe » passe donc par le même
// détour que l'Atelier Blender (blender-installer.js) : UN script, ouvert une fois d'un
// double-clic, installe un petit lanceur sur la machine et y enregistre le lien `pyrox-build://`
// (HKCU, sans droits admin). Ensuite, à chaque compilation :
//
//   1. l'éditeur télécharge le projet bureau (`<slug>-bureau.zip`) comme avant ;
//   2. il ouvre `pyrox-build://compile/<slug>` (ou `steam/<slug>`) — Windows lance le lanceur ;
//   3. le lanceur prend le zip le plus récent de ce nom dans Téléchargements, le dézippe dans
//      %LOCALAPPDATA%\PyroxEngine\builds\<slug> (node_modules gardé d'une fois sur l'autre),
//      lance `npm install` puis electron-builder, et ouvre `dist/` : installeur + exe portable.
//      Cible STEAM : pas d'installeur, le dossier `dist/win-unpacked` tel quel — c'est ce que
//      SteamPipe envoie. Steam installe lui-même les fichiers : pas de marque « venu d'Internet »,
//      donc pas de SmartScreen, et la signature n'y est pas exigée.
//
// LE LIEN NE TRANSPORTE QU'UN SLUG, validé des deux côtés ([a-z0-9-]). Aucun chemin, aucune
// commande : une page hostile qui ouvrirait le lien ne peut que relancer la compilation d'un zip
// déjà présent dans Téléchargements.
//
// LA SIGNATURE se règle dans Paramètres du projet (« Certificat de signature ») : c'est le nom
// du sujet d'un certificat de signature de code installé dans le magasin Windows. Aucun mot de
// passe ne passe par l'éditeur ni par le projet — Windows le garde. Le lanceur REFUSE de
// compiler si le certificat réglé est introuvable, plutôt que de rendre un exe non signé en
// silence. Les variables CSC_LINK / CSC_KEY_PASSWORD de la machine restent aussi reconnues.
//
// Module PUR (aucun accès au DOM) : testé par test/desktop-compiler.test.mjs.

export const DESKTOP_BUILD_PROTOCOL = 'pyrox-build';
export const DESKTOP_BUILD_INSTALLER_NAME = 'installer-compilation-pyroxengine.cmd';
// À monter quand le lanceur change : l'éditeur repropose alors l'installeur.
export const DESKTOP_BUILD_HANDLER_VERSION = 2;
export const DESKTOP_BUILD_TARGETS = ['compile', 'steam'];

const SLUG = /^[a-z0-9-]{1,64}$/;

/** Le lien qui déclenche la compilation d'un projet. */
export function compileUrl(slug, target){
  if(!SLUG.test(String(slug || ''))) throw new Error('nom de projet invalide pour la compilation');
  const t = target || 'compile';
  if(DESKTOP_BUILD_TARGETS.indexOf(t) < 0) throw new Error('cible de compilation inconnue');
  return DESKTOP_BUILD_PROTOCOL + '://' + t + '/' + slug;
}

/**
 * Le lanceur PowerShell. ASCII seulement : il traverse le .cmd en base64 et Windows PowerShell
 * 5.1 lit un .ps1 sans BOM en page de code locale — un accent y deviendrait un caractère cassé.
 */
export const HANDLER_PS1 = [
  'param([string]$Uri)',
  '$ErrorActionPreference = \'Stop\'',
  '$root = Join-Path $env:LOCALAPPDATA \'PyroxEngine\'',
  'New-Item -ItemType Directory -Force -Path $root | Out-Null',
  'Start-Transcript -Path (Join-Path $root \'pyrox-build.log\') -Force | Out-Null',
  'function Fail([string]$m){',
  '  Write-Host \'\'',
  '  Write-Host (\'ECHEC : \' + $m) -ForegroundColor Red',
  '  Stop-Transcript | Out-Null',
  '  Read-Host \'Entree pour fermer\' | Out-Null',
  '  exit 1',
  '}',
  'try {',
  '  if($Uri -notmatch \'^pyrox-build://(compile|steam)/([a-z0-9-]{1,64})/?$\'){ Fail (\'lien invalide : \' + $Uri) }',
  '  $steam = ($Matches[1] -eq \'steam\')',
  '  $slug = $Matches[2]',
  '  $Host.UI.RawUI.WindowTitle = \'PyroxEngine - compilation de \' + $slug',
  '  Write-Host (\'PyroxEngine - compilation Windows de \' + $slug) -ForegroundColor Cyan',
  // Le dossier Téléchargements réel (il peut avoir été déplacé), sinon celui par défaut.
  '  $dl = $null',
  '  try { $dl = (New-Object -ComObject Shell.Application).NameSpace(\'shell:Downloads\').Self.Path } catch {}',
  '  if(-not $dl){ $dl = Join-Path $env:USERPROFILE \'Downloads\' }',
  // Le zip arrive EN MÊME TEMPS que le lien : on l'attend. Un navigateur peut le renommer
  // (« x-bureau (1).zip ») : on prend le plus récent qui commence par le bon nom.
  '  $since = (Get-Date).AddMinutes(-10)',
  '  $zip = $null',
  '  for($i = 0; $i -lt 180 -and -not $zip; $i++){',
  '    $zip = Get-ChildItem -LiteralPath $dl -Filter ($slug + \'-bureau*.zip\') -File -ErrorAction SilentlyContinue |',
  '      Where-Object { $_.LastWriteTime -gt $since -and $_.Length -gt 0 } |',
  '      Sort-Object LastWriteTime -Descending | Select-Object -First 1',
  '    if(-not $zip){ if($i -eq 0){ Write-Host (\'En attente du telechargement dans \' + $dl + \' ...\') }; Start-Sleep -Seconds 1 }',
  '  }',
  '  if(-not $zip){ Fail (\'aucun \' + $slug + \'-bureau.zip recent dans \' + $dl) }',
  // Un fichier encore en cours d'écriture est verrouillé : on attend qu'il se libère.
  '  for($i = 0; $i -lt 60; $i++){',
  '    try { $f = [IO.File]::Open($zip.FullName, \'Open\', \'Read\', \'None\'); $f.Close(); break } catch { Start-Sleep -Seconds 1 }',
  '  }',
  '  Write-Host (\'Projet : \' + $zip.FullName)',
  '  $work = Join-Path $root (\'builds\\\' + $slug)',
  '  New-Item -ItemType Directory -Force -Path $work | Out-Null',
  // node_modules reste : la deuxième compilation ne retélécharge pas Electron.
  '  Get-ChildItem -LiteralPath $work -Force | Where-Object { $_.Name -ne \'node_modules\' } | Remove-Item -Recurse -Force',
  '  Expand-Archive -LiteralPath $zip.FullName -DestinationPath $work -Force',
  '  Set-Location -LiteralPath $work',
  '  if(-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)){',
  '    Write-Host \'Node.js est absent de ce PC.\' -ForegroundColor Yellow',
  '    if(Get-Command winget -ErrorAction SilentlyContinue){',
  '      if((Read-Host \'Installer Node.js LTS avec winget ? (o/n)\') -match \'^[oOyY]\'){',
  '        winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements',
  '        $env:Path = [Environment]::GetEnvironmentVariable(\'Path\', \'Machine\') + \';\' + [Environment]::GetEnvironmentVariable(\'Path\', \'User\')',
  '      }',
  '    }',
  '    if(-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)){ Start-Process \'https://nodejs.org/\'; Fail \'installez Node.js LTS, puis relancez la compilation depuis l editeur\' }',
  '  }',
  // LA SIGNATURE : réglée dans le projet, elle est exigée.
  '  $pkg = Get-Content -LiteralPath (Join-Path $work \'package.json\') -Raw | ConvertFrom-Json',
  '  $subject = $null',
  '  if($pkg.build -and $pkg.build.win -and $pkg.build.win.signtoolOptions){ $subject = $pkg.build.win.signtoolOptions.certificateSubjectName }',
  '  if($subject){',
  '    $cert = Get-ChildItem Cert:\\CurrentUser\\My, Cert:\\LocalMachine\\My -CodeSigningCert -ErrorAction SilentlyContinue |',
  '      Where-Object { $_.Subject -like (\'*CN=\' + $subject + \'*\') -and $_.NotAfter -gt (Get-Date) } | Select-Object -First 1',
  '    if(-not $cert){ Fail (\'certificat de signature introuvable ou expire : CN=\' + $subject + \' (magasin Windows, signature de code)\') }',
  '    Write-Host (\'Signature : \' + $cert.Subject + \' (expire le \' + $cert.NotAfter.ToShortDateString() + \')\') -ForegroundColor Green',
  '  } elseif($env:CSC_LINK -or $env:WIN_CSC_LINK){',
  '    Write-Host \'Signature : certificat de CSC_LINK\' -ForegroundColor Green',
  '  } elseif(-not $steam){',
  '    Write-Host \'ATTENTION : aucun certificat regle dans Parametres du projet. L exe ne sera PAS signe (avertissement SmartScreen).\' -ForegroundColor Yellow',
  '  }',
  '  Write-Host \'Installation des dependances (la premiere fois : quelques minutes)...\'',
  '  & npm.cmd install --no-audit --no-fund',
  '  if($LASTEXITCODE){ Fail \'npm install a echoue (voir ci-dessus)\' }',
  '  Write-Host \'Compilation Windows...\'',
  '  if($steam){ & npx.cmd electron-builder --win dir --publish never } else { & npx.cmd electron-builder --win nsis portable --publish never }',
  '  if($LASTEXITCODE){ Fail \'electron-builder a echoue (voir ci-dessus)\' }',
  '  if($steam){',
  '    Write-Host \'Termine : envoyez le dossier win-unpacked tel quel avec SteamPipe (depot Windows).\' -ForegroundColor Green',
  '    Start-Process explorer.exe (Join-Path $work \'dist\\win-unpacked\')',
  '  } else {',
  '    Write-Host \'Termine : l installeur et l exe portable sont dans dist.\' -ForegroundColor Green',
  '    Start-Process explorer.exe (Join-Path $work \'dist\')',
  '  }',
  '  Stop-Transcript | Out-Null',
  '  Start-Sleep -Seconds 4',
  '} catch { Fail $_.Exception.Message }',
  ''
].join('\r\n');

/** Base64 d'un texte ASCII, découpé en lignes (une ligne de .cmd reste courte). */
function base64Lines(text, width){
  const b64 = btoa(text);
  const lines = [];
  for(let i = 0; i < b64.length; i += width) lines.push(b64.slice(i, i + width));
  return lines;
}

/**
 * L'installeur Windows (.cmd), à ouvrir une fois : il dépose le lanceur et enregistre le lien.
 *
 * Le lanceur voyage en base64 (alphabet sans caractère spécial pour cmd) et `certutil`, présent
 * sur tout Windows, le décode. La redirection est écrite AVANT `echo` : une ligne qui finirait
 * par un chiffre suivi de `>>` serait lue comme une redirection de flux.
 *
 * `%%1` et non `%1` : dans un .cmd, `%1` serait remplacé par l'argument du script lui-même
 * (vide) — le lien enregistré ne recevrait jamais l'adresse.
 */
export function windowsCompilerInstaller(){
  const out = [
    '@echo off',
    'setlocal',
    'rem PyroxEngine - installe le lanceur de compilation (lien pyrox-build://).',
    'rem Fabrique par l\'editeur (Exporter - Executable Windows). Aucun droit admin requis.',
    'set "DIR=%LOCALAPPDATA%\\PyroxEngine"',
    'if not exist "%DIR%" mkdir "%DIR%"',
    'if exist "%DIR%\\pyrox-build.b64" del "%DIR%\\pyrox-build.b64"'
  ];
  base64Lines(HANDLER_PS1, 76).forEach(function(l){ out.push('>>"%DIR%\\pyrox-build.b64" echo ' + l); });
  out.push(
    'certutil -f -decode "%DIR%\\pyrox-build.b64" "%DIR%\\pyrox-build.ps1" >nul',
    'if errorlevel 1 ( echo Le lanceur n\'a pas pu etre ecrit. & pause & exit /b 1 )',
    'del "%DIR%\\pyrox-build.b64"',
    'reg add "HKCU\\Software\\Classes\\pyrox-build" /ve /d "URL:PyroxEngine Compilation" /f >nul',
    'reg add "HKCU\\Software\\Classes\\pyrox-build" /v "URL Protocol" /d "" /f >nul',
    'reg add "HKCU\\Software\\Classes\\pyrox-build\\shell\\open\\command" /ve /d "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \\"%DIR%\\pyrox-build.ps1\\" \\"%%1\\"" /f >nul',
    'if errorlevel 1 ( echo L\'enregistrement du lien a echoue. & pause & exit /b 1 )',
    'echo Termine : retournez dans l\'editeur et relancez Exporter - Executable Windows.',
    'pause',
    ''
  );
  return out.join('\r\n');
}

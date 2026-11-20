# Qaap desktop installers (unsigned)

The desktop app (`examples/electron`) is packaged with electron-builder and published to GitHub Releases by
`.github/workflows/qaap-desktop-release.yml`. **The installers are not signed yet** (see "PENDIENTE: firmar").

## Publicar una versión

1. Crea y empuja un tag `desktop-vX.Y.Z` (solo números; p. ej. `git tag desktop-v0.1.0 && git push origin desktop-v0.1.0`),
   o lanza el workflow a mano (`workflow_dispatch`, campo `tag`).
2. El workflow compila, empaqueta en 4 runners (macos-14 arm64, macos-15-intel x64, windows-2022, ubuntu-22.04), sube todo a un
   borrador de release y, al final, lo publica **marcado como pre-release**. La versión de la app sale del tag (`X.Y.Z`).

## Artefactos (nombres fijos, sin versión)

| Plataforma | Archivo |
|---|---|
| macOS Apple Silicon | `Qaap-mac-arm64.dmg` |
| macOS Intel | `Qaap-mac-x64.dmg` |
| Windows x64 (NSIS) | `Qaap-win-x64.exe` |
| Linux | `Qaap-linux-x86_64.AppImage`, `Qaap-linux-x86_64.deb` |

Más `*.blockmap` y `latest*.yml` (feed de electron-updater). Las releases son pre-release, así que
`/releases/latest/download/...` **no las resuelve hasta que una release se marque como "latest"** (ver pendiente).
Mientras tanto, enlaza por tag: `https://github.com/juancristobalgd1/qaap/releases/download/desktop-vX.Y.Z/<artefacto>`.

Variables del VPS (landing de descargas) una vez haya una release "latest":

```
QAAP_DESKTOP_DOWNLOAD_URL_MAC=https://github.com/juancristobalgd1/qaap/releases/latest/download/Qaap-mac-arm64.dmg
QAAP_DESKTOP_DOWNLOAD_URL_WIN=https://github.com/juancristobalgd1/qaap/releases/latest/download/Qaap-win-x64.exe
QAAP_DESKTOP_DOWNLOAD_URL_LINUX=https://github.com/juancristobalgd1/qaap/releases/latest/download/Qaap-linux-x86_64.AppImage
```

(`Qaap-mac-x64.dmg` y `.deb` existen pero la landing solo admite una URL por plataforma.)

## Actualizaciones automáticas

Código: `packages/qaap-product/src/electron-main/qaap-desktop-updater.ts` y `qaap-desktop-update-policy.ts`.
Comprueba a los 15 s de arrancar y cada 6 h la release `desktop-vX.Y.Z` más alta (API de GitHub, ignora otras releases y borradores).

- Windows y Linux AppImage: descarga en segundo plano y muestra una notificación discreta "Restart to update"
  (si no se pulsa, se instala al cerrar).
- macOS sin firma y Linux `.deb`: solo avisa ("Update available — download") y abre la página de releases.
- App sin empaquetar (desarrollo): desactivado. `QAAP_DESKTOP_AUTO_UPDATE=0` lo apaga también en instalado.

## Qué lleva el paquete

- Bundle de producción de `examples/electron` (`npm run build:production`) más, de `node_modules`, solo los `@theia/qaap-*`
  (recursos: login, media, skills) y el prebuild `@parcel/watcher-<plataforma>` (el watcher lo carga con `require` calculado).
- Plugins VS Code de `plugins/` (`npm run download:plugins`) en `resources/plugins`.
- Entorno de producción fijado al arrancar (`qaap-packaged-runtime-environment.ts`): `QAAP_DESKTOP=1`, `QAAP_SKIP_AUTH=1`
  (modo local loopback, como el script de desarrollo) y `THEIA_DEFAULT_PLUGINS=local-dir:<resources>/plugins`. Sin secretos.
- Probar en local: `cd examples/electron && npm run build:production && npx electron-builder --config electron-builder.yml --publish never -c.extraMetadata.version=0.0.1 --mac dmg --arm64`
  (si ejecutas la app empaquetada junto a otra, usa `HOME=<dir temporal>` y `--user-data-dir`; los datos van a `~/.qaap`).

## PENDIENTE: firmar

- [ ] macOS: certificado **Developer ID Application** + notarización con `notarytool`. Secretos de GitHub: `APPLE_ID`,
      `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `CSC_LINK`, `CSC_KEY_PASSWORD`. En `electron-builder.yml`: quitar
      `identity: null`, activar `hardenedRuntime` (+ entitlements) y `notarize`; añadir el target `zip` (Squirrel.Mac lo necesita) y
      fusionar `latest-mac.yml` de arm64/x64 (hoy cada runner sube el suyo).
- [ ] Windows: certificado de firma de código (EV/OV o Azure Trusted Signing); quitar `signAndEditExecutable: false`.
- [ ] Activar el auto-update en macOS: poner `qaapDesktopSigned: true` en `extraMetadata` de `electron-builder.yml`.
- [ ] Quitar el flag pre-release (`--prerelease` en el paso Publish del workflow y `releaseType: prerelease`) y publicar como "latest".
- [ ] Linux: en Ubuntu 24.04+ el AppImage puede necesitar `--no-sandbox` (AppArmor restringe user namespaces); valorar paquete con `chrome-sandbox` setuid (.deb ya lo instala).

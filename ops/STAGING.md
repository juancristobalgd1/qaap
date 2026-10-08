# Staging qaap (listo 2026-10-08)

Objetivo: ningún merge a master sin E3 (cuenta de prueba) + E4 (copia de los datos de Juan) en staging.

## Diseño
- Mismo VPS (Contabo vmi3585668), contenedor aparte `qaap-staging` con la MISMA imagen GHCR por digest que se quiere promover (`QAAP_TENANT_IMAGE=<digest>`, `--no-build`).
- Ruta propia en Caddy: `https://161.97.69.219.sslip.io/staging/` (o subdominio sslip `staging.161.97.69.219.sslip.io`), mismo OAuth app con callback adicional.
- Datos: `/opt/qaap-staging/` separado de `/opt/qaap-runtime/`. Antes de cada E4 se copia DENTRO del VPS: `sqlite3 .backup` (vía python3, el VPS no tiene CLI) de `auth/users/juancristobalgd1/tenant.sqlite` y de la cuenta jcristgd -> `/opt/qaap-staging/auth/users/...`. La SQLite de Juan nunca sale del VPS ni pasa por CI.
- Recursos: límite de memoria/CPU del contenedor (p. ej. 4 GB, 2 cores) para no afectar a prod; se para cuando no se usa.
- Workflow nuevo `qaap-staging-deploy.yml`: solo `workflow_dispatch` (input: digest), environment `Preview`, mismos secretos SSH; nunca se dispara desde PRs ni forks.

## Flujo por PR
1. CI verde en el PR -> build de imagen -> digest.
2. `workflow_dispatch` staging con ese digest.
3. E3 en staging (1280 y 375x812) con jcristgd + E4 sobre la copia de los datos de Juan.
4. Solo entonces merge -> deploy prod con el mismo digest.

## Pendiente
- Uso: Actions > "Qaap staging deploy" > Run workflow (action=deploy con la imagen @sha256 del build a probar; action=stop al terminar). El workflow escribe /opt/qaap-staging/staging.env desde los secretos QAAP_STAGING_GITHUB_CLIENT_ID/SECRET del environment Preview, levanta qaap-staging-theia en la red qaap_default y publica https://staging.<host> copiando staging.caddy a deploy/caddy/staging-enabled/ y recargando Caddy (stop lo retira). Falta: app OAuth de GitHub para staging (callback https://staging.161.97.69.219.sslip.io/qaap/oauth/github/callback) y sus 2 secretos en Preview.
- Juan: nada más salvo ese permiso.

## Probar una rama (sin tocar producción)
- Actions > "Qaap staging deploy" > Run workflow con action=build y ref=<rama o commit>: construye `ghcr.io/juancristobalgd1/qaap:staging-<sha>` (usa la caché de producción solo para leer), la despliega en staging y deja el digest en el resumen del run. Producción no se toca: `qaap-vps-deploy.yml` con input branch SÍ despliega a prod, no usarlo para esto.
- Solo el workflow de master despliega en staging (tiene los secretos y el SSH). Lanzado desde otra rama (`--ref`), action=build construye la imagen pero no la despliega: esa copia del workflow no es de confianza. Para probar este mismo cambio antes de mergearlo: build desde su rama y luego action=deploy desde master con el digest del resumen.

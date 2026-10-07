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
- Fo: escribir workflow + compose override + bloque Caddy (requiere push: token con Contents/Workflows write).
- Juan: nada más salvo ese permiso.

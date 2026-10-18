# HANDOFF — flake "Playwright @qaap-mobile" (external Vite :5173)

Estado al 2026-10-18. Rama: `claude/fix-flaky-external-vite-50e03f` (worktree `.claude/worktrees/fix-flaky-external-vite-50e03f`).
Encargo original: encontrar y arreglar la causa raíz del check requerido flaky "Playwright @qaap-mobile"
(`examples/playwright/src/tests/qaap-transcript-preview-flow.ui-spec.ts`, ambas variantes), sin añadir reintentos.
Responder al usuario siempre en español.

## Causa raíz (confirmada con instrumentación, no solo hipótesis)

El bootstrap **nunca se enganchaba** al Vite externo de :5173; el test pasaba "por casualidad":

1. `startDevServerExtracted` (`packages/qaap-shared-core/src/browser/qaap-project-bootstrap-service-streaming.ts`)
   solo intentaba adjuntar al puerto de la *sección* (`previewClaimByConversation`). Sin él, reservaba un
   puerto y lanzaba su propio `vite`.
2. El asignador (`allocatePreviewPortExtracted`, `packages/qaap-shared-core/src/node/qaap-dev-preview-endpoint-render.ts`)
   veía 5173 ocupado por un listener sin registro (regla fail-closed: no inferir dueño por liveness) y
   daba el siguiente puerto libre: 5174. Resultado: segundo Vite propio, preview servido desde ese.
3. Los registros de identidad de tests/reintentos anteriores (ventana `PREVIEW_RESERVATION_START_GRACE_MS` = 5 min)
   y los Vite propios filtrados mantienen 5174, 5175… ocupados → en CI se llegaba a 5176
   (`--port 5173 --strictPort --port 5176`), y ese servidor no llegaba a staged a tiempo
   (`phase: ready-to-run`). Por eso fallaban **ambos intentos** (el reintento hereda el registro sucio).

Antes del arreglo, con el spec endurecido: 4/4 fallos deterministas (`lastPort` 5174/5175/5176,
`spawnedOwnServer: true`). El spec original pasaba 10/10 en local (máquina rápida) porque solo exige "staged".

## Cambios (todos en `packages/qaap-*` + spec; nada en paquetes upstream)

- `qaap-project-bootstrap-service-streaming.ts`: antes de reservar, `tryAttachToExistingServer([targetPort])`
  si no hay terminal gestionado vivo (un restart no adopta el servidor viejo que se está apagando).
  La propiedad se verifica igualmente por claim + probe.
- `qaap-dev-preview-endpoint-render.ts` (`allocatePreviewPortExtracted`): si el puerto preferido (offset 0)
  responde, no tiene registro de identidad y **el mismo dueño lo reclamó explícitamente** (`ownerOf(port) === owner`),
  se registra la identidad ahí en vez de saltarlo. En sesiones autenticadas el claim legacy ya devuelve 409 para
  un listener sin registro, así que no abre un agujero entre tenants (test: dueño distinto nunca adopta).
- `qaap-dev-preview-port-registry.ts`: `register(..., { claimedAt })` permite retrodatar la edad de la reserva;
  la adopción la retrodata `PREVIEW_RESERVATION_START_GRACE_MS` para que el reaper la libere en cuanto el
  listener muera (no hay arranque pendiente que proteger).
- Specs unitarios nuevos: `qaap-project-bootstrap-service-dev-run-guards.spec.ts` (3: adjunta / cae a reserva /
  no adopta en restart), `qaap-dev-preview-endpoint.spec.ts` (3: adopta claim explícito, no adopta de otro dueño,
  sin gracia).
- Spec e2e endurecido: `expectAttachedToExternalServer` (exige `lastPort === 5173` y que el bootstrap no
  haya lanzado su servidor) y `releasePreviewIdentities` en `finally` (aislamiento entre tests/reintentos).

## Resultados locales (puerto propio 3917, nunca :3000)

| | Resultado |
|---|---|
| Antes, spec original | 10/10 pasa (no detecta el problema) |
| Antes, spec endurecido | 4/4 falla |
| Con solo el arreglo de bootstrap | 1/14 pasa (adopción vía proceso fallaba: puerto 5174+) |
| Con arreglo completo, 1.ª tanda | 13/14 (1 fallo: attach por vía "puerto en uso") |
| Con arreglo completo, 2.ª tanda (`--repeat-each 15`) | **30/30** |
| Unit: `lib/browser/...dev-run-guards.spec.js`, `lib/node/qaap-dev-preview-*.spec.js` | verde |

El único fallo residual (1/14) no se reprodujo en 30 corridas; el assert ahora imprime la cola de salida
si vuelve a pasar. Si reaparece en CI, mirar ese mensaje primero.

## Pendiente (en orden)

1. `git add` de lo de abajo y commit; `git push`; abrir PR contra `master`. **No añadir `docs/HANDOFF.md`
   al PR si el usuario no lo quiere en master** (es un documento de traspaso; se puede borrar antes del merge).
2. Verificar: `npm run compile`, `node scripts/qaap-drift-check.js`, `node scripts/qaap-package-graph-check.js`.
3. Esperar a que TODOS los checks estén verdes (incluido "Playwright @qaap-mobile"), mergear. Cada merge
   despliega a producción (~15 min): vigilar que deploy y smokes sigan verdes.
4. Tras el merge, comprobar en un par de PRs siguientes que el check ya no pide reruns.
5. Secundario (no hecho): `qaap-agent-auto-continue.ui-spec.ts:29` es siempre el primer test de la suite, agota 4 min
   en frío y pasa al reintento en 9 s (marcado flaky). Arreglo barato: calentar en global setup o esperar la
   detección de agentes antes de enviar.
6. Riesgo conocido sin tocar: un registro de identidad adoptado de un proyecto anterior, con otro Vite nuevo en el
   mismo puerto, sigue bloqueando ese puerto hasta que el reaper (60 s) lo libere tras morir el listener; los
   tests lo evitan liberando explícitamente. Mejora posible: liberar la identidad al cerrar el bootstrap.

## Cómo reproducir / entorno (trampas de este worktree)

- `node_modules` del worktree estaba desincronizado con el lockfile (express 5 en vez de 4, faltaban paquetes):
  se resolvió con `bash scripts/qaap-npm-ci-retry.sh && npm run build:browser`. Si se parte de un worktree nuevo, hacer lo mismo.
- No hay `timeout` en macOS; lanzar playwright con `nohup ... &` y sondear el log.
- Compilar el spec: `cd examples/playwright && npx tsc -p .`. Ejecutar:
  `QAAP_PLAYWRIGHT_PORT=3917 QAAP_SKIP_AUTH=true QAAP_CLOUD_MODE=local npx playwright test --config=./configs/playwright.qaap-mobile.config.ts qaap-transcript-preview-flow --repeat-each 15 --retries 0 --reporter=list`
  (el filtro es un regex sobre el nombre del fichero, no la ruta `lib/...`).
- Cambios en `src/browser` o `src/node` requieren `npx theia build --mode development` en `examples/browser`
  (+ `node scripts/copy-frontend-static.mjs`) para que el e2e los vea; el backend también va en ese bundle.
- Nunca matar el servidor del usuario en :3000. `killDevPreviewPort()` del spec sí mata lo que escuche en :5173.
- No usar `git stash` genérico (pila compartida entre worktrees).

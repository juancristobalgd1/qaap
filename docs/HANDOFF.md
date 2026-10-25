# Handoff

Estado para continuar el trabajo desde otra cuenta o sesión. Actualízalo al cerrar cada tarea: qué queda pendiente, cómo se validó y qué limitaciones conviene conocer. La política de modelos está en la sección «Selección de modelos y orquestación» de `CLAUDE.md`.

## 2026-10-25 — Arranque de sandboxes por tarea: toolchain precalentado + sandbox de reserva

Ideas tomadas de tryboxi (warm pool, imágenes preparadas), aplicadas a los contenedores del broker. Detalle en `doc/qaap-task-sandbox.md` («Startup budget», «Spare sandbox»).

**Hecho** (rama `perf/task-sandbox-spare-prewarm`)
- `QaapTaskSandboxBroker.onStart` llena el volumen `qaap-agent-toolchain-*` de cada nodo Docker al arrancar el control plane (`QaapDockerOrchestrator.taskSandboxToolchainPlacements`); la clave del volumen ahora incluye el nodo.
- Sandbox de reserva por tenant: op nueva `prepare { homeLinks }` (el backend del tenant la envía en cada (re)link) y relleno tras cada create; un create de imagen base con los mismos enlaces HOME la adopta con `docker rename`. Oculta en `list`, fuera del cap, se reapea con el tenant. `QAAP_TASK_SANDBOX_SPARE=0` la apaga.
- Métricas `taskSandbox` en `QaapTenantRuntimeMetrics` (spare/cold p50/p95, reusos, spares, poblaciones del toolchain). Bench nuevo `scripts/qaap-task-sandbox-startup-bench.mjs`.

**Validación** (macOS, Docker Desktop 29.1.2, `node:22-bookworm-slim`)
- Bench: primer sandbox 1,2–5,9 s → 15–19 ms; siguientes p50 283–590 ms → 23–25 ms (solo prewarm: 213–232 ms).
- Specs de qaap-cloud-workspace: 2945 passing; broker e2e 14/14 en 10 ejecuciones seguidas (una ejecución anterior perdió la conexión exec del segundo sandbox y no se reprodujo).

**Pendiente**
- Medir en el VPS tras el deploy (`GET …/metrics` → `taskSandbox`, y el log `broker handed out the spare`); el «antes» de prod era 8,0 s el primer sandbox tras deploy.
- Si reaparece la pérdida de conexión exec al crear un sandbox mientras otro sirve tráfico, investigar el `network connect` al bridge de egress con `enable_icc=false` (afectaría también a creates en frío, no solo a la reserva).

## 2026-10-24 — VPS caído: backend de tenant se autoeliminaba y no se recuperaba

**Diagnóstico** (prod `https://161.97.69.219.sslip.io`, build `f89ce0b32`): toda la app quedaba en spinner + "took too long to start", 502 `Tenant backend unavailable / socket hang up` en `project-sessions`, `user-settings` y `socket.io`.
- Causa 1: el forwarder del sandbox hace que el propio backend escuche en el puerto de la preview; al sustituir la preview, `terminateListenersOnPort` le mandaba SIGTERM a sí mismo y a su grupo (logs: `[qaap-preview] reserved` → 3 s → `Stopping backend contributions`, Exited 1, ambos tenants el 23 oct).
- Causa 2: el relay `qaap-ingress-*` sigue vivo, el proxy ve `socket hang up` (no un connect error), nunca invalida el target ni re-ensura → 502 permanente. Sin restart policy.

**Hecho** (rama `fix/tenant-backend-preview-selfkill`)
- Mitigación en prod: `docker start` de los dos `qaap-backend-*` en el Docker rootless (uid 1000). Se volverán a caer al abrir una preview hasta desplegar el fix.
- `qaap-shared-core`: guard `isSelfOrUnsafeSignalTarget` / `canSignalProcessGroup` (nunca pid ≤1, el propio pid ni un grupo que contenga al backend; fail-safe si no se lee el pgid) en `terminateListenersOnPort`, `terminatePreviewProcessExtracted` y `releasePreviewsForWorkspace`; `findListeningProcessCwdsOnPort` ignora el propio pid.
- `qaap-cloud-workspace`: hang-up antes de respuesta (no abortado por el cliente) invalida el target y reintenta GET/HEAD una vez; WS invalida igual; backend de tenant creado con `RestartPolicy on-failure` (3).

**Validación**
- `npx tsc -b` de ambos paquetes OK; specs: shared-core 116 passing, cloud-workspace 147 passing; drift-check OK; eslint 0 errores.
- Diagnóstico de usuario hecho por un agente Haiku en el navegador (bloqueado en el arranque, flujos 2-8 sin probar).

**Pendiente**
- PR + CI + deploy; tras deploy, repetir la prueba Haiku de flujos 2-8 (Work Hub, añadir repo, delegar tarea, Settings/BYOK, recarga, móvil).
- Al sustituir una preview servida desde el sandbox, el dev server dentro del sandbox no se termina (huérfano): enrutar el terminate al exec server del sandbox.
- `osProcessId` reportado desde el sandbox está en otro pid namespace: no debería señalarse localmente.
- P1: mensaje de error real en el frontend cuando el backend devuelve 502; fallos `opencode`/`qaiq` exit 1; `could not grant agent uid 1001 access … cache`; `task storage write failed`.

**Ronda 2 de QA (Haiku, cuenta jcristgd, 23 oct 23:10 UTC)**
- El autokill también lo dispara el reaper sin acción del usuario: `qaap-backend-7626…` murió a las 22:35 tras `[qaap-preview] reaped stopped process` (preview vieja del puerto 3000). Reiniciar a mano es inútil hasta desplegar #349.
- 403 `{"code":4}` en bucle de socket.io: token de conexión rotado al reiniciar el backend y cacheado en el control plane. Arreglado en #349 (commit 02c77d30d). Mientras no se despliegue, afecta a jcristgd (reinicio manual).
- **Pendiente P0, otra PR:** `parseOpencodeLog` (`qaap-shared-core/src/common/qaap-opencode-stream.ts`) devuelve `content: getDisplayText() || log`; cuando el modelo no produce texto (opencode/big-pickle: 6 tokens de salida), el transcript muestra el NDJSON crudo (`step_start`/`step_finish`) como respuesta. Debe tratarse como turno vacío o fallido, con retry o modelo de reserva. Revisar también `qaap-cli-transcript-stream.ts` ~98.
- "Working" sin fin: el primer turno tenía `runFinishedAt` en el registro; el segundo turno ("njn", enviado por el usuario) seguía ejecutando la verificación `npm run build` del monorepo qaap. Verificar tras el deploy si la UI cierra el turno.
- BYOK en Settings muestra la lista entera del editor: la sección filtra `ai-features` en el widget de preferencias; probablemente el filtro no se aplicó por el 403. Reverificar tras el deploy.
- UX: el selector de proyecto de la cabecera no abre menú; no hay acción visible para abrir la preview; Copy sin feedback; controles del composer (Build / Approve for me / Standard) sin explicación y truncados en móvil.

## 2026-10-23 — Política de selección de modelos

**Hecho**
- `CLAUDE.md`: la sección de orquestación sustituye el esquema Fable/Sonnet por Opus (pensar, revisar, decidir) + Haiku (ejecución rutinaria), con reglas de escalado y ejecución.
- `.claude/agents/fast-worker.md`: `model: haiku` (antes `sonnet`) y regla de escalado a `deep-reasoner`. `.claude/agents/deep-reasoner.md` sigue en `model: opus`.
- `scripts/qaap-drift-check.js`: `docs/HANDOFF.md` añadido al `ALLOWED`.

**Validación**
- `node scripts/qaap-drift-check.js` en verde. Sin cambios de código: no aplica compile ni build.

**Limitaciones**
- `.claude/agents/` se versiona en el repo desde el 2026-10-23 (excepción en `.gitignore`), así que la política de modelos de los subagentes viaja con el repo a cualquier cuenta o máquina.
- El modelo por defecto de la sesión principal lo fija `~/.claude/settings.json` (`"model"`) o el selector de la app; en la cuenta original se cambió de `fable[1m]` a `opus` el 2026-10-23. En otra cuenta, ajústalo igual.

**Pendiente**
- Nada.

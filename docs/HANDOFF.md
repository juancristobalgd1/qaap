# Handoff

Estado para continuar el trabajo desde otra cuenta o sesión. Actualízalo al cerrar cada tarea: qué queda pendiente, cómo se validó y qué limitaciones conviene conocer. La política de modelos está en la sección «Selección de modelos y orquestación» de `CLAUDE.md`.

## 2026-11-07 — gVisor (systrap) para tenants: sonda sobre el daemon rootless

**Hecho** (rama `claude/gvisor-systrap-implementation-73cb80`): `scripts/qaap-runsc-rootless-probe.sh` comprueba si runsc funciona sobre rootless con el contrato real de los tenants. Usa un daemon desechable y no toca producción. Si funciona, sobran el daemon rootful y el proxy de `origin/claude/tenant-runsc-theia-homes`, cuya revisión fue NO APTO.

**Validación** (Docker Desktop arm64, `docker:29-dind-rootless`, sin cgroups delegados; no equivale al VPS)
- Pasan: arranque con systrap (solo con `--ignore-cgroups` en este entorno), bind y uid mapping, setpriv a 1001, git, SQLite WAL, inotify, exec y TTY, restart, relay runc→runsc y aislamiento de la red interna. La limpieza no deja restos.
- Fallan: DNS desde runsc en bridge de usuario (gVisor #7469), también con las dos redes conectadas antes del start, y memoria (1024 MiB bajo un límite de 256 MiB, esperable sin cgroups). Aviso: pids sin aplicar (204 bajo un límite de 64).
- Sin probar: `--reproduce-nat`, añadido como arreglo del DNS después de esa ejecución. Existe en `runsc/config/flags.go`; la reejecución local quedó bloqueada por permisos.

**Resultado en el VPS** (7 nov, kernel 6.8.0-149, Docker 29.8.1, driver systemd): `NOT VIABLE` tal como está, limpieza correcta.
- Cgroups: runsc solo arranca con `--ignore-cgroups`, que elimina los límites (1024 MiB bajo un límite de 256). Con el driver systemd usa el bus del sistema y polkit lo rechaza: gVisor #11543, con arreglo propuesto en #13853 sin fusionar.
- DNS: falla desde runsc en bridge de usuario también con `--reproduce-nat` (gVisor #7469, abierto). Los tenants usan el alias `qaap-tenant-egress-proxy` para llegar a Squid.
- Pasa el resto del contrato. Coste de una sola medición: 2000 ficheros en bind 1,66 → 6,21 s; arranque de node 1,00 → 1,98 s.

**Fork de gVisor** (decisión del usuario, 7 nov): `juancristobalgd1/gvisor`, rama `qaap-release-20261102.0-rootless` (05ea21fd2; sin `/` porque `build.yml` filtra con `branches: "*"`, que no la admite) = release `20261102.0` + los dos commits de google/gvisor#13853 + un commit vacío que dispara el CI. El segundo se portó a mano sobre el refactor `resourceProps`. El CI propio de gVisor (`build.yml`) debe compilar `//:release` al hacer push; GitHub exige habilitar Actions en la web del fork.
- Validado: el parche compila sobre la rama `go` (commit de la release +17, no la release exacta) y pasan sus tests de `runsc/cgroup`. `TestCreateController` falla igual sin el parche (corre como root en Docker). No probado aún con Docker real ni en x86_64.
- Corrección: el ✅ de «la red interna no tiene egress» de la ejecución anterior no probaba nada, porque usaba DNS roto. La sonda ya comprueba por IP.

**Sonda con el binario del fork en el VPS** (run 42374045629, x86-64, Docker 29.8.1): `VIABLE` con 2 avisos, flags `--platform=systrap --systemd-cgroup`, limpieza correcta.
- Pasan: límite de memoria (la asignación se detuvo en 448 MiB con `--memory 256m`; no se confirmó el exit 137 y es coherente con los 256 MiB de swap que Docker añade por defecto), setpriv, bind, git, SQLite WAL, inotify, relay runc→runsc, `--add-host`, aislamiento por IP, dos redes, exec, TTY, restart.
- Avisos: DNS embebido sigue roto (#7469). Prueba de pids sin resultado (sin salida con `--pids-limit 64`): no sabemos si se limitó o si murió el sandbox.
- Coste, una medición: 2000 ficheros en bind 1,91 → 7,92 s (×4,1); arranque de node 0,95 → 1,93 s (×2).

**Implementado sin commitear ni desplegar** (7 nov): `qaap-tenant-runtime.ts` con `QAAP_TENANT_RUNTIME` y `QAAP_TENANT_RUNSC_LOGINS`; orquestador y broker con runtime por tenant y `ExtraHosts` con la IP actual de Squid; `deploy/rootless/gvisor/qaap-gvisor-install.sh` (`install|check|remove`) y su test. Release publicada: `qaap-20261102.0-1` en el fork, asset `gvisor-fork.tar.zstd`, SHA-512 fijado en el instalador. Verificado: 218 specs, 14 tests del instalador con dobles, sin daemon real.

**Mediciones en el VPS, primera ronda** (filas limpias runc/runsc; el resto se solapó en parte con una segunda ejecución): `npm install` ×3, `tsc` ×4,2, `git` ×3. `--dcache` y `--file-access-mounts=exclusive` no ayudan; `--directfs=false` empeora. Recarga con HUP: daemon vivo, runtime nuevo operativo, contenedor conservado. Limpieza al interrumpir: comprobada.
- Pids: 31 tareas en reposo y unas 2,4 tareas del host por proceso del invitado. Con límite 256: 100 procesos llegan a 246; 200 matan el sandbox entero (exit 2), sin `EAGAIN`. Fork bomb: muere en menos de 10 s, host intacto. **El límite actual no sirve bajo runsc.**

**Segunda ronda** (`tune2`): más CPU no ayuda (`npm` 80 s con 2 CPUs, 74 s con 8; runc 25 s), `RLIMIT_NPROC` no se aplica, 1024 de pids aguantan 400 procesos y a 500 muere el sandbox. Aplicado `QAAP_RUNSC_PIDS_FACTOR = 4`.

**Revisión de seguridad independiente** (`deep-reasoner`, solo lectura, sin nada en vivo): canario en un login sí con condiciones; todos los tenants no. Corregido: A1 (plazo de 30 min y `reconcileTenantRuntimes` en el reaper), M2 (README con `--noproxy`), M4 (`check` lee el cgroup de un sandbox real), M5 (flags exactos, ruta del binario, nueva lectura cada 60 s), M6/M7/B5/B6 (instalador), M8 (`forCreate`), M9 (límites de Squid, recrea Squid de todos los tenants en el siguiente despliegue), M11 (`qaap-gvisor-upstream-watch.yml`), B2, B3. Sin corregir: B1 (IP de Squid, falla cerrado), B4 (no afecta a logins de GitHub).

**Sonda de seguridad y contrato final en el VPS** (flags definitivos, ajustes de red de producción, `VERDICT: VIABLE`): sentry con uid sin privilegios y 0 capacidades; gofer sigue con uid 1000, capacidades y seccomp. El uid del agente no lee el entorno de root, raíz de solo lectura, `/tmp` sin ejecución. Con controles positivos, ni runc ni runsc alcanzan desde la red interna el relay de otro tenant, la gateway, `10.0.2.2` ni la IP pública. Pausa, reanudación, OOM (137, 3 reinicios) sin unidades fallidas ni scopes restantes. Adoptado `--directfs=false`: `npm` igual, `tsc` +16 %, `git` +35 %, pero 2000 ficheros pequeños ×10 frente a runc. A2 resuelto con `qaap-<hash>.slice` (`TasksMax=8192`) bajo `qaap.slice` (50000); los límites de slice no se han probado aún en el VPS.

**Pendiente**
- Canario en staging y luego en un login, con los pasos del README. M3 se simuló: repetirlo contra relays reales. Medir tareas reales antes de decidir activarlo para todos.
- `--memory` deja el doble con swap, igual que en runc; decidir aparte si fijar `MemorySwap`.
- Restos en el VPS: `/tmp/gvisor-fork.tar.zstd`, `/tmp/qaap-runsc-rootless-probe.sh`. En el fork, rama antigua `qaap/release-20261102.0-rootless` sin uso.
- Revisión de seguridad independiente del fork y del montaje antes de producción, y medir un build real.
- Mantener el fork al día con los parches de seguridad de gVisor; la PR sigue sin revisión de Google.
- Restos en el VPS: `/tmp/gvisor-fork.tar.zstd`, `/tmp/qaap-runsc-rootless-probe.sh`.

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

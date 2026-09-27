# Auditoría de Multi-Tenancy — Qaap

> Estado del documento: **auditoría revisada (v5, 2026-09-16)**
> Alcance: aislamiento por usuario autenticado de todos los recursos persistentes y temporales.
> Veredicto global: **La arquitectura completa por tenant está implementada y cerrada detrás de un gate explícito; la configuración por defecto sigue siendo privada/híbrida hasta activar y validar ese gate.** En backend-per-tenant, el control-plane conserva sólo OAuth, health y admisión, y enruta HTTP/RPC/WebSocket autenticado al backend Theia dedicado del tenant. Cada backend y worker usa usuario no privilegiado, filesystem allowlist, rootfs de sólo lectura, límites y red Docker dedicada. El control-plane mantiene logs operativos, billing y estado de admisión centralizados por diseño; no deben tratarse como datos de tenant. El boot guard y el launch gate bloquean cualquier `QAAP_BETA_ALLOWED_LOGINS` si faltan `QAAP_BACKEND_PER_TENANT=1` o el secreto maestro de 32 caracteres.

## 0. Estado de implementación y validación local (2026-09-16)

La remediación de aislamiento está implementada en el repositorio y fue validada localmente con Docker real:

- `QaapTenantBackendProxy` mantiene en el control-plane únicamente health, OAuth y admisión; el tráfico autenticado HTTP/RPC/WebSocket se enruta al backend Theia del tenant.
- Cada tenant recibe un backend y un worker Docker distintos, con aserción HMAC ligada al login, token interno de BrowserConnection, usuario `theia` no privilegiado, rootfs de sólo lectura, `no-new-privileges`, `CapDrop=ALL`, límites de CPU/memoria/PIDs, mounts allowlisted y red dedicada con ICC desactivado.
- La reutilización de contenedores valida imagen, usuario, mounts, red, límites y todas las variables de aislamiento; una configuración incompatible no se reutiliza.
- El control-plane filtra terminales, procesos, jobs, tasks, conversaciones, filesystem, skills, HOME/config, keystore, MCP OAuth, variables y eventos por tenant. Los logs operativos del control-plane permanecen centralizados y son datos de operador, no datos expuestos al tenant.

Evidencia reproducible de esta revisión:

| Comprobación | Resultado |
| --- | --- |
| Suite multi-tenant enfocada | **140 passing** |
| Compilación Docker completa | **101 proyectos compilados** |
| Integración real de dos tenants | Contenedores, puertos y redes distintos; autenticación cruzada denegada |
| Smoke test de imagen | Usuario `theia`, rootfs read-only, capabilities eliminadas y `no-new-privileges` |
| `npm audit` / `npm audit --omit=dev` | **0 vulnerabilidades conocidas** |
| Compose y launch gate | Correctos; el gate bloquea configuración incompleta |
| Drift de upstream | **0 drift nuevo fuera de allowlist** |

La validación local demuestra el lifecycle y las fronteras del código. Antes de una beta pública todavía debe ejecutarse la aceptación operativa en un VPS Linux con Docker rootless, OAuth real, TLS/DNS, dos cuentas invitadas, backups off-site y `scripts/qaap-vps-launch-gate.sh`.

---

## 1. Contexto arquitectónico (causa raíz)

Qaap está construido sobre **Eclipse Theia**, un framework de IDE diseñado como **single-tenant**: un usuario del SO por proceso backend. El estado vive en el `$HOME` del backend (`~/.qaap/...`, keystore del SO, preferencias) y en singletons de proceso (`ProcessManager`, managers de MCP, etc.).

Las mitigaciones aplicadas (campos `ownerLogin`, `requireAuth`, el módulo de aislamiento por rutas y el worker por contenedor) son una capa multi-tenant **encima** de una base Theia single-tenant. Cubren el código ejecutable y los límites expuestos al navegador, pero NO convierten automáticamente todos los recursos del SO/proceso compartido en privados:

- Terminales y procesos siguen teniendo un `ProcessManager` singleton de proceso, aunque su comando se enruta al worker del tenant en modo Docker. En hosting, los terminales quedan owner-scoped en el índice de procesos y en el canal crudo `/services/terminals/:id`; el singleton sigue siendo una limitación interna de Theia, no una vía de attach cruzado.
- MCP OAuth, `KeyStoreService`, `userstorage://`, HOME lógico, colecciones de variables de terminal y skills personalizadas tienen scope por tenant en hosting. Las skills del sistema son globales pero sólo de lectura.
- El backend necesita un control-plane Docker; un socket rootful montado directamente no equivale a un usuario sin privilegios. El runtime rechaza cualquier socket rootful, TCP sin cifrar, named pipe o supervisor no implementado en modo hospedado y exige un socket rootless.

**Decisión aplicada**: Qaap implementa la Opción A detrás de `QAAP_BACKEND_PER_TENANT=1`: un backend Theia y un worker Docker por tenant, con routing HTTP/RPC/WebSocket desde el control-plane y una aserción HMAC de corta duración ligada al login. La configuración `QAAP_BACKEND_PER_TENANT=0` conserva la Opción C endurecida para desarrollo privado y validación. No basta con cambiar el modo compilado ni con inventar una variable: el gate exige el wiring real y el secreto maestro.

## 1.1 Modelo de tenancy por rutas (existente)

`packages/qaap-adapters/src/common/qaap-user-isolation.ts` define la estrategia central:

- Repos por usuario en `{reposRoot}/users/{login}/{owner}/{repo}` (`resolveRepositoryWorkspacePath`).
- `isPathUnderUserWorkspace(targetPath, reposRoot, userLogin)` valida que toda ruta accedida quede en el subárbol del usuario.
- `QaapGithubAuthGuard.ownsWorkspacePath` / `assertWorkspacePathOwned` aplican esa comprobación en los endpoints (git-review, oauth, conversaciones, tasks).
- Caches del browser scoped vía `qaapUserScopedStorageKey(baseKey, userLogin)`.
- Buckets dedicados para anónimo (`_anonymous`) y dev skip-auth (`_dev`).
- Tests: `packages/qaap-mobile-shell/src/node/qaap-user-isolation-security.spec.ts` verifica denegación cross-user.

Esto hace que conversaciones, tasks, archivos y repos **sí** estén aislados por usuario aunque su persistencia física comparta un archivo JSON: el control de acceso es por ruta-bajo-usuario en cada endpoint.

---

## 2. Matriz de cumplimiento por recurso

Leyenda: ✅ aislado · 🟡 parcial · ❌ no aislado (fuga posible en backend compartido)

| Recurso (spec) | Estado | Evidencia / nota |
| --- | --- | --- |
| Workspaces (capa cloud) | ✅ | `QaapCloudWorkspaceStore.list/ensure` filtra por `ownerLogin`. |
| Repositorios Git | ✅ en hosting | Clonados bajo `users/{login}/...`; Git OAuth, Git Review, worktrees, research y workflows pasan por el worker tenant en hosting; acceso validado por `assertWorkspacePathOwned`. |
| Archivos / directorios | ✅ en hosting | El proveedor de filesystem usa allowlist por tenant, realpath anti-symlink y bloquea `/root`, `/app`, `/tmp` y worktrees ajenos. Upload con validación de traversal. |
| Sesiones del agente (tasks) | ✅ | `ownerLogin` persistido + acceso por ruta-bajo-usuario en endpoint; callbacks del helper usan token por usuario (C-5). |
| Chats / conversaciones | ✅ | Endpoint aplica `ownsWorkspacePath(ctx, cwd)` en list/get/stream. (`list()` del store filtra por cwd; el control de acceso lo hace el endpoint.) |
| Threads / historial | ✅ | Igual que conversaciones (mismo store/endpoint). |
| Caches del browser | ✅ | `qaapUserScopedStorageKey` por login. |
| Preview | 🟡 | `QaapPreviewShareStore.create` acepta `ownerLogin`; puertos a nivel de workspace. |
| Eventos en tiempo real (SSE/WS) | ✅ | Tasks y conversaciones filtran por ownership; `cancel`, `created` y `updated` no cruzan el límite del tenant. |
| Contenedores / runtimes | ✅ en backend-per-tenant | `QaapDockerOrchestrator` mantiene un backend Theia y un worker estables por tenant, monta sólo las raíces del tenant, exige UID/GID no-root, límites, `no-new-privileges`, `CapDrop=ALL`, rootfs de sólo lectura, red dedicada/ICC off y valida el `inspect` antes de reutilizar. |
| Secrets / tokens | ✅ en las fronteras cubiertas | Copilot, OAuth MCP y el RPC genérico `KeyStoreService` usan namespace derivado del tenant; las claves de proveedor no se exponen al frontend ni se heredan al worker sin filtrado. |
| Credenciales OAuth (Copilot) | ✅ | La cuenta se deriva del owner autenticado; el token subyacente ya no se comparte entre tenants. |
| Terminales | ✅ en hosting | El PTY ejecuta `docker exec -it --user 1000:1000` sólo después de validar el worker. Qaap registra el login propietario al crear cada terminal y filtra `ProcessManager.get` más el canal crudo `/services/terminals/:id`; un attach cruzado devuelve terminal inexistente. El singleton interno de Theia permanece, pero no expone ids entre tenants. |
| Procesos | ✅ en modo Docker | Agente, preview, deploy, jobs, verificaciones y terminales esperan `ensure → inspect → exec`; el fallback host está bloqueado al arrancar en hosting. El `ProcessManager` host sigue compartido internamente, pero sus terminales están owner-scoped. |
| Skills | ✅ para datos de tenant | HOME/config/skills personalizadas apuntan al root del tenant; las skills del sistema son globales, de sólo lectura, y el proveedor bloquea rutas externas no allowlisted. |
| MCP Servers | ✅ en backend-per-tenant | El backend Theia dedicado elimina el manager/configuración singleton compartido entre tenants; OAuth y keystore reciben además namespace por login. En modo híbrido privado se mantiene la defensa owner-scoped del control-plane compartido. |
| Configuración de usuario (preferences) | ✅ para `userstorage://` | `getConfigDirUri()`, `getHomeDirUri()` y los archivos asociados se resuelven bajo `~/.qaap/users/{login}`; servicios singleton no basados en user storage siguen siendo responsabilidad del backend compartido. |
| Variables de entorno | ✅ en la frontera navegador/worker | `EnvVariablesServer` filtra secretos/control-plane al navegador; el `process.env` interno del backend sigue siendo compartido y nunca debe tratarse como API de tenant. |
| Cache / índices / embeddings | 🟡 | No se detectó store de embeddings dedicado; revisar si se añade en el futuro. |
| Recursos temporales | ✅ para worktrees | Worktrees de parallel-run y conversaciones están segmentados por tenant; el worker monta únicamente las tres raíces temporales del tenant y traduce sus rutas; los snapshots internos deben seguir siendo inaccesibles desde filesystem/RPC. |
| Logs | 🟡 operador-only | Los logs de tareas y snapshots sensibles autenticados se escriben bajo `~/.qaap/agent-tasks/owners/{login}/`; los logs del proceso y varios índices del control-plane siguen compartidos físicamente. No existe endpoint de lectura para el navegador. Deben protegerse como datos de operador y no incluir secretos ni payloads completos. |

> Nota de precisión (v2): la v1 marcaba conversaciones/tasks/archivos como 🟡/❌ por error. El control de acceso por ruta-bajo-usuario en los endpoints SÍ los aísla. El hallazgo C-4 queda **descartado** como fuga.

---

## 3. Hallazgos críticos (con evidencia)

### C-1 · Contenedores compartidos por repo, no por usuario · ✅ CORREGIDO EN MODO DOCKER

`packages/qaap-cloud-workspace/src/node/qaap-docker-orchestrator.ts`

Antes el contenedor se nombraba sólo por `repoKey`, de modo que dos usuarios con el mismo repo compartían contenedor, procesos, FS y mounts. El camino cloud actual usa `containerNameForTenant(segment)` —un contenedor estable por tenant, no por repo— y monta únicamente las tres raíces canónicas del tenant: repositorio, worktrees de conversación y parallel-runs. `QaapDockerOrchestrator` no reutiliza silenciosamente una configuración distinta: inspecciona labels, imagen, usuario, mounts exactos, límites, capacidades, rootfs y red; si no coinciden, falla cerrado.

El lifecycle de ejecución también está cerrado: los caminos async esperan `prepareTenantIsolationAsync()` y los caminos síncronos (PTY/compatibilidad) rechazan el spawn si no existe un worker previamente validado. Ya no existe el prewarm best-effort que ignoraba el error y continuaba sobre el host.

### C-2 · Secrets/OAuth en keystore global y fijo · ✅ CORREGIDO

`packages/ai-copilot/src/node/copilot-auth-service-impl.ts`

Antes el `keystoreAccount` era fijo (`'github-copilot'`), de modo que el token OAuth de un usuario era legible por otro en el mismo backend. **Corregido**: `setOwnerLogin(login)` se añadió a la interfaz `CopilotAuthService` y su implementación compute `keystoreAccount` como `${baseAccount}:${ownerLogin}`. Una contribución frontend (`QaapCopilotOwnerBinding`) llama `setOwnerLogin` con el login de la sesión Qaap al arrancar, propagándolo via RPC al backend per-conexión. Cada usuario ahora lee/escribe su propio entry del keystore del SO.

La misma frontera se aplicó a OAuth de MCP en `qaap-mcp-oauth-tenant-scope.ts`: las operaciones `get/set/delete/keys/findCredentials` sólo ven las cuentas del owner autenticado y rechazan el acceso sin owner en runtime hosted. El RPC genérico de `KeyStoreService` también deriva el service key por tenant. La configuración MCP que permanece en managers singleton sigue siendo una limitación interna del backend compartido; el código que la usa corre en el worker del tenant y no recibe el filesystem/config de otro tenant.

### C-3 · Terminales adjuntables por id sin verificación de usuario · ✅ CORREGIDO EN HOSTING

`packages/terminal/src/node/terminal-backend-contribution.ts`

Antes, cualquier cliente conectado podía adjuntarse a la terminal de otro usuario en un backend compartido conociendo o iterando el id numérico del proceso (`this.processManager.get(parseInt(params.id, 10))`).

**Corrección implementada**: en modo Docker, [`QaapTenantSpawnService.wrapShellForTenant`](packages/qaap-cloud-workspace/src/node/qaap-tenant-spawn-service.ts) redirige el shell interactivo a `docker exec -it --user 1000:1000` dentro del worker validado del tenant. Además, [`QaapTerminalOwnership`](packages/qaap-cloud-workspace/src/node/qaap-terminal-ownership.ts) registra el owner del PTY al crear el proceso, filtra `ProcessManager.get` en todas las operaciones RPC y conserva el login en los listeners del canal crudo `/services/terminals/:id`. Un usuario que adivine el id de otro tenant recibe un proceso inexistente y no obtiene su output/input. El ProcessManager continúa siendo singleton internamente, pero ya no funciona como namespace de attach compartido.

### C-4 · Persistencia global única para tasks/conversaciones · ❌ DESCARTADO (no es fuga)

`qaap-agent-conversation-store.ts` y `qaap-agent-task-runner.ts` usan un archivo JSON global. **Sin embargo**, el control de acceso lo hace el endpoint con `ownsWorkspacePath(ctx, cwd)` (list/get/stream), y cada `cwd` vive bajo `users/{login}/`. Dos usuarios no comparten cwd, por lo que no hay lectura cruzada. La persistencia física compartida es aceptable mientras el acceso siga validado por ruta. (Defensa en profundidad opcional: filtrar también por `ownerLogin` en el store.)

### C-5 · Token compartido del helper CLI de agentes · ✅ CORREGIDO

`qaap-agent-task-runner.ts`

Antes existía un único token de proceso para el helper `qaap-task`, común a todos los usuarios. **Corregido**: los tokens ahora son por usuario (`helperTokens` map, `helperTokenForOwner`, `resolveHelperTokenOwner`). El endpoint `handleCreate` autentica callbacks del helper CLI por token per-user y scopea sub-tasks al owner del token.

### C-6 · Skills desde HOME compartido · ✅ CORREGIDO

`packages/qaap-ai-config/src/browser/qaap-skill-service.ts`

Los directorios globales de skills del runtime no deben ser modificables por un tenant. **Corregido**: en hosting, `getQaapBuiltinSkillDirectories` usa el root sintético `QAAP_TENANT_CONFIG_ROOT/users/{login}/skills` para skills personalizadas; las skills del sistema se allowlistean sólo para lectura y el filesystem provider bloquea escrituras o rutas externas.

### C-7 · Directorios temporales compartidos · ✅ CORREGIDO

`qaap-parallel-run-store.ts` y `qaap-conversation-worktree.ts` usaban `os.tmpdir()` sin segmento por usuario. **Corregido**: ambos ahora segmentan por `ownerLogin` (`os.tmpdir()/qaap-parallel/{tenant}/{slug}` y `os.tmpdir()/qaap-worktrees/{tenant}/{slug}`). Los worktrees de cada usuario viven bajo su propio subdirectorio temporal.

---

## 4. Lo que SÍ está mitigado (trabajo previo)

- `requireAuth` en endpoints de `qaap-cloud-workspace` (12 handlers).
- `ownerLogin` persistido y filtrado en `QaapCloudWorkspaceStore` (workspaces).
- `ownerLogin` persistido en tasks, conversaciones, parallel-runs y preview-share.
- Webhook token de GitHub restringido al owner del repo.
- Validación de path traversal en `NodeFileUploadService`.
- Invalidación de cache de auth en `CopilotAuthServiceImpl.setClient`.
- Filtrado de eventos del inbox SSE por repos permitidos.

> Nota: estas mitigaciones reducen superficie en la capa HTTP/cloud, pero **no** sustituyen el aislamiento de las capas core.

---

## 5. Caminos de remediación

### Opción A — Backend Theia completo por tenant (implementada detrás de gate)

Cada usuario autenticado obtiene su propio backend Theia además de su worker, con `$HOME`, keystore, preferencias, MCP, skills, terminales, logs e índices propios. Es el único camino para afirmar aislamiento de memoria y de todos los singletons internos.
- **Ventaja**: elimina el residuo de estado compartido del backend.
- **Coste**: infra mayor (proceso/contenedor por usuario, routing por sesión, ciclo de vida y observabilidad por tenant). Falta validar el despliegue real en VPS con dos cuentas y carga concurrente antes de anunciarlo como beta.

### Opción B — Backend compartido tenant-aware

Refactor de cada servicio core para ser `userId`-scoped: keystore, MCP manager, skills, preferences, `ProcessManager`, language models, embeddings.
- **Ventaja**: densidad (un backend, muchos usuarios).
- **Coste**: muy alto, va contra el diseño de Theia, alto riesgo de regresión y de fugas residuales.

### Opción C — Híbrido endurecido (fallback privado)

Backend compartido para la orquestación/cloud (ya con `ownerLogin`) + contenedor por usuario para ejecución de agentes, Git, terminales, archivos, procesos, jobs y verificaciones. La frontera está explícita y fail-closed, pero logs/índices internos y singletons siguen siendo datos de operador del control-plane; no es el modo válido para terceros.

---

## 6. Plan priorizado (independiente del modelo elegido)

### P0 — Bloqueantes de seguridad

1. ~~**C-2 secrets**: derivar la cuenta de keystore por usuario~~ ✅ CORREGIDO
2. ~~**C-3 terminales**: asociar cada terminal a una sesión/usuario y verificar propiedad en `attach`/canal `:id`~~ ✅ CORREGIDO en hosting mediante `QaapTerminalOwnership` y el seam de autenticación RPC/canal.
3. ~~**C-1 contenedores**: incluir `ownerLogin` en `containerNameFor`~~ ✅ CORREGIDO
4. ~~**C-9 user storage**: evitar que `userstorage://` use el directorio Theia global~~ ✅ CORREGIDO en hosting mediante `getConfigDirUri()` por tenant y guardia de filesystem.

### P1 — Aislamiento de datos

1. **C-4 persistencia**: ❌ DESCARTADO (no es fuga, ver §3).
2. ~~**C-5 task-token**: token por usuario~~ ✅ CORREGIDO
3. ~~**C-7 temporales**: segmentar `os.tmpdir()` por usuario~~ ✅ CORREGIDO
4. ~~**C-8 API keys**: `buildChildEnv` copiaba `process.env` (con API keys compartidas) y leía `~/.theia/settings.json` (HOME compartido)~~ ✅ CORREGIDO. `stripSharedProviderEnv` elimina todas las provider keys de `process.env` antes de inyectar las del usuario; `readUserSettingsFromDisk(ownerLogin)` lee `~/.qaap/users/{login}/settings.json` cuando hay ownerLogin.

### P2 — Configuración y capacidades

1. ~~**C-6 skills** y MCP/preferences~~: skills personalizadas, HOME/config, OAuth MCP y keystore ✅ CORREGIDOS. El manager MCP singleton queda como estado interno del control-plane; la ejecución tenant no comparte ese filesystem ni sus credenciales.
2. ~~**Eventos en tiempo real**: verificación de destinatario en todos los streams SSE/WS~~ ✅ CORREGIDO. SSE y WS de tasks y conversations ya filtraban por `ownsWorkspacePath`; fix: WS `cancel` ahora verifica ownership antes de cancelar; SSE/WS de conversations ahora usa `eventIsOwned` que cubre `created`/`updated` (cwd dentro de `conversation`) además de eventos con cwd top-level.

### P3 — Validación

1. ~~Test de aislamiento con **dos usuarios concurrentes**: no comparten workspaces, archivos, terminales, conversaciones, secrets ni eventos.~~ ✅ 18 tests en `qaap-multi-tenancy-isolation.spec.ts`
2. ~~Test de regresión por cada hallazgo C-1..C-8.~~ ✅ CORREGIDO

---

## 7. Próximo paso

La implementación local de la Opción A está cerrada y probada, pero la aprobación operativa aún requiere una prueba en VPS con dos tenants reales: OAuth, keystore, filesystem allowlist, Git clone/review/worktree, terminal attach, jobs/verificación, preview, WebSocket, redes dedicadas, logs y cancelación concurrente. La prueba local crea backends por tenant, obtiene health 200 y comprueba aislamiento cruzado; eso valida el lifecycle Docker, no sustituye la prueba de producción. El worker por tenant, por sí solo, nunca autoriza una beta pública.

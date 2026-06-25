# Auditoría de Multi-Tenancy — Qaap

> Estado del documento: **auditoría revisada (v2)**
> Alcance: aislamiento por usuario autenticado de todos los recursos persistentes y temporales.
> Veredicto global: **El aislamiento NO es total, pero es mejor de lo que parecía.** Qaap implementa un modelo coherente de **multi-tenancy basado en rutas** (ver §1.1) que aísla workspaces, archivos, repos, conversaciones, tasks, git-review y caches del browser, con tests de seguridad dedicados. Las brechas reales restantes están en recursos a nivel de SO/proceso que viven FUERA del árbol de rutas por usuario: secrets/keystore, terminales, MCP, skills, preferencias y algunos temporales.

---

## 1. Contexto arquitectónico (causa raíz)

Qaap está construido sobre **Eclipse Theia**, un framework de IDE diseñado como **single-tenant**: un usuario del SO por proceso backend. El estado vive en el `$HOME` del backend (`~/.qaap/...`, keystore del SO, preferencias) y en singletons de proceso (`ProcessManager`, managers de MCP, etc.).

Las mitigaciones aplicadas (campos `ownerLogin`, `requireAuth`, y el módulo de aislamiento por rutas) son una capa multi-tenant **encima** de una base single-tenant. Cubren bien la capa de datos/workspace, pero NO los recursos del SO/proceso compartido:

- Los secrets/tokens (Copilot OAuth) viven en una cuenta de keystore global y fija.
- Terminales y procesos viven en un `ProcessManager` singleton de proceso.
- MCP, skills y preferencias se resuelven desde el `$HOME`/preferencias del backend.

**Decisión arquitectónica pendiente**: para cerrar las brechas del SO hay dos caminos (ver §5). La vía más realista con Theia es **aislamiento por contenedor/proceso por usuario**.

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
| Repositorios Git | ✅ | Clonados bajo `users/{login}/...`; acceso validado por `assertWorkspacePathOwned`. |
| Archivos / directorios | ✅ | Acceso validado por `isPathUnderUserWorkspace`. Upload con validación de traversal. |
| Sesiones del agente (tasks) | ✅ | `ownerLogin` persistido + acceso por ruta-bajo-usuario en endpoint. (Pendiente: `task-token` compartido, C-5.) |
| Chats / conversaciones | ✅ | Endpoint aplica `ownsWorkspacePath(ctx, cwd)` en list/get/stream. (`list()` del store filtra por cwd; el control de acceso lo hace el endpoint.) |
| Threads / historial | ✅ | Igual que conversaciones (mismo store/endpoint). |
| Caches del browser | ✅ | `qaapUserScopedStorageKey` por login. |
| Preview | 🟡 | `QaapPreviewShareStore.create` acepta `ownerLogin`; puertos a nivel de workspace. |
| Eventos en tiempo real (SSE/WS) | 🟡 | Conversaciones e inbox filtran por cwd/repos permitidos en el endpoint; revisar el resto de streams. |
| Contenedores / runtimes | ✅ (corregido) | **C-1 corregido**: `containerNameFor` ahora incluye `ownerLogin`. |
| Secrets / tokens | ❌ | `KeyStoreService` con cuenta fija global (`theia-copilot-auth`/`github-copilot`). Fuera del árbol por usuario. |
| Credenciales OAuth (Copilot) | ❌ | Mismo keystore global. Cache en memoria invalidado (FIX-10) pero token subyacente compartido. |
| Terminales | ❌ | `ProcessManager` compartido; canal `${terminalsPath}/:id` permite attach por id sin check de usuario. |
| Procesos | ❌ | `ProcessManager` singleton de proceso, sin partición por usuario. |
| Skills | ❌ | Se cargan de `~/.cursor/skills`, `~/.claude/skills`, etc. (HOME compartido). |
| MCP Servers | 🟡 | Aislamiento parcial por `ConnectionContainerModule` (por conexión); config/env/secrets desde preferencias del backend. |
| Configuración de usuario (preferences) | ❌ | Preferencias Theia por backend/workspace, no por usuario autenticado. |
| Variables de entorno | ❌ | `process.env` del backend compartido. |
| Cache / índices / embeddings | 🟡 | No se detectó store de embeddings dedicado; revisar si se añade en el futuro. |
| Recursos temporales | 🟡 | Worktrees de parallel-run y uploads en `os.tmpdir()` (sin segmento por usuario, C-7). |
| Logs | ❌ | Logs de backend/terminales compartidos. |

> Nota de precisión (v2): la v1 marcaba conversaciones/tasks/archivos como 🟡/❌ por error. El control de acceso por ruta-bajo-usuario en los endpoints SÍ los aísla. El hallazgo C-4 queda **descartado** como fuga.

---

## 3. Hallazgos críticos (con evidencia)

### C-1 · Contenedores compartidos por repo, no por usuario · ✅ CORREGIDO

`packages/qaap-cloud-workspace/src/node/qaap-docker-orchestrator.ts`

Antes el contenedor se nombraba sólo por `repoKey`, de modo que dos usuarios con el mismo repo compartían contenedor, procesos, FS y mounts. **Corregido**: `containerNameFor(repoKey, ownerLogin)` ahora namespaces por usuario (hash de `tenant\0repoKey`), y `QaapCloudOrchestrator.ensure` propaga `ownerLogin` a `ensureContainer`/`stopContainer`.

### C-2 · Secrets/OAuth en keystore global y fijo · ✅ CORREGIDO

`packages/ai-copilot/src/node/copilot-auth-service-impl.ts`

Antes el `keystoreAccount` era fijo (`'github-copilot'`), de modo que el token OAuth de un usuario era legible por otro en el mismo backend. **Corregido**: `setOwnerLogin(login)` se añadió a la interfaz `CopilotAuthService` y su implementación compute `keystoreAccount` como `${baseAccount}:${ownerLogin}`. Una contribución frontend (`QaapCopilotOwnerBinding`) llama `setOwnerLogin` con el login de la sesión Qaap al arrancar, propagándolo via RPC al backend per-conexión. Cada usuario ahora lee/escribe su propio entry del keystore del SO.

### C-3 · Terminales adjuntables por id sin verificación de usuario · ⏸ DIFERIDO A OPCIÓN A

`packages/terminal/src/node/terminal-backend-contribution.ts`

```ts
service.registerChannelHandler(`${terminalsPath}/:id`, (params, channel) => {
    const termProcess = this.processManager.get(parseInt(params.id, 10));
    // ... conecta IO sin comprobar propiedad del terminal
});
```

Cualquier cliente conectado puede adjuntarse a la terminal de otro usuario conociendo/iterando el id numérico.

**Decisión**: Diferido a Opción A (contenedor por usuario). `ShellTerminalServer` y `TerminalBackendContribution` son singletons de core Theia (`terminal-backend-module.ts:58,86`); el `ProcessManager` es compartido y la capa RPC de Theia no transporta la sesión GitHub de Qaap. Un fix en backend compartido requeriría plomear la sesión en la capa de mensajería de core — invasivo y alto riesgo de regresión. El límite de contenedor de Opción A aísla terminales/procesos "gratis".

### C-4 · Persistencia global única para tasks/conversaciones · ❌ DESCARTADO (no es fuga)

`qaap-agent-conversation-store.ts` y `qaap-agent-task-runner.ts` usan un archivo JSON global. **Sin embargo**, el control de acceso lo hace el endpoint con `ownsWorkspacePath(ctx, cwd)` (list/get/stream), y cada `cwd` vive bajo `users/{login}/`. Dos usuarios no comparten cwd, por lo que no hay lectura cruzada. La persistencia física compartida es aceptable mientras el acceso siga validado por ruta. (Defensa en profundidad opcional: filtrar también por `ownerLogin` en el store.)

### C-5 · Token compartido del helper CLI de agentes · ✅ CORREGIDO

`qaap-agent-task-runner.ts`

Antes existía un único token de proceso para el helper `qaap-task`, común a todos los usuarios. **Corregido**: los tokens ahora son por usuario (`helperTokens` map, `helperTokenForOwner`, `resolveHelperTokenOwner`). El endpoint `handleCreate` autentica callbacks del helper CLI por token per-user y scopea sub-tasks al owner del token.

### C-6 · Skills desde HOME compartido · ✅ CORREGIDO

`packages/qaap-ai-config/src/browser/qaap-skill-service.ts`

Los directorios `~/.cursor/skills`, `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills` son del HOME del backend y visibles para todos los usuarios. **Corregido**: `getQaapBuiltinSkillDirectories` ahora añade un path por usuario (`~/.qaap/users/{login}/skills`) usando `readQaapAuthUser()`, de modo que cada usuario tiene sus propios skills además de los del sistema.

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

### Opción A — Aislamiento por contenedor/proceso por usuario (recomendado)

Cada usuario autenticado obtiene su propio backend/contenedor con `$HOME`, keystore, preferencias, MCP, skills, terminales y procesos propios. El límite del SO/contenedor da el aislamiento "gratis".
- **Cambio clave**: el orchestrator debe clavar contenedores por `ownerLogin (+ repoKey)`, no por `repoKey`.
- **Ventaja**: resuelve de un golpe C-1..C-7 sin reescribir Theia.
- **Coste**: infra (un proceso/contenedor por usuario, routing por sesión, ciclo de vida).

### Opción B — Backend compartido tenant-aware

Refactor de cada servicio core para ser `userId`-scoped: keystore, MCP manager, skills, preferences, `ProcessManager`, language models, embeddings.
- **Ventaja**: densidad (un backend, muchos usuarios).
- **Coste**: muy alto, va contra el diseño de Theia, alto riesgo de regresión y de fugas residuales.

### Opción C — Híbrido

Backend compartido para la orquestación/cloud (ya con `ownerLogin`) + contenedor por usuario para ejecución de agentes, terminales, archivos y procesos. Definir frontera explícita.

---

## 6. Plan priorizado (independiente del modelo elegido)

### P0 — Bloqueantes de seguridad

1. ~~**C-2 secrets**: derivar la cuenta de keystore por usuario~~ ✅ CORREGIDO
2. **C-3 terminales**: asociar cada terminal a una sesión/usuario y verificar propiedad en `attach`/canal `:id`. ⏸ DIFERIDO a Opción A
3. ~~**C-1 contenedores**: incluir `ownerLogin` en `containerNameFor`~~ ✅ CORREGIDO

### P1 — Aislamiento de datos

1. **C-4 persistencia**: ❌ DESCARTADO (no es fuga, ver §3).
2. ~~**C-5 task-token**: token por usuario~~ ✅ CORREGIDO
3. ~~**C-7 temporales**: segmentar `os.tmpdir()` por usuario~~ ✅ CORREGIDO

### P2 — Configuración y capacidades

1. ~~**C-6 skills** y MCP/preferences~~: skills por usuario ✅ CORREGIDO. MCP runtime aislado per-conexión; config de preferencias compartida → defer a Opción A (mismo patrón que C-3).
2. ~~**Eventos en tiempo real**: verificación de destinatario en todos los streams SSE/WS~~ ✅ CORREGIDO. SSE y WS de tasks y conversations ya filtraban por `ownsWorkspacePath`; fix: WS `cancel` ahora verifica ownership antes de cancelar; SSE/WS de conversations ahora usa `eventIsOwned` que cubre `created`/`updated` (cwd dentro de `conversation`) además de eventos con cwd top-level.

### P3 — Validación

1. Test de aislamiento con **dos usuarios concurrentes**: no comparten workspaces, archivos, terminales, conversaciones, secrets ni eventos.
2. Test de regresión por cada hallazgo C-1..C-7.

---

## 7. Próximo paso

Elegir el modelo de despliegue (§5). La recomendación es **Opción A** por coste/beneficio con Theia. Una vez elegido, se ejecuta el plan §6 empezando por P0.

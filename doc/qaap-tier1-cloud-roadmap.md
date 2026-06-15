# Qaap tier 1 cloud — roadmap de issues

Issues listos para GitHub (`juancristobalgd1/qaap`). El remoto tiene **Issues deshabilitados**; habilítalos en *Settings → General → Features* o usa este doc como backlog hasta entonces.

**Secuencia:** Fase 0 → 1 → 2 → 3 (triggers + evidencia) → 4.

---

## Issue 1 — Fase 0: Deploy checklist VPS

**Título:** `Fase 0: Deploy checklist VPS — health endpoint + script de verificación`

**Labels:** `enhancement`, `cloud`, `tier-1`

### Contexto

Prerrequisito operativo: un deploy en VPS debe validarse en minutos sin adivinar si `qaiq`/`codex` están en PATH y si el runner responde.

**Estado actual:** `doc/qaap-vps-deployment.md` documenta logs `[qaap-agent-tasks] detected agents` y `GET /qaap/api/agent-tasks/all`; falta health formal y checklist automatizable.

### Alcance

#### 1. Endpoint de health

`GET /qaap/api/health` (alternativa aceptable: `/qaap/api/agent-tasks/health`).

Respuesta mínima:

```json
{
  "ok": true,
  "uptimeMs": 12345,
  "agentConfigured": true,
  "agents": ["qaiq", "codex"],
  "defaultAgent": "qaiq"
}
```

**Archivos:**

| Archivo | Cambio |
|---------|--------|
| `packages/qaap-cloud-workspace/src/node/qaap-agent-task-endpoint.ts` | Registrar ruta GET |
| `packages/qaap-cloud-workspace/src/node/qaap-agent-task-runner.ts` | Snapshot: `listAgents()`, `isAgentConfigured()`, `defaultAgent()`, uptime |
| `packages/qaap-cloud-workspace/src/common/qaap-agent-task.ts` | Tipo `QaapHealthResponse` (si aplica) |
| `doc/qaap-vps-deployment.md` | Sección “Verify health” |

#### 2. Script post-deploy

Nuevo `scripts/qaap-vps-verify.sh` — exit ≠ 0 si:

- `docker compose exec theia qaiq --version` falla (o `codex` cuando sea el agente por defecto)
- `curl -sf http://127.0.0.1:${THEIA_PORT}/qaap/api/health` no devuelve `ok: true` con `agents.length >= 1`
- opcional: log contiene `[qaap-agent-tasks] detected agents`

**Archivos:** `scripts/qaap-vps-verify.sh`, `doc/qaap-vps-deployment.md`

### Criterios de aceptación

- [x] Tras `docker compose up -d`, `scripts/qaap-vps-verify.sh` termina con código 0 en VPS limpio con `.env` válido
- [x] Sin `qaiq` en PATH: health refleja `agents: []` y el script falla con mensaje accionable
- [x] Doc con ejemplo `curl` al health endpoint
- [x] `npx lerna run compile --scope @theia/qaap-cloud-workspace` verde

### Fuera de alcance

Monitoreo externo; health de OAuth/GitHub.

---

## Issue 2 — Fase 1: Onboarding solo-repo (cloud)

**Título:** `Fase 1: Onboarding cloud — "Add repository" como único camino`

**Labels:** `enhancement`, `cloud`, `tier-1`, `work-hub`

**Depende de:** Issue 1 (recomendado, no bloqueante)

### Contexto

Work Hub ya promueve “Add repository”. En cloud no debe existir camino “Open Folder” / workspace local.

**Ya hecho:**

- `packages/qaap-product/src/browser/qaap-plugin-view-welcome-policy.ts` — oculta welcome “Open Folder” del explorer
- `packages/qaap-mobile-shell/src/browser/mobile-projects-home-ui.ts` — CTA “Add repository”
- `packages/qaap-mobile-shell/src/browser/mobile-open-repository-dialog.ts` — flujo GitHub

**Fugas:**

- `packages/qaap-product/src/browser/qaap-getting-started-widget.tsx` — “Open Folder” / “Open Workspace” en browser
- `packages/qaap-mobile-shell/src/browser/mobile-projects-project-navigation-ui.ts` — fallback `WorkspaceCommands.OPEN_FOLDER` si proyecto sin `github`/`uri`
- `packages/navigator/src/browser/navigator-widget.tsx` — botón “Open Folder” en workspace vacío (upstream; ocultar vía contribution/CSS en cloud o rebind en `qaap-mobile-shell`)

### Alcance

1. **Detección cloud:** helper reutilizable (p. ej. `isQaapCloudOnboarding()` basado en `QAAP_CLOUD_MODE`, sesión GitHub OAuth, o flag de producto en `@theia/qaap-cloud-workspace`).
2. **Getting started:** en cloud, sustituir acciones Open/Open Folder por “Add repository” (mismo comando que Work Hub).
3. **Navigator vacío:** no mostrar “Open Folder”; CTA “Add repository”.
4. **Project navigation:** proyectos sin repo → abrir diálogo Add repository, nunca `OPEN_FOLDER`.
5. **Regresión Work Hub reload:** no persistir preferencia IDE clásico (`.cursor/rules/work-hub-reload-default.mdc`).

**Archivos clave:**

| Archivo | Cambio |
|---------|--------|
| `packages/qaap-cloud-workspace/src/common/` (nuevo helper) | `isQaapCloudSession()` o similar |
| `packages/qaap-product/src/browser/qaap-getting-started-widget.tsx` | Ramificar UI Start en cloud |
| `packages/qaap-mobile-shell/src/browser/mobile-projects-project-navigation-ui.ts` | Eliminar fallback OPEN_FOLDER |
| `packages/qaap-mobile-shell/src/browser/mobile-projects-hub-list-chrome-ui.ts` | Verificar único CTA |
| `packages/qaap-product-theme/src/browser/style/` | Ocultar open-folder en cloud si hace falta CSS |
| `packages/qaap-mobile-shell/src/browser/mobile-onboarding-tutorial-contribution.ts` | Tutorial alineado solo-repo |

### Criterios de aceptación

- [x] Usuario nuevo OAuth → solo ve “Add repository” / crear repo; no “Open Folder” en viewport ≤767px ni desktop cloud
- [x] Proyecto local sin GitHub no abre file picker de carpeta
- [ ] F5 tras “Open IDE” vuelve a Work Hub (regresión manual)
- [ ] `npx lerna run test --scope @theia/qaap-mobile-shell` verde
- [ ] Playwright `@qaap-mobile` sin regresión en flujo repo GitHub existente

### Fuera de alcance

Importar repos no-GitHub; multi-root workspace.

---

## Issue 3 — Fase 2: Mission Control como pilar

**Título:** `Fase 2: Mission Control — de prototipo a home del Work Hub`

**Labels:** `enhancement`, `work-hub`, `tier-1`

**Depende de:** Issue 2 (recomendado)

### Contexto

`mobile-work-mission-control.ts` declara explícitamente **prototype**: lanes `needs-you` / `running` / `done`, filtros chat/task/pr, datos de `MobileProjectsConversations` + active tasks — **sin nueva fuente**.

Gap: no es landing por defecto; tabs legacy duplican la misma información.

### Alcance

1. **Landing por defecto:** Work Hub abre Mission Control (no tab Chat primero).
2. **Acciones por lane** (un tap):
   - `needs-you` + approval pendiente → sheet de política / aprobar tool
   - `running` → abrir transcript en streaming
   - `done` + PR → panel PR; sin PR → diff-review
3. **Feed unificado:** opcionalmente enriquecer con `GET /qaap/api/agent-tasks/all` para tareas sin conversación vinculada.
4. **De-duplicar tabs:** Chat / Tasks / Review como filtros (`MissionControlSurfaceFilter`), no tres destinos obligatorios.
5. **Polish visual:** caps por lane (`LANE_CAP`), empty states, touch scroll (`.cursor/rules/mobile-touch-accessibility.mdc`).

**Archivos:**

| Archivo | Cambio |
|---------|--------|
| `packages/qaap-mobile-shell/src/browser/mobile-work-mission-control.ts` | Acciones, caps, integración tasks/all |
| `packages/qaap-mobile-shell/src/browser/style/qaap-work-mission-control.css` | Polish + scroll táctil |
| `packages/qaap-mobile-shell/src/browser/mobile-vertical-touch-scroll.ts` | Registrar selectores MC si hay listas nuevas |
| `packages/qaap-mobile-shell/src/browser/mobile-projects-home-ui.ts` | MC como sección principal |
| `packages/qaap-mobile-shell/src/browser/mobile-one-column-shell-contribution.ts` | Tab/surface por defecto |
| `packages/qaap-mobile-shell/src/browser/mobile-work-mission-control.spec.ts` | Tests acciones + filtros |
| `packages/qaap-mobile-shell/src/common/qaap-agent-task-client.ts` | Cliente `fetchAgentTasksAll()` si falta |

### Criterios de aceptación

- [x] Abrir workspace → Mission Control visible sin navegar tabs (preview en Home; vista completa en pestaña Work/Agents)
- [x] Item `needs-you` con approval abre flujo de aprobación existente (transcript con inline approval)
- [x] Item con `linkedPullRequest` abre pestaña Review
- [ ] Lista larga en ≤767px: scroll táctil funcional (manual + grep test touch-scroll)
- [x] Tests unitarios MC verdes

### Fuera de alcance

Nuevo backend de “missions”; paridad total con Cursor Mission Control desktop.

---

## Issue 4 — Fase 3a: Triggers GitHub `@qaap`

**Título:** `Fase 3a: GitHub triggers — @qaap en issue/PR (estilo @cursor / label jules)`

**Labels:** `enhancement`, `github`, `tier-1`

**Depende de:** Issue 1

### Contexto

`qaap-github-inbox-endpoint.ts` procesa webhooks **`pull_request`** → inbox SSE. No hay `issue_comment` ni disparo de agent tasks.

### Alcance

1. **Webhook ampliado:** `issue_comment`, `issues` (opened/edited) con filtro:
   - body contiene `@qaap` (case-insensitive), **o**
   - label `qaap` / `jules`-style configurable (`QAAP_GITHUB_TRIGGER_LABEL`)
2. **Resolver repo → cwd:** mapear `owner/repo` a proyecto Qaap / path en `/workspace` vía sesión GitHub + `MobileProjectsService` logic (extraer helper compartido node-side).
3. **Crear tarea:** `POST` interno al runner (`QaapAgentTaskRunner.createTask`) con prompt del comment (strip mention) y agent por defecto.
4. **Ack en GitHub:** comentario “Qaap started task …” + link a Work Hub (URL pública `QAAP_OAUTH_PUBLIC_URL`).
5. **Config:** `QAAP_GITHUB_WEBHOOK_SECRET` (ya documentado en `qaap-github-oauth-config.ts`).

**Archivos:**

| Archivo | Cambio |
|---------|--------|
| `packages/qaap-mobile-shell/src/node/qaap-github-inbox-endpoint.ts` | Handlers issue_comment/issues |
| `packages/qaap-mobile-shell/src/node/qaap-github-inbox-hub.ts` | Evento `agent-triggered` (opcional SSE) |
| `packages/qaap-mobile-shell/src/node/qaap-github-api.ts` | `postIssueComment()` |
| `packages/qaap-cloud-workspace/src/node/qaap-agent-task-runner.ts` | API estable para trigger externo |
| `doc/qaap-vps-deployment.md` o nuevo `doc/qaap-github-triggers.md` | Config webhook GitHub App |

### Criterios de aceptación

- [ ] Comment `@qaap fix the flaky test` en issue abre tarea en VPS y responde en GitHub en <30s
- [ ] PR sin `@qaap` no dispara tarea (salvo label si está configurado)
- [ ] Webhook sin firma válida → 401
- [ ] Repo no vinculado en Qaap → comentario explicativo, no crash

### Fuera de alcance

GitHub App marketplace; billing; múltiples agentes por mention.

---

## Issue 5 — Fase 3b: Evidencia en PR al terminar

**Título:** `Fase 3b: Evidencia en PR — comentario con resumen + screenshot al completar agente`

**Labels:** `enhancement`, `github`, `tier-1`

**Depende de:** Issue 4 (recomendado); Issue 3 (UX para ver diff)

### Contexto

Transcript ya tiene artifacts (`mobile-projects-transcript-messages-artifacts-ui.ts`), diff, verification. Preview tiene `take-screenshot` (`qaap-preview-overflow-actions.ts`). Falta **handoff automático al PR/issue de GitHub**.

### Alcance

1. **Al `completed`/`failed` de tarea** originada por trigger (Issue 4) o con `linkedPullRequest` / issue number en metadata:
   - Post comment Markdown: resumen último turno agente, +/- líneas si disponibles, link `QAAP_OAUTH_PUBLIC_URL` → conversación/diff-review
2. **Screenshot opcional:** si preview same-origin activo durante la tarea, adjuntar imagen al comment (GitHub asset API) o link a screenshot servido por Qaap
3. **Metadata en tarea:** `sourceIssue` / `sourcePullRequest` en `QaapAgentTask` o conversation DTO
4. **No spam:** un comment por tarea; idempotencia por `task.id`

**Archivos:**

| Archivo | Cambio |
|---------|--------|
| `packages/qaap-cloud-workspace/src/node/qaap-agent-task-runner.ts` | Hook `notifyCompletion` → PR evidence |
| `packages/qaap-cloud-workspace/src/common/qaap-agent-task.ts` | Campos source issue/PR |
| `packages/qaap-mobile-shell/src/node/qaap-github-api.ts` | Comment + upload asset |
| `packages/qaap-adapters/src/browser/qaap-preview-overflow-actions.ts` | Export captura para backend o snapshot path |
| `packages/qaap-cloud-workspace/src/node/qaap-agent-conversation-store.ts` | Resumen exportable para comment |

### Criterios de aceptación

- [ ] Tarea disparada desde issue recibe comment al terminar con resumen legible y link a Qaap
- [ ] Tarea fallida incluye últimas líneas del log (truncado)
- [ ] Segundo webhook/retry no duplica comment (mismo `task.id`)
- [ ] Sin PR/issue vinculado: comportamiento actual (solo push in-app) sin regresión

### Fuera de alcance

Checks CI en GitHub; review threads inline por línea.

---

## Issue 6 — Fase 4: Notificaciones nivel “Live Activity” (web)

**Título:** `Fase 4: Web Push rico + deep links (pre-Live Activities nativas)`

**Labels:** `enhancement`, `notifications`, `tier-1`

**Depende de:** Issue 3 (Mission Control como destino del deep link)

### Contexto

Web Push operativo: `QaapWebPushService`, subscribe en frontend, `notifyCompletion` en runner con payload genérico (`route: 'diff-review'`). In-tab: `QaapPushNotificationContribution`.

iOS Live Activities requieren app nativa — **fuera de alcance**.

### Alcance

1. **Payload rico** en `notifyCompletion` y eventos approval:
   - `projectName`, `agentId`, `conversationId`, `taskId`, `linesAdded`/`linesRemoved`, `needsApproval: boolean`
2. **Deep link:** service worker `notificationclick` abre ruta exacta (`/…#conversation=…` o query que Work Hub entienda)
3. **Mission Control badge:** contador `needs-you` sincronizado con push `tag`
4. **Permiso UX:** prompt tras primer repo abierto (no al boot)

**Archivos:**

| Archivo | Cambio |
|---------|--------|
| `packages/qaap-cloud-workspace/src/node/qaap-web-push-service.ts` | Schema payload extendido |
| `packages/qaap-cloud-workspace/src/node/qaap-agent-task-runner.ts` | Payload rico en `notifyCompletion` |
| `packages/qaap-cloud-workspace/src/common/qaap-cloud-api-types.ts` | Tipos push |
| `dev-packages/application-manager/src/generator/frontend-generator.ts` | SW `notificationclick` handler |
| `packages/qaap-mobile-shell/src/browser/qaap-push-notification-contribution.ts` | Alinear con payload |
| `packages/qaap-cloud-workspace/src/browser/qaap-web-push-contribution.ts` | Deep link routing |

### Criterios de aceptación

- [ ] Tab en background: push muestra proyecto + agente + “needs approval” cuando aplica
- [ ] Click en notificación abre conversación correcta en Work Hub
- [ ] Sin VAPID keys: degradación silenciosa (comportamiento actual)
- [ ] `.env.docker.example` documenta VAPID

### Fuera de alcance

Live Activities iOS; push actions “Approve” en notification (limitación web).

---

## Crear issues en GitHub

Cuando Issues esté habilitado en el fork:

```bash
# Habilitar: GitHub → juancristobalgd1/qaap → Settings → General → Issues

scripts/qaap-ensure-gh-default.sh   # opcional: fijar repo default

# Ejemplo (repetir por issue, body desde secciones de arriba):
gh issue create --repo juancristobalgd1/qaap \
  --title "Fase 0: Deploy checklist VPS — health endpoint + script de verificación" \
  --label "enhancement" \
  --body-file doc/issues/fase-0-body.md
```

O pegar cada sección de este doc como cuerpo del issue.

## Verificación transversal (cualquier fase)

```bash
npm run compile
node scripts/qaap-drift-check.js
npx lerna run test --scope @theia/qaap-mobile-shell
npx lerna run test --scope @theia/qaap-cloud-workspace
# UI: npm run build:browser && npm run start:browser
```

## Composer envía tareas al proyecto activo (Mockup) ignorando cwd de la URL

**Prioridad:** Alta  
**Labels sugeridos:** `bug`, `agent`, `work-hub`, `priority:high`, `qa`  
**Estado:** Fix en `packages/qaap-mobile-shell` (2026-06-23)

### Causa raíz

`isBrowsableHubProject()` excluye workspaces fuera de `~/.qaap/workspaces/{owner}/{repo}` (p. ej. `/tmp/qaap-ui-ws-*`). El composer caía en `resolveHomePinnedProject()` → `projects[0]` (Mockup).

### Fix

- `MobileProjectsService.resolveCurrentWorkspaceProject()` — match por cwd + entrada efímera para workspace abierto
- `resolveHomePinnedProject`, `resolveAgentsHubShellProject`, `resolveStickyComposerProject` — usan workspace actual
- `ensureInlineComposerCwd` — guard si el project card no coincide con el workspace abierto

### Descripción

Al abrir un workspace vacío vía hash (`/#/var/folders/.../qaap-ui-ws-XXX`) y enviar un prompt desde el sticky composer, la tarea se ejecuta en el **proyecto previamente activo** (p. ej. Mockup) en lugar del cwd de la URL. El workspace temporal queda vacío y la conversación no aparece en su API.

### Pasos para reproducir

1. Arrancar la app: `PATH="/tmp/qaiq-mock-bin:$PATH" npm run start:browser`
2. Crear directorio vacío: `mktemp -d /tmp/qaap-ui-ws-XXXX`
3. Navegar a `http://localhost:3000/#/<ruta-del-temp-dir>` (viewport móvil ≤767px recomendado)
4. Saltar tutorial si aparece
5. En el composer, enviar:
   > Crea una landing page moderna para vinos Rioja, responsive, con hero, productos destacados, sección de historia, formulario de contacto y diseño premium.
6. Observar header del transcript y API

### Resultado esperado

- Header: título acotado al workspace temporal (no «Mockup · …»)
- `GET /qaap/api/agent-conversations?cwd=<temp-dir>` → conversación con `status: idle` o `streaming`
- Archivos creados bajo `<temp-dir>/`

### Resultado actual

- UI muestra **«Mockup · Crea una landing page…»** y badge **Failed**
- `GET /qaap/api/agent-conversations?cwd=<temp-dir>` → `{ "conversations": [] }`
- Directorio temporal sigue vacío
- Mensaje: *«We could not finish this task…»*

### Evidencia (2026-06-23)

```
test-results/qaap-qa-ui-flow/report.json
  composerProjectLabel: ""
  uiDuringAgent.bodyText: "Mockup · Crea una landing page..."
  conversation.ok: false
  files: todos false
```

Screenshots: `test-results/qaap-qa-ui-flow/03-agent-progress.png`, `04-agent-done.png`

### Contraste (API directa — funciona)

El mismo prompt vía `POST /qaap/api/agent-conversations` con `cwd` explícito sí crea archivos (`qaap-rioja-e2e-eval.mjs`, 66 s total).

### Áreas sospechosas

- `packages/qaap-mobile-shell/src/browser/mobile-projects-background-task-ui.ts` — `ensureInlineComposerCwd`, `createProjectChatSession`
- `packages/qaap-mobile-shell/src/browser/mobile-projects-sticky-composer-workspace-ui.ts` — selección de proyecto activo vs hash
- `packages/qaap-mobile-shell/src/browser/mobile-projects-service.ts` — `getProjectCwd`, `prepareProjectCwd`

### Criterios de aceptación

- [ ] Prompt enviado desde composer usa el cwd del workspace abierto en la URL/hash
- [ ] Proyecto mostrado en el selector del composer coincide con ese cwd
- [ ] Test E2E Playwright del flujo **composer UI** (no solo API) en CI
- [ ] Sin regresión: proyecto Mockup existente sigue funcionando al seleccionarlo explícitamente

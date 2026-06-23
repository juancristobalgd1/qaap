## «Approve for me» no auto-aprueba Bash — agente se detiene en install/run

**Prioridad:** Alta  
**Labels sugeridos:** `bug`, `agent`, `qaiq`, `priority:high`, `qa`

**Estado:** Fix en `packages/qaap-mobile-shell` + `packages/qaap-cloud-workspace` (2026-06-23)

### Causa raíz

1. `DEFAULT_APPROVE_FOR_ME_TOOL_RULES.shell` era `false` → QAIQ no incluía `Bash` en `--allowed-tools`.
2. El sticky composer **no pasaba** `toolApprovalRules` a `createConversation`, ignorando toggles del sheet.

### Fix

- Default `shell: true` para «Approve for me» (install/git/run rutinarios).
- Propagación de `toolApprovalRules` desde composer → `createConversation` → task runner.
- Fallback `reconcileAgentToolApprovalRules()` al crear conversación si no vienen reglas explícitas.

### Descripción

Con política de aprobación **«Approve for me»** (`approvalPolicyId: approve-for-me`) en UI y API, el agente QAIQ ejecuta lecturas/búsquedas pero **se detiene** al invocar Bash (`pnpm install`, `npm run dev`) indicando que necesita aprobación manual de shell.

### Pasos para reproducir

1. Abrir proyecto Mockup: `http://localhost:3000/#/Users/jc/.qaap/workspaces/.../Mockup`
2. Verificar composer: **Approval policy: Approve for me**
3. Enviar (o abrir conversación existente):
   > Figure out how to build and run this project locally. Start the dev server, confirm it boots cleanly, and report the URL plus any setup steps I should know.
4. Observar Agent Trace y respuesta final

### Resultado esperado

- `pnpm install` y `pnpm dev` (o equivalente) se ejecutan sin prompt adicional
- Agente reporta URL de preview (p. ej. `:5173`)
- Conversación termina en `idle`, no `failed`

### Resultado actual

- Trace muestra: Read package.json → Search → **Ran pnpm install** → Thinking: *«The Bash tool requires user approval»*
- Respuesta final: instrucciones manuales al usuario (*«You'll need to approve shell access»*)
- API: conversación `0c632d81-…` con `status: failed`, `approvalPolicyId: approve-for-me`
- Preview no se levanta automáticamente

### Evidencia

- Browser snapshot 2026-06-23 en sesión Mockup (transcript visible en QA manual)
- `curl …/agent-conversations/0c632d81-7c84-4113-9d8d-3ef7b1b76709` → `status: failed`

### Área sospechosa

En `packages/qaap-cloud-workspace/src/node/qaap-agent-task-runner.ts`, `buildAgentCommand`:

```typescript
approvalPolicyId: approvalPolicyId === 'approve-for-me'
    ? undefined   // ← se anula la policy en flags QAIQ
    : approvalPolicyId,
autoApprove: autoApprove ? true : false,
```

Comparar con E2E que **sí funciona** cuando se envía `approvalPolicyId: 'full-access'` (`qaap-rioja-e2e-eval.mjs`).

### Criterios de aceptación

- [ ] `approve-for-me` en UI ≡ auto-ejecución de Bash/Write para el agente seleccionado
- [ ] Documentar mapping UI → runner → flags CLI QAIQ
- [ ] Test: prompt «run dev» con `approve-for-me` levanta servidor sin intervención
- [ ] Sin regresión de políticas más restrictivas (`ask-every-time`, etc.)

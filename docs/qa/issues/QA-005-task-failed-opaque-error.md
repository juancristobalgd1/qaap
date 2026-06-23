## «Task failed» sin causa, herramienta fallida ni acción de retry

**Prioridad:** Alta  
**Labels sugeridos:** `bug`, `ux`, `agent`, `priority:high`, `qa`

### Descripción

Cuando una tarea agente falla, la UI muestra únicamente:

> **Task failed** — We could not finish this task. Edit your prompt, switch model or agent, or send a follow-up.

No indica **qué herramienta falló**, **stderr**, **código de salida**, **timeout**, ni ofrece **Retry** o **Approve now**. El usuario queda a ciegas.

### Pasos para reproducir

1. Reproducir QA-001 (composer en workspace vacío + prompt Rioja)
2. Esperar ~2 min
3. Observar transcript

Alternativa: abrir conversación API con `status: failed` (p. ej. `0c632d81-…` en Mockup).

### Resultado esperado

- Mensaje con: herramienta (`Bash`, `Write`, …), error resumido, enlace a log/terminal
- Botones: **Retry**, **Approve shell**, **Switch model**
- Badge Failed alineado con estado real (no Failed + Active now)

### Resultado actual

- Copy genérico sin detalle técnico
- Badges contradictorios: **Failed** + **Active now**
- Sidebar acumula decenas de tareas con icono de error sin explicación

### Evidencia

- `test-results/qaap-qa-ui-flow/04-agent-done.png`
- Desktop home: sidebar Mockup con múltiples ⚠️/❌ (`test-results/qaap-qa-manual/desktop-home.png`)

### Criterios de aceptación

- [ ] Todo `status: failed` persiste `failureReason` / último segmento tool con `is_error: true`
- [ ] UI renderiza causa en ≤2 líneas + «Show details»
- [ ] Acciones contextuales (retry, approve, open terminal)
- [ ] Un solo badge de estado coherente en header transcript

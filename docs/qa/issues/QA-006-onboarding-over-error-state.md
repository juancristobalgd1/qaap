## Tutorial onboarding (1/5) aparece encima de tarea fallida activa

**Prioridad:** Media  
**Labels sugeridos:** `bug`, `ux`, `mobile`, `priority:medium`, `qa`

### Descripción

En viewport móvil, el tutorial «Swipe → for projects» (paso 1/5) se muestra **encima** de un transcript con **Task failed**, ocultando el error y bloqueando acciones inmediatas.

### Pasos para reproducir

1. Viewport 375×812, sesión fresca o `sessionStorage` limpio
2. Provocar fallo de tarea (QA-001) o abrir transcript Failed
3. Observar overlay tutorial

### Resultado esperado

- No mostrar onboarding si hay conversación activa/fallida reciente
- O posponer tutorial al primer arranque **sin** tarea en curso

### Resultado actual

- Modal 1/5 sobre estado Failed (`test-results/qaap-qa-ui-flow/04-agent-done.png`)

### Criterios de aceptación

- [ ] Tutorial no aparece cuando `transcript` visible con error o streaming
- [ ] «Skip» persiste en sessionStorage; no reaparece en la misma sesión
- [ ] Test Playwright móvil asserta ausencia de tutorial tras enviar prompt

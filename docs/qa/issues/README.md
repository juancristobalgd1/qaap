# Issues QA — flujo agente «proyecto nuevo → landing → preview»

Generados tras la evaluación QA del 2026-06-23. El repositorio `juancristobalgd1/qaap` tiene **Issues deshabilitados** en GitHub; estos archivos están listos para copiar/pegar o importar cuando se activen.

## Fix aplicado (branch local)

- **QA-001** — `resolveCurrentWorkspaceProject()` + composer cwd guard (`packages/qaap-mobile-shell`, 2026-06-23)
- **QA-002** — default shell auto-approve + `toolApprovalRules` en createConversation (`qaap-mobile-shell` + `qaap-cloud-workspace`, 2026-06-23)
- **QA-003** — replay de `traceEvents`/`segments` cuando el turno solo tenía placeholder `…` (`qaap-cloud-workspace`, 2026-08-17)
- **QA-004** — retry de bootstrap preview si el primer kickoff corrió antes de que existieran archivos (`qaap-mobile-shell`, 2026-08-17)
- **QA-005** — el diálogo Task failed usa `resolveAgentTurnFailureMessage` + herramienta fallida; `status: failed` ya no muestra chrome «working» (`qaap-mobile-shell`, 2026-08-17)
- **QA-006** — el tutorial no se abre encima de un transcript visible; el watch de dismiss pasa a 400 ms (`qaap-mobile-shell`, 2026-08-17)
- **QA-007** — `pointer-events` en el título del transcript + z-index del top bar en IDE desktop (`qaap-mobile-shell`, 2026-08-17)

## Cómo abrirlos en GitHub

1. Settings → General → Features → **Issues** → Enable.
2. Por cada archivo:

```sh
gh issue create --title "Título del issue" --body-file docs/qa/issues/QA-001-composer-cwd-routing.md --label "bug,priority:high,qa"
```

## Índice (prioridad)

| ID | Título | Prioridad |
|----|--------|-----------|
| [QA-001](./QA-001-composer-cwd-routing.md) | Composer envía tareas al proyecto activo (Mockup) ignorando cwd de la URL | **Alta** |
| [QA-002](./QA-002-approve-for-me-bash-blocked.md) | «Approve for me» no auto-aprueba Bash / shell | **Alta** |
| [QA-003](./QA-003-agent-trace-empty-api.md) | Agent Trace y API devuelven contenido/segmentos vacíos | **Alta** |
| [QA-004](./QA-004-preview-bootstrap-slow.md) | Preview tarda >50 s y requiere fallback manual de dev server | **Alta** |
| [QA-005](./QA-005-task-failed-opaque-error.md) | «Task failed» sin causa, herramienta ni retry | **Alta** |
| [QA-006](./QA-006-onboarding-over-error-state.md) | Tutorial 1/5 aparece encima de tarea fallida | Media |
| [QA-007](./QA-007-nav-click-intercepted.md) | «Back to Work Hub» bloqueado por overlay del transcript | Media |

## Evidencia compartida

- E2E mock (pasa vía API): `test-results/qaap-rioja-e2e/report.json`
- Flujo UI real (falla): `test-results/qaap-qa-ui-flow/report.json`
- Screenshots: `test-results/qaap-rioja-e2e/*.png`, `test-results/qaap-qa-ui-flow/*.png`
- Script repro UI: `examples/playwright/scripts/qaap-rioja-ui-flow-eval.mjs` (gate P0 composer)
- Script repro API: `examples/playwright/scripts/qaap-rioja-e2e-eval.mjs`
- CI: `.github/workflows/qaap-rioja-agent-e2e.yml`
- Local: `scripts/qaap-run-rioja-agent-e2e.sh`

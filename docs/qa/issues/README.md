# Issues QA — flujo agente «proyecto nuevo → landing → preview»

Generados tras la evaluación QA del 2026-06-23. El repositorio `juancristobalgd1/qaap` tiene **Issues deshabilitados** en GitHub; estos archivos están listos para copiar/pegar o importar cuando se activen.

## Fix aplicado (2026-06-23)

| ID | Resumen | Gate E2E |
|----|---------|----------|
| QA-001 | Composer cwd desde URL del workspace | `composerRouting` |
| QA-002 | Shell auto-approve headless + `toolApprovalRules` | mock bash en UI/API |
| QA-003 | Trace/segments en API tras fallo | `toolTrace` |
| QA-004 | Preview <15 s sin fallback manual | `previewPromptMs` ~5.8 s |
| QA-005 | Errores accionables + sin falsos failed en Glob | `notFailedUi` |
| QA-006 | Tutorial no sobre transcript activo/fallido | `tutorial` |
| QA-007 | `pointer-events` en título + probe back nav | `backToWorkHub` |

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

- UI composer gate: `test-results/qaap-rioja-ui-flow/report.json`
- API + preview gate: `test-results/qaap-rioja-e2e/report.json`
- Real QAIQ smoke (opcional): `test-results/qaap-rioja-real-qaiq/report.json`
- Scripts: `examples/playwright/scripts/qaap-rioja-ui-flow-eval.mjs`, `qaap-rioja-e2e-eval.mjs`, `qaap-rioja-real-qaiq-eval.mjs`
- CI: `.github/workflows/qaap-rioja-agent-e2e.yml`
- Local: `scripts/qaap-run-rioja-agent-e2e.sh`

## Real QAIQ (no mock)

Requisitos: servidor **sin** `mock-qaiq-bin` en PATH y API key del proveedor (p. ej. `OPENROUTER_API_KEY`).

```sh
# Terminal 1 — raíz del repo (exporta tu key antes de arrancar)
export OPENROUTER_API_KEY=sk-or-...
npm run start:browser

# Comprueba en el log del backend:
# [qaap-agent-tasks] qaiq: 0.15.0-qaap.1 (QAIQ)   ← real, no mock

# Terminal 2
cd examples/playwright
QAAP_REAL_QAIQ=1 npm run rioja-real-qaiq-eval

# Modelo opcional (default: openrouter/nvidia/nemotron-3-super-120b-a12b:free)
QAAP_REAL_QAIQ_MODEL=openrouter/anthropic/claude-sonnet-4 QAAP_REAL_QAIQ=1 npm run rioja-real-qaiq-eval
```

Reporte: `test-results/qaap-rioja-real-qaiq/report.json`

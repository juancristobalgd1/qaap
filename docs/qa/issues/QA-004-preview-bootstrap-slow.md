## Preview tarda >50 s y requiere spawn manual del dev server

**Prioridad:** Alta  
**Labels sugeridos:** `bug`, `preview`, `agent`, `priority:high`, `qa`

### Descripción

Tras generar un proyecto Vite, el camino «Run app» / «levanta la app» **no levanta preview de forma fiable**. El bootstrap frontend tarda **~51 s** y el script E2E debe hacer **fallback** spawnando `npm run dev` fuera del flujo del agente.

### Pasos para reproducir

1. Ejecutar E2E: `node examples/playwright/scripts/qaap-rioja-e2e-eval.mjs`
2. Revisar `test-results/qaap-rioja-e2e/report.json`:
   - `phases.previewPromptMs` ≈ 51528
   - `previewBootstrap.steps` incluye `dev-server-fallback-ready`
3. En Mockup (agente real): enviar «levanta la app» → agente no deja preview en iframe

### Resultado esperado

- Agente o bootstrap banner ejecuta `npm run dev` / `pnpm dev` en `<appRoot>`
- Probe `/qaap-dev/api/probe/5173` → `ready: true` en **<15 s**
- Tab Preview muestra iframe con landing sin intervención manual

### Resultado actual

- `previewPromptMs: 51528` (E2E)
- Fallback Playwright: `spawn('npm', ['run', 'dev'])` en workspace
- UI: `probe: true` pero `iframe: false` en flujo composer fallido
- Mockup: conversación «levanta la app» termina buscando `*.js` en node_modules, sin preview montada

### Evidencia positiva (proxy OK una vez Vite arriba)

```sh
curl -s http://localhost:3000/qaap-dev/5173/ | grep -i rioja
# → HTML hero «El alma del vino español»
```

Screenshot preview OK: `test-results/qaap-rioja-e2e/04-preview.png` (pero badge **Failed** en header)

### Áreas sospechosas

- `packages/qaap-mobile-shell/src/browser/qaap-project-bootstrap-service.ts`
- Quick actions: `.theia-mobile-agent-transcript-empty-action` «Run app»
- Integración agente → terminal → probe (bloqueada por QA-002)

### Criterios de aceptación

- [ ] Tras scaffold con `package.json` + script `dev`, preview lista en <15 s sin fallback externo
- [ ] E2E no necesita `startWorkspaceDevServer()` manual
- [ ] Prompt «levanta la app» en transcript activo monta iframe automáticamente
- [ ] Documentar puertos (5173) y subcarpetas (`rioja-wines-landing-page/`, `artifacts/`)

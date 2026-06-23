## Agent Trace / API devuelven contenido y segmentos de herramientas vacíos

**Prioridad:** Alta  
**Labels sugeridos:** `bug`, `agent`, `transcript`, `priority:high`, `qa`

### Descripción

Tras completar (o fallar) un turno de agente, la API `GET /qaap/api/agent-conversations/:id` devuelve mensajes agent con **`content` vacío** y **`segments` ausentes o vacíos**, aunque la UI del transcript muestra pasos (Thinking, Read, Bash, etc.). Imposibilita dashboards, métricas, tests E2E y depuración.

### Pasos para reproducir

**Caso A — conversación completada (Mockup, landing Rioja):**

```sh
curl -s "http://localhost:3000/qaap/api/agent-conversations/bd8ee08f-7e5f-4625-92d7-80a0506d6592" \
  | jq '.messages[] | {role, content: (.content|length), segments: (.segments|length)}'
```

**Caso B — E2E mock exitoso:**

```sh
# Tras qaap-rioja-e2e-eval.mjs
jq '.conversation' test-results/qaap-rioja-e2e/report.json
# toolSegments: [], lastAgentText: ""
```

**Caso C — UI composer (120 s, failed):**

- Durante ejecución: `toolRows: 0` en DOM
- Al terminar: solo banner «Task failed», sin filas de herramienta expandibles

### Resultado esperado

- Cada turno agent persiste `content` y/o `segments[]` con `{ type: 'tool'|'thinking'|'text', name, finished, … }`
- UI y API consistentes
- E2E puede assertar `toolSegments.length > 0`

### Resultado actual

- API: `content: ""`, sin `segments` en msg agent
- E2E report: `"toolSegments": []`
- UI en flujo composer: 0 headers de log durante 120 s

### Áreas sospechosas

- `packages/qaap-cloud-workspace/src/node/qaap-agent-conversation-store.ts` — persistencia de `segments` / early return si content vacío (≈ L784)
- `packages/qaap-cloud-workspace/src/node/qaap-agent-task-runner.ts` — stream → store pipeline
- Agente mock vs real: verificar `usesStructuredAgentTranscript(agentId)`

### Criterios de aceptación

- [ ] API devuelve segmentos para conversaciones QAIQ con herramientas
- [ ] UI muestra streaming de herramientas en tiempo real (≥1 fila antes de fin de turno)
- [ ] `qaap-rioja-e2e-eval.mjs` asserta `toolSegments.length >= 1`
- [ ] Métricas sidebar (tokens, duración) derivadas de segmentos reales, no estimaciones vacías

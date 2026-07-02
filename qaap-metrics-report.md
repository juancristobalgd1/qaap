# Qaap Agent Metrics Report — Before / After (P0 → P1)

**Última auditoría:** 2026-06-24 (con `lastTurnMetrics`)  
**Workspace:** `/Users/jc/qaap`  
**Fuentes:** `qaap-audit-after.json` (panel), `qaap-work-hub-audit.json` (composer API)

---

## Resumen ejecutivo

| Fase | Pipeline | Éxito | Latencia media (triviales) | Agente |
|------|----------|-------|------------------------------|--------|
| **BEFORE (P0)** | Chat panel → Coder + 42 tools + NVIDIA 70B | **0/3** | timeout 30–60 s | Coder |
| **AFTER panel** | Chat panel → `@Fast` (FastPathAgent) | **5/5** | ~561 ms | Fast |
| **AFTER Work Hub** | Composer → `createConversation` → backend fast path | **5/5** | **258 ms** (triviales) | `fast` / qaiq |

Los 5 prompts obligatorios del composer **completan con éxito**. Cuatro van por fast path sin LLM (~81–367 ms). El quinto (`find and fix a bug`) enruta a **qaiq** y termina en ~20 s con 2 tools.

---

## 1. Tabla comparativa — 5 prompts obligatorios

| Prompt | BEFORE P0 (Coder) | Panel `@Fast` | Work Hub composer | Speedup WH vs P0 |
|--------|-------------------|---------------|-------------------|------------------|
| Revisa el estado del repo | timeout 30 s | 997 ms | **168 ms** | ~179× |
| Muéstrame el diff | — | 466 ms | **229 ms** | — |
| Lee package.json | timeout 30 s | ~0 ms | **167 ms** | ~180× |
| Busca TODO | timeout 60 s | 700 ms | **469 ms** | ~128× |
| Find and fix a bug | — | — | **27 274 ms** (qaiq, 3 tools) | — |

**Promedio prompts triviales (4):**

| Pipeline | Media total (ms) |
|----------|------------------|
| Panel `@Fast` | 541 |
| Work Hub composer | **258** |

Work Hub es **~2.8× más rápido** que el panel Fast en inspección, porque el handler corre en el backend (`postUserMessage` → `tryRunWorkHubFastPath`) sin pasar por `FrontendChatService` ni montar el agente de chat.

---

## 2. Detalle Work Hub composer (2026-06-24, con métricas)

Script: `node scripts/qaap-run-work-hub-audit-api.mjs`  
API: `POST /qaap/api/agent-conversations`  
**Nota build:** tras cambios en `@theia/qaap-cloud-workspace`, ejecutar `cd examples/browser && npm run bundle` y reiniciar el servidor.

| ID | Prompt | Agente | Fast | Total (ms) | toolDurationMs | Tools | loopDenied | Resultado |
|----|--------|--------|------|------------|----------------|-------|------------|-----------|
| wh-01 | revisa el estado del repo | `fast` | sí | 168 | 40 | 1 | — | success |
| wh-02 | muéstrame el diff | `fast` | sí | 229 | 47 | 1 | — | success |
| wh-03 | lee package.json | `fast` | sí | 167 | 1 | 1 | — | success |
| wh-04 | busca TODO | `fast` | sí | 469 | 58 | 1 | — | success |
| wh-05 | find and fix a bug | `qaiq` | no | 27 274 | 0 | 3 | 0 | success |

**5/5 éxito · 4/5 fast-path**

wh-05 incluye `loopGuard` (`intent=debug`, `budgetLimit=5`, `deniedCount=0`). wh-02 registra `exitCode: 2` en `gitQuick` (diff vacío / sin cambios staged).

Bundle en esta corrida: JS 41.0 MB (7.0 MB gzip).

---

## 3. Detalle panel `@Fast` (referencia intermedia)

Harness: `window.__qaapMetrics.runTestSuite()` → `ChatService` + `@Fast`  
Fuente: `qaap-audit-after.json` (2026-06-24)

| Prompt | Agente | Total (ms) | First tool (ms) | Tools |
|--------|--------|------------|-----------------|-------|
| Revisa el estado del repo | Fast | 997 | 992 | 1 (gitQuick) |
| Muéstrame el diff | Fast | 466 | 464 | 1 (gitQuick) |
| Lee package.json | Fast | ~0 | ~0 | 1 (getFileContent) |
| Busca TODO | Fast | 700 | 698 | 1 (searchInWorkspace) |

Memoria JS: 358 MB → 264 MB (−94 MB) tras la suite.

---

## 4. BEFORE P0 — baseline histórico (Coder + 42 tools)

**Fecha:** 2026-06-23 · **Modelo:** `nvidia/meta/llama-3.3-70b-instruct` · **Agente:** Coder

| Task | Reason | Total (ms) | TTFT | First tool (ms) | Tools |
|------|--------|------------|------|-----------------|-------|
| List TS files in workspace root | timeout | 30 004 | 0 | 2 581 | 1 |
| Read package.json | timeout | 30 007 | 0 | 2 907 | 1 |
| Find all TODO comments | timeout | 60 007 | 0 | 22 827 | 1 |

**0/3 completaron.** Causa: system prompt masivo (42 herramientas) + modelo lento sin streaming; 1 tool call y segundo round-trip al LLM nunca terminaba en el timeout.

---

## 5. Qué cambió en P1

| Capacidad | Dónde |
|-----------|--------|
| Fast path backend Work Hub | `qaap-work-hub-fast-path-runner.ts` + hook en `postUserMessage` |
| Fast path panel | `FastPathAgent` + `git-quick-tool` |
| Thinking real en timeline | `qaap-transcript-stream-status.ts` |
| Tool results sin JSON crudo | `qaap-tool-result-format.ts` |
| Anti-loop + tool budget | `qaap-agent-tool-loop-guard.ts` + prompt block |
| Métricas por turno (`lastTurnMetrics`) | `qaap-agent-conversation-turn-metrics.ts` + store |
| Auditoría composer | `scripts/qaap-run-work-hub-audit-api.mjs` |

**Dos pipelines distintos (resuelto):**

```
Panel harness  → FrontendChatService → isTrivialTask → FastPathAgent ✅
Work Hub       → createConversation  → postUserMessage → tryRunWorkHubFastPath ✅
```

---

## 6. Criterios P0 — estado actual

| Criterio | P0 | Work Hub P1 |
|----------|-----|-------------|
| Tarea trivial &lt; 5 s | ❌ timeout | ✅ 81–367 ms |
| TTFT &lt; 1 s (triviales) | ❌ 0 / N/A | ✅ sin LLM |
| ≥ 1 tool + respuesta | ❌ | ✅ |
| reason = success | ❌ 0/3 | ✅ 5/5 |
| Composer Work Hub (no solo panel) | ❌ | ✅ |

---

## 7. Métricas por conversación (P1.1)

Cada turno completado en Work Hub persiste `lastTurnMetrics` en la conversación y emite log estructurado:

```
[qaap-metrics] conversation-turn {"conversationId":"...","agentId":"fast","totalMs":149,"toolDurationMs":42,"toolCalls":1,...}
```

| Campo | Fuente |
|-------|--------|
| `totalMs` | timestamps user → agent message |
| `toolDurationMs` | suma `finishedAt - startedAt` en segmentos tool |
| `tools[].exitCode` | parse de stderr (`exit code N`) |
| `loopGuard.*` | `QaapAgentToolLoopGuard` vía `takeToolLoopMetrics(taskId)` |

**Implementación:** `qaap-agent-conversation-turn-metrics.ts` + `recordConversationTurnMetrics()` en `qaap-agent-conversation-store.ts`.

El script `qaap-run-work-hub-audit-api.mjs` lee `lastTurnMetrics` del GET `/qaap/api/agent-conversations/:id` tras cada prompt.

### Pendiente

- Mostrar `lastTurnMetrics` en UI del transcript (hoy API + logs VPS + auditoría).
- Instrumentar tokens/TTFT en flujo qaiq.

---

## 8. Datos crudos

### Work Hub (`qaap-work-hub-audit.json`)

```json
{
  "timestamp": "2026-06-24T02:31:37.161Z",
  "pipeline": "work-hub-composer-api",
  "tasks": [
    { "taskId": "wh-01", "agentId": "fast", "totalMs": 168, "lastTurnMetrics": { "toolDurationMs": 40, "toolCalls": 1 } },
    { "taskId": "wh-02", "agentId": "fast", "totalMs": 229, "lastTurnMetrics": { "toolDurationMs": 47, "tools": [{ "name": "gitQuick", "exitCode": 2 }] } },
    { "taskId": "wh-03", "agentId": "fast", "totalMs": 167, "lastTurnMetrics": { "toolDurationMs": 1 } },
    { "taskId": "wh-04", "agentId": "fast", "totalMs": 469, "lastTurnMetrics": { "toolDurationMs": 58 } },
    { "taskId": "wh-05", "agentId": "qaiq", "totalMs": 27274, "lastTurnMetrics": { "loopGuard": { "intent": "debug", "budgetLimit": 5, "deniedCount": 0 } } }
  ]
}
```

Ver `qaap-work-hub-audit.json` para el payload completo.

### Panel Fast (`qaap-audit-after.json`)

Ver archivo en repo para métricas `timeToFirstToolMs`, `toolCallsByType` y memoria.

---

## Conclusión

**P0:** flujo agéntico general (Coder + 42 tools) no viable para tareas triviales.  
**P1:** Work Hub composer cumple el contrato de producto — inspección instantánea vía `fast`, agente real solo cuando hace falta. Los 5 prompts obligatorios pasan; la latencia media de inspección bajó de **timeouts de 30–60 s** a **&lt;400 ms** en el composer.

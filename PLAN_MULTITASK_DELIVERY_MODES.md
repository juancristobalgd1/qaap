# Plan: Multitask Delivery Modes para Qaap Work Hub

## Resumen

Inspirado en los patrones de Cursor, Claude Code, Codex y Devin, este plan introduce
**3 modos de entrega de mensajes** cuando un agente está trabajando, más optimizaciones
de cola y concurrencia configurables. El objetivo: dar al usuario control explícito sobre
cómo se maneja cada mensaje, eliminando el peer-run automático sobre el mismo working tree
(comportamiento único de qaap que ningún otro IAD hace) y reemplazándolo con patrones
probados por la industria.

---

## Estado actual (problema)

| Aspecto | Hoy en qaap |
|---|---|
| Mensaje mientras agente trabaja | Spawn automático de peer run sobre el MISMO working tree |
| Cap de peer runs | 3 (`MAX_CONCURRENT_CONVERSATION_RUNS = 3`) |
| Mensaje 4+ | 429 → se descarta, usuario debe reenviar manualmente |
| Elección del usuario | Ninguna — el comportamiento es fijo |
| Conflictos de escritura | Posibles: 3 agentes editan los mismos archivos |
| Costo de tokens | 3x (3 agentes con historial completo cada uno) |

**Comparación con IADs:**

| IAD | Default | Paralelo | Interrupt |
|---|---|---|---|
| Cursor | Queue (espera turno) | Multitask button (subagente) | Stop & send |
| Claude Code | Queue (drain en tool-round) | `run_in_background` | Kill + resend |
| Codex | Queue (`delivery: "queued"`) | Subagents (`max_threads`) | Steer |
| Devin | Queue (message child session) | Managed Devins (VM aislado) | Terminate + new |
| **Qaap hoy** | **Peer run automático** ❌ | **Peer run automático** ❌ | **No existe** ❌ |

Ningún IAD hace peer runs automáticos sobre el mismo árbol. Todos encolan por defecto
y hacen paralelo explícito con aislamiento.

---

## Propuesta: 3 modos de entrega + optimizaciones

### Modo 1: Queue (default)

**Inspirado en:** Cursor "Send after current message" + Claude Code `pendingMessages`

El mensaje se encola en la conversación. Se procesa cuando el agente termina su turno.
Si llegaron múltiples mensajes mientras el agente trabajaba, se drenan secuencialmente
(con opción de batching como optimización).

**Caso de uso:** "Refactoriza auth" → "Pero no toques el archivo X" (agregar contexto
sin interrumpir ni spawn otro agente).

**Comportamiento:**
- El mensaje se acepta (202), se muestra en el transcript con badge "queued"
- Se almacena en `pendingUserMessages` en la conversación
- Cuando el agente termina su turno, se drena la cola
- Si hay múltiples mensajes encolados, se procesan como turnos secuenciales
  (o se mergean en un solo turno si el batching está activado — ver optimización B)

### Modo 2: Parallel (explícito)

**Inspirado en:** Devin Managed Devins + Cursor Multitask + qaap Parallel Runs existente

El usuario presiona un botón "Parallel" o envía con flag `deliveryMode: "parallel"`.
Se spawnea un agente en **worktree aislado** (qaap ya tiene Parallel Runs con worktrees
+ branches + selección de variante ganadora).

**Caso de uso:** "Haz el refactor A" + "Haz el refactor B" en paralelo, comparar resultados.

**Comportamiento:**
- Se crea un worktree aislado con nueva branch
- Se spawnea un agente en ese worktree
- No hay conflictos de escritura (cada agente tiene su propio árbol)
- El usuario puede comparar variantes al final (keep-branch / merge / none)
- Respeta el cap de concurrencia global y por usuario

### Modo 3: Interrupt / Steer

**Inspirado en:** Cursor "Stop & send" + Codex "Steer"

El mensaje interrumpe el agente actual. El agente para lo que está haciendo y procesa
el nuevo mensaje. El trabajo parcial se preserva en el transcript.

**Caso de uso:** "¡Para!" — el agente se desvió, o el usuario quiere redirigir.

**Comportamiento:**
- Se cancela el task actual (SIGTERM al proceso agente)
- Los segments in-flight se marcan como finished con reason "interrupted"
- El nuevo mensaje se procesa inmediatamente como un nuevo turno
- El historial incluye el trabajo parcial del agente interrumpido

---

## Optimizaciones

### Optimización A: Drain en tool-round boundaries (Claude Code)

Los mensajes encolados no se inyectan en medio de la ejecución del agente. Se drenan
en los **tool-round boundaries**: cuando el agente termina de ejecutar una herramienta
y antes de la siguiente call al LLM.

**Por qué:** preserva la estructura de turnos del agente. No hay race conditions ni
estado corrupto. El agente termina su pensamiento actual, luego recibe el nuevo input.

**Implementación en qaap:** el task runner ya tiene checkpoints entre tool calls
(QAIQ stream-json emite eventos por cada tool). Se hook en esos checkpoints para
verificar si hay mensajes encolados y drenarlos.

### Optimización B: Batching de cola (Buzz)

Cuando se drena la cola y hay múltiples mensajes encolados, se pueden mergear en un
solo turno en lugar de procesarlos como turnos separados.

**Por qué:** ahorro de ~67% en tokens de input (1 call al LLM vs N calls con historial
completo cada una).

**Comportamiento:**
- Si los mensajes encolados son follow-ups del mismo contexto (heurística: llegaron
  dentro de una ventana de tiempo corta), se mergean en un solo user message
- El mensaje mergeado incluye un separador visual entre los mensajes originales
- Se preservan los IDs originales en `batchedFromMessageIds` para trazabilidad
- Si los mensajes son claramente tareas diferentes, se procesan como turnos separados

**Heurística de batching:**
- Ventana de coalescing: 2000ms después de que el agente termina
- Si llegan más mensajes dentro de la ventana, se agregan al batch
- Si no, se hace flush
- Máximo 5 mensajes por batch (para no saturar el contexto)

### Optimización C: Concurrency configurable (Codex)

Hacer configurable el número máximo de agentes concurrentes, como Codex `max_threads`.

**Niveles:**
- `QAAP_MAX_CONCURRENT_AGENTS` (global, ya existe, default 4)
- `QAAP_MAX_CONCURRENT_AGENTS_PER_USER` (por usuario, ya existe, default 2)
- `QAAP_MAX_PARALLEL_VARIANTS_PER_CONVERSATION` (nuevo, default 3, reemplaza
  `MAX_CONCURRENT_CONVERSATION_RUNS` — pero solo aplica al modo Parallel, no al Queue)

### Optimización D: Notificaciones de completion sin interrumpir (Claude Code + Codex)

Cuando un agente en background (parallel) termina, la notificación se entrega al
conversation principal como un mensaje de sistema, sin interrumpir el agente foreground.

**Inspirado en:** Claude Code `notified` flag + Codex `delivery: "queued"` para
cross-thread completion notices.

---

## Modelo de datos

### Nuevos campos en `QaapAgentConversation`

```typescript
// packages/qaap-cloud-workspace/src/common/qaap-agent-conversation.ts

export interface QaapAgentConversation {
    // ... campos existentes ...

    /** Mensajes de usuario encolados mientras un agente está corriendo.
     *  Se drenan cuando el agente termina su turno (modo Queue). */
    readonly pendingUserMessages?: ReadonlyArray<QaapPendingUserMessage>;
}

export interface QaapPendingUserMessage {
    readonly id: string;
    readonly content: string;
    readonly createdAt: number;
    readonly turnAgentId?: string;
    readonly turnAgentModel?: QaapCreateAgentTaskQaiqModel;
    readonly clientMessageId?: string;
}
```

### Nuevo campo en `QaapAgentMessage`

```typescript
export interface QaapAgentMessage {
    // ... campos existentes ...

    /** Si este mensaje es el resultado de un batch de mensajes encolados,
     *  contiene los IDs de los mensajes originales mergeados. */
    readonly batchedFromMessageIds?: ReadonlyArray<string>;
}
```

### Nuevo tipo: `QaapMessageDeliveryMode`

```typescript
/** Cómo entregar un mensaje cuando un agente está trabajando. */
export type QaapMessageDeliveryMode =
    /** Encolar: esperar a que el agente termine su turno (default). */
    | 'queue'
    /** Paralelo: spawn en worktree aislado (Parallel Runs). */
    | 'parallel'
    /** Interrumpir: cancelar agente actual y procesar inmediatamente. */
    | 'interrupt';

/** Default delivery mode si no se especifica. */
export const QAAP_DEFAULT_DELIVERY_MODE: QaapMessageDeliveryMode = 'queue';
```

### Extender `QaapPostAgentMessageRequest`

```typescript
export interface QaapPostAgentMessageRequest {
    // ... campos existentes ...

    /** Cómo entregar este mensaje si la conversación está streaming.
     *  Default: 'queue'. */
    readonly deliveryMode?: QaapMessageDeliveryMode;
}
```

### Extender `QaapAgentConversationSummaryDTO` (cliente)

```typescript
export interface QaapAgentConversationSummaryDTO {
    // ... campos existentes ...

    /** Mensajes encolados pendientes de procesar. */
    readonly pendingUserMessages?: ReadonlyArray<{
        readonly id: string;
        readonly content: string;
        readonly createdAt: number;
    }>;
}
```

### Nuevo evento SSE

```typescript
export type QaapAgentConversationEvent =
    // ... eventos existentes ...
    | { readonly type: 'pending-queued'; readonly conversationId: string; readonly cwd: string;
        readonly message: QaapPendingUserMessage }
    | { readonly type: 'pending-drained'; readonly conversationId: string; readonly cwd: string;
        readonly drainedCount: number };
```

---

## Implementación por fases

### Fase 1: Modo Queue (default) — reemplaza peer run automático

**Objetivo:** eliminar el peer run automático sobre el mismo working tree. Los mensajes
mientras el agente trabaja se encolan en lugar de spawnear otro agente.

**Archivos a modificar:**

| Archivo | Cambio |
|---|---|
| `qaap-cloud-workspace/src/common/qaap-agent-conversation.ts` | Agregar `QaapMessageDeliveryMode`, `QaapPendingUserMessage`, `pendingUserMessages` en conversation, `deliveryMode` en request, `batchedFromMessageIds` en message |
| `qaap-cloud-workspace/src/common/qaap-agent-conversation.ts` | Agregar eventos SSE `pending-queued` y `pending-drained` |
| `qaap-cloud-workspace/src/node/qaap-agent-conversation-store-render2.ts` | Modificar `postUserMessageExtracted` (líneas 372-389): en lugar de spawn peer run, encolar en `pendingUserMessages` |
| `qaap-cloud-workspace/src/node/qaap-agent-conversation-store-constants.ts` | Agregar `QAAP_DEFAULT_DELIVERY_MODE`, `COALESCE_WINDOW_MS = 2000`, `MAX_BATCH_SIZE = 5` |
| `qaap-cloud-workspace/src/node/qaap-agent-task-runner-render2.ts` | Hook en `finishTask` para llamar `drainPendingMessages` cuando un task termina |
| `qaap-cloud-workspace/src/node/qaap-agent-conversation-endpoint.ts` | Aceptar `deliveryMode` en POST, devolver 202 cuando se encola (no 429) |
| `qaap-cloud-workspace/src/node/qaap-agent-conversation-store-parallel-runs.spec.ts` | Actualizar tests: peer runs ahora requieren `deliveryMode: 'parallel'` |

**Lógica clave en `postUserMessageExtracted`:**

```typescript
if (conv.status === 'streaming') {
    const activeTaskIds = ctx.getActiveTaskIdsForConversation(id);
    if (activeTaskIds.length === 0) {
        // stale: recover to idle (igual que hoy)
        conv = { ...conv, status: 'idle', updatedAt: Date.now() };
        ctx.conversations.set(id, conv);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(conv) });
    } else {
        const mode = request.deliveryMode ?? QAAP_DEFAULT_DELIVERY_MODE;
        if (mode === 'parallel') {
            // Modo Parallel: spawn en worktree aislado (Fase 2)
            // Por ahora, cae al comportamiento de queue hasta que Fase 2 esté lista
            return ctx.enqueuePendingMessage(conv, userMessage);
        }
        if (mode === 'interrupt') {
            // Modo Interrupt: cancelar agente actual (Fase 3)
            // Por ahora, cae al comportamiento de queue hasta que Fase 3 esté lista
            return ctx.enqueuePendingMessage(conv, userMessage);
        }
        // Modo Queue (default): encolar
        return ctx.enqueuePendingMessage(conv, userMessage);
    }
}
```

**`enqueuePendingMessage`:**

```typescript
function enqueuePendingMessage(
    conv: QaapAgentConversation,
    userMessage: QaapAgentMessage,
): QaapAgentConversation {
    const pending: QaapPendingUserMessage = {
        id: userMessage.id,
        content: userMessage.content,
        createdAt: userMessage.createdAt,
        ...(userMessage.turnAgentId ? { turnAgentId: userMessage.turnAgentId } : {}),
        ...(userMessage.turnAgentModel ? { turnAgentModel: userMessage.turnAgentModel } : {}),
        ...(userMessage.clientMessageId ? { clientMessageId: userMessage.clientMessageId } : {}),
    };
    const next = {
        ...conv,
        pendingUserMessages: [...(conv.pendingUserMessages ?? []), pending],
    };
    ctx.conversations.set(conv.id, next);
    ctx.fire({ type: 'pending-queued', conversationId: conv.id, cwd: conv.cwd, message: pending });
    ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
    void ctx.persist();
    return next;
}
```

**`drainPendingMessages` (llamado desde `finishTask`):**

```typescript
function drainPendingMessages(convId: string): void {
    const conv = ctx.conversations.get(convId);
    if (!conv?.pendingUserMessages?.length || conv.status !== 'idle') {
        return;
    }
    const batch = conv.pendingUserMessages.slice(0, MAX_BATCH_SIZE);
    const remaining = conv.pendingUserMessages.slice(MAX_BATCH_SIZE);

    // Actualizar conversation: limpiar cola (o dejar los restantes)
    const cleared = { ...conv, pendingUserMessages: remaining };
    ctx.conversations.set(convId, cleared);
    ctx.fire({ type: 'pending-drained', conversationId: convId, cwd: conv.cwd,
        drainedCount: batch.length });

    if (batch.length === 1) {
        // Un solo mensaje: procesar como turno normal
        ctx.postUserMessage(convId, batch[0].content, batch[0].turnAgentId,
            batch[0].turnAgentModel, undefined, undefined, undefined, undefined,
            { clientMessageId: batch[0].clientMessageId });
    } else {
        // Múltiples mensajes: batching (Optimización B)
        const mergedContent = batch.map(m => m.content).join('\n\n---\n\n');
        const batchedIds = batch.map(m => m.id);
        ctx.postUserMessage(convId, mergedContent, batch[0].turnAgentId,
            batch[0].turnAgentModel, undefined, undefined, undefined, undefined,
            { clientMessageId: batch[0].clientMessageId, batchedFromMessageIds: batchedIds });
    }

    // Si quedan más en la cola, se drenarán cuando este turno termine
}
```

**Tests:**

```typescript
describe('delivery mode: queue', () => {
    it('enqueues message instead of spawning peer run when agent is streaming', () => {
        const { store } = createStore();
        store.postUserMessage('c1', 'first message');
        // Agente 1 está corriendo
        const conv = store.postUserMessage('c1', 'second message');
        expect(conv.pendingUserMessages).to.have.length(1);
        expect(store.activeTaskIds('c1')).to.have.length(1); // no peer run
    });

    it('drains queued messages when agent finishes', () => {
        const { store, runner } = createStore();
        store.postUserMessage('c1', 'first');
        store.postUserMessage('c1', 'second (queued)');
        // Simular que el agente termina
        runner.finishTask(store.activeTaskIds('c1')[0], 'completed', undefined);
        // El mensaje encolado se procesa
        expect(store.activeTaskIds('c1')).to.have.length(1);
    });

    it('batches multiple queued messages into single turn', () => {
        const { store, runner } = createStore();
        store.postUserMessage('c1', 'first');
        store.postUserMessage('c1', 'second (queued)');
        store.postUserMessage('c1', 'third (queued)');
        runner.finishTask(store.activeTaskIds('c1')[0], 'completed', undefined);
        // Un solo agente procesa ambos mensajes mergeados
        expect(store.activeTaskIds('c1')).to.have.length(1);
        const conv = store.get('c1');
        const lastUserMsg = conv.messages.filter(m => m.role === 'user').pop();
        expect(lastUserMsg?.batchedFromMessageIds).to.have.length(2);
    });

    it('does not 429 when queue grows beyond MAX_CONCURRENT_CONVERSATION_RUNS', () => {
        const { store } = createStore();
        store.postUserMessage('c1', 'first');
        for (let i = 0; i < 10; i++) {
            store.postUserMessage('c1', `queued ${i}`);
        }
        // Antes: habría throw QaapMaxConcurrentRunsError al 4º mensaje
        // Ahora: todos se encolan
        const conv = store.get('c1');
        expect(conv.pendingUserMessages).to.have.length(10);
    });
});
```

### Fase 2: Modo Parallel (explícito con worktree aislado)

**Objetivo:** promover Parallel Runs como el modo correcto para multitarea real.
Requiere acción explícita del usuario (botón o flag).

**Archivos a modificar:**

| Archivo | Cambio |
|---|---|
| `qaap-cloud-workspace/src/node/qaap-agent-conversation-store-render2.ts` | En `postUserMessageExtracted`, cuando `deliveryMode === 'parallel'`, delegar a Parallel Runs API en lugar de encolar |
| `qaap-cloud-workspace/src/common/qaap-parallel-run.ts` | Ya tiene la infraestructura (worktree, branch, variant). Exponer como delivery mode. |
| `qaap-cloud-workspace/src/node/qaap-parallel-run-endpoint.ts` | Aceptar POST desde `postUserMessage` con `deliveryMode: 'parallel'` |
| `qaap-mobile-shell/src/browser/mobile-projects-transcript-sticky-composer-ui-live-status2.ts` | Agregar botón "Parallel" en el composer |

**Lógica:**

```typescript
if (mode === 'parallel') {
    // Verificar cap de parallel variants
    const activeParallel = ctx.countActiveParallelVariants(id);
    if (activeParallel >= QAAP_MAX_PARALLEL_VARIANTS_PER_CONVERSATION) {
        // Encolar como queue en lugar de rechazar
        return ctx.enqueuePendingMessage(conv, userMessage);
    }
    // Crear worktree aislado + nueva conversación variant
    const variant = ctx.createParallelVariant(conv.cwd, userMessage.content,
        userMessage.turnAgentId, userMessage.turnAgentModel);
    // La conversación variant se agrupa bajo parallelRunId
    return ctx.linkParallelVariant(conv, variant);
}
```

**UI:** botón "Parallel" en el composer (junto al botón de send). Al presionar,
el mensaje se envía con `deliveryMode: 'parallel'`. El usuario ve la nueva
conversación variant en el sidebar con badge "parallel".

### Fase 3: Modo Interrupt / Steer

**Objetivo:** permitir al usuario detener y redirigir al agente inmediatamente.

**Archivos a modificar:**

| Archivo | Cambio |
|---|---|
| `qaap-cloud-workspace/src/node/qaap-agent-conversation-store-render2.ts` | En `postUserMessageExtracted`, cuando `deliveryMode === 'interrupt'`, cancelar task actual y procesar nuevo mensaje |
| `qaap-cloud-workspace/src/node/qaap-agent-task-runner-render2.ts` | Exponer `cancelTask(taskId, reason: 'interrupted')` que hace SIGTERM + marca segments como finished |
| `qaap-cloud-workspace/src/common/qaap-agent-transcript-segment-finalize.ts` | Ya tiene `finalizeUnfinishedAgentToolSegments` — reutilizar |
| `qaap-mobile-shell/src/browser/mobile-projects-transcript-sticky-composer-ui-live-status2.ts` | Agregar botón "Interrupt" (o shortcut Cmd+Enter como Cursor) |

**Lógica:**

```typescript
if (mode === 'interrupt') {
    // Cancelar todos los tasks activos de esta conversación
    const activeTaskIds = ctx.getActiveTaskIdsForConversation(id);
    for (const taskId of activeTaskIds) {
        ctx.taskRunner.cancel(taskId, 'interrupted');
    }
    // Finalizar segments in-flight del agente
    const lastAgentMsg = conv.messages.find(m => m.role === 'agent' && m.runActive);
    if (lastAgentMsg?.segments) {
        const finalized = finalizeUnfinishedAgentToolSegments(lastAgentMsg.segments,
            'Interrupted by user.');
        // Actualizar mensaje del agente con segments finalizados
    }
    // Marcar conversación como idle para que el nuevo mensaje se procese
    conv = { ...conv, status: 'idle', updatedAt: Date.now() };
    ctx.conversations.set(id, conv);
    ctx.fire({ type: 'updated', conversation: toConversationSummary(conv) });
    // Caer al flujo normal: postUserMessage procesa el nuevo mensaje
}
```

### Fase 4: Optimización A — Drain en tool-round boundaries

**Objetivo:** drenar mensajes encolados entre tool calls del agente, no solo al
final del turno. Esto permite steering más responsivo.

**Inspirado en:** Claude Code `drainPendingMessages()` en tool-round boundaries.

**Archivos a modificar:**

| Archivo | Cambio |
|---|---|
| `qaap-cloud-workspace/src/node/qaap-agent-task-runner-streaming2.ts` | Hook en el parser de stream-json de QAIQ: cuando se recibe un evento de tool result, verificar si hay mensajes encolados |
| `qaap-cloud-workspace/src/node/qaap-agent-conversation-store-render2.ts` | Exponer `peekPendingMessages(convId)` para que el task runner pueda verificar sin drenar |

**Lógica:**

```typescript
// En el task runner, después de cada tool result del stream-json:
function onToolResult(taskId: string, toolResult: QaiqToolResult): void {
    const convRef = ctx.taskToConversation.get(taskId);
    if (!convRef) return;
    const conv = ctx.conversations.get(convRef.conversationId);
    if (!conv?.pendingUserMessages?.length) return;

    // Solo drenar si hay mensajes encolados Y el agente está entre tools
    // (no en medio de edición de archivo)
    const pending = conv.pendingUserMessages;
    // Drain: inyectar como nuevo user message en el stdin del agente
    // QAIQ soporta esto via stream-json: enviar un nuevo user message
    // mientras el agente está entre tool calls
    ctx.injectMessageIntoRunningAgent(taskId, pending[0].content);
    // Remover de la cola
    const remaining = pending.slice(1);
    ctx.conversations.set(convRef.conversationId,
        { ...conv, pendingUserMessages: remaining });
    ctx.fire({ type: 'pending-drained', conversationId: convRef.conversationId,
        cwd: conv.cwd, drainedCount: 1 });
}
```

**Nota:** esto requiere que el agente CLI (QAIQ) soporte recibir mensajes
mid-turn via stdin. Verificar si QAIQ ya lo soporta o si necesita un cambio.

### Fase 5: UI — Selector de modo en el composer

**Objetivo:** dar al usuario control visible sobre el modo de entrega.

**Inspirado en:** Cursor setting "Queue Messages" + botón Multitask.

**Archivos a modificar:**

| Archivo | Cambio |
|---|---|
| `qaap-mobile-shell/src/browser/mobile-projects-transcript-sticky-composer-ui-live-status2.ts` | Agregar selector de modo junto al botón send |
| `qaap-mobile-shell/src/browser/style/mobile-workbench-conversation.css` | Estilos para el selector y badges de queued |
| `qaap-mobile-shell/src/common/qaap-agent-conversation-client.ts` | Enviar `deliveryMode` en `postConversationMessage` |
| `qaap-mobile-shell/src/browser/mobile-projects-transcript-submit-ui.ts` | Manejar respuesta 202 con mensaje encolado, renderizar badge "queued" |

**UI propuesta:**

```
┌─────────────────────────────────────────────────┐
│ [Composer text area]                            │
│                                                 │
│ [📎] [Queue ▾] [Send →]                         │
│         │                                       │
│         ├─ Queue (default)                      │
│         ├─ Parallel (worktree aislado)          │
│         └─ Interrupt (stop & send)              │
└─────────────────────────────────────────────────┘
```

- **Queue (default):** el mensaje se encola. Badge "queued" en el transcript.
- **Parallel:** el mensaje se envía a un worktree aislado. Nueva conversación variant.
- **Interrupt:** el agente actual se detiene. El mensaje se procesa inmediatamente.

**Atajos de teclado (como Cursor):**
- `Enter` → envía con modo default (Queue)
- `Cmd+Enter` → envía con modo Interrupt (Stop & send)
- `Shift+Enter` → envía con modo Parallel

**Badge "queued" en transcript:**

```
┌─ User ──────────────────────────────────────────┐
│ "Pero no toques el archivo X"                   │
│ ⏳ Queued — will be sent when the agent finishes │
└─────────────────────────────────────────────────┘
```

### Fase 6: Optimización C — Concurrency configurable

**Objetivo:** hacer configurable el número de agentes paralelos.

**Archivos a modificar:**

| Archivo | Cambio |
|---|---|
| `qaap-cloud-workspace/src/node/qaap-agent-task-runner-utils2.ts` | Renombrar `MAX_CONCURRENT_CONVERSATION_RUNS` a `QAAP_MAX_PARALLEL_VARIANTS_PER_CONVERSATION`, hacer configurable via env |
| `qaap-cloud-workspace/src/node/qaap-agent-conversation-store-constants.ts` | Actualizar constante |

**Niveles configurables:**

| Variable | Default | Descripción |
|---|---|---|
| `QAAP_MAX_CONCURRENT_AGENTS` | 4 | Agentes concurrentes global |
| `QAAP_MAX_CONCURRENT_AGENTS_PER_USER` | 2 | Agentes concurrentes por usuario |
| `QAAP_MAX_PARALLEL_VARIANTS_PER_CONVERSATION` | 3 | Variants paralelos por conversación (modo Parallel) |
| `QAAP_MAX_BATCH_SIZE` | 5 | Máximo mensajes mergeados por batch (modo Queue) |
| `QAAP_COALESCE_WINDOW_MS` | 2000 | Ventana de coalescing para batching |

---

## Orden de implementación recomendado

| Fase | Esfuerzo | Riesgo | Impacto | Recomendación |
|---|---|---|---|---|
| **Fase 1: Queue default** | Medio | Bajo | Alto | **Primero** — elimina el comportamiento peligroso (peer runs sobre mismo árbol) |
| **Fase 5: UI selector** | Medio | Bajo | Alto | **Junta con Fase 1** — sin UI, el usuario no ve el cambio |
| **Fase 3: Interrupt** | Bajo | Bajo | Medio | **Segundo** — fácil de implementar, alta utilidad |
| **Fase 2: Parallel explícito** | Medio | Medio | Alto | **Tercero** — ya existe la infra de Parallel Runs, solo exponerla |
| **Fase 6: Concurrency configurable** | Bajo | Bajo | Bajo | **Cuarto** — quick win |
| **Fase 4: Drain en tool-round** | Alto | Medio | Medio | **Último** — requiere cambio en QAIQ CLI, más complejo |

---

## Qué NO cambia

- **Parallel Runs** (worktrees aislados + selección de variante) se mantiene y se
  promueve como el modo Parallel explícito.
- **Auto-continue** se mantiene sin cambios.
- **Context compaction** se mantiene sin cambios.
- **Workflows** (agent-turn, human-gate, join, etc.) se mantiene sin cambios.
- **Job loops** (cron, webhook, interval) se mantiene sin cambios.
- **Approval policies** se mantiene sin cambios.
- **Task queue** (FIFO con per-user cap) se mantiene para el task runner global.

---

## Verificación

Después de cada fase:

1. `npx lerna run compile --scope @theia/qaap-cloud-workspace --scope @theia/qaap-mobile-shell`
2. `npx lerna run test --scope @theia/qaap-cloud-workspace`
3. `node scripts/qaap-drift-check.js`
4. `npm run build:browser`
5. Pruebas manuales en browser:
   - Enviar mensaje mientras agente trabaja → se encola (no peer run)
   - Presionar "Parallel" → se crea worktree aislado
   - Presionar "Interrupt" (Cmd+Enter) → agente se detiene
   - 10 mensajes rápidos → todos se encolan, no hay 429
   - Agente termina → cola se drena (con batching si hay múltiples)

---

## Comparación final: qaap antes vs después

| Aspecto | Qaap antes | Qaap después | Cursor | Claude Code | Codex |
|---|---|---|---|---|---|
| Default | Peer run automático | Queue | Queue | Queue | Queue |
| Paralelo | Automático, mismo árbol | Explícito, worktree aislado | Multitask button | `run_in_background` | Subagents |
| Interrupt | No existe | Cmd+Enter | Stop & send | Kill + resend | Steer |
| Mensaje 4+ | 429, descarta | Se encola | Se encola | Se encola | Se encola |
| Batching | No | Sí (optimización B) | No | No | No |
| Drain entre tools | No | Sí (Fase 4) | No | Sí | No |
| Concurrency config | Fixed | Configurable | Setting | Fixed | `max_threads` |
| Conflictos escritura | Posibles | Imposibles | N/A | N/A | N/A |
| Elección usuario | Ninguna | 3 modos | 3 modos | 2 modos | 2 modos |

Qaap pasaría de ser el único IAD que hace peer runs automáticos sobre el mismo árbol
a tener el sistema de delivery modes más completo: 3 modos + batching + drain entre
tools + concurrency configurable.

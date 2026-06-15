# Agent Trace / Execution Timeline — Cursor Parity Spec (Qaap)

Fuente de verdad para alcanzar paridad funcional y visual con el Agent Trace de Cursor en Qaap Work Hub.

**Verificación automatizada:** `node examples/playwright/scripts/qaap-agent-trace-verify.mjs`  
**Implementación principal:** `packages/qaap-mobile-shell/src/browser/mobile-projects-transcript-messages-artifacts-ui.ts`

---

## Rol

Actúa como Staff Product Designer, Senior Frontend Engineer y UX Architect especializado en herramientas de desarrollo para IA.

Recrear el Agent Trace / Execution Timeline con calidad de producción, inspirado en Cursor, optimizado para Qaap.

1. Alcanzar paridad funcional y visual con Cursor.
2. Mejorar solo lo que aporte más claridad o rendimiento.

---

## Objetivo

El usuario debe entender sin ruido visual:

- Qué está haciendo el agente.
- Qué hizo anteriormente.
- Qué está haciendo ahora.
- Qué hará después (cuando el backend lo exponga).
- Qué herramientas utilizó.
- Qué archivos modificó.
- Qué comandos ejecutó.
- Qué errores encontró y cómo los resolvió.

---

## Principios de diseño (prioridad)

1. Claridad
2. Escaneabilidad
3. Velocidad percibida
4. Densidad de información
5. Estética

Cada elemento debe responder: *¿Ayuda al usuario a entender qué está pasando?* Si no, eliminarlo.

---

## Comportamiento visual

Cada acción del agente es un **Step**: Pensando, Analizando proyecto, Leyendo archivos, Buscando referencias, Editando archivo, Ejecutando comando, Arrancando servidor, Analizando preview, Corrigiendo error, Completado.

---

## Jerarquía visual

| Nivel | Contenido | Comportamiento |
|---|---|---|
| 1 | Actividad actual | Siempre expandida, animada, indicador live |
| 2 | Acciones recientes | Colapsables, resumen visible, detalle bajo demanda |
| 3 | Historial antiguo | Compactado, alta densidad, bajo consumo visual |

**Estado Qaap:** fases `thinking → acting → writing → settled` en `qaap-transcript-stream-status.ts`. Pendiente: separación visual explícita nivel 2 vs 3.

---

## Timeline — campos por Step

- Icono
- Título
- Estado
- Duración
- Timestamp (cuando disponible)
- Herramienta utilizada

Ejemplo:

```
✓ Editando app/page.tsx
  12 archivos modificados · 2.4s
```

**Estado Qaap:** `qaap-transcript-activity-navigation.ts`, `qaap-transcript-activity-timing.ts`.

---

## Estados

| Estado | Uso |
|---|---|
| `waiting` | Tool pendiente de aprobación |
| `thinking` | Razonamiento del modelo |
| `running` | Tool en ejecución |
| `streaming` | Respuesta de texto en curso |
| `success` | Step completado OK |
| `warning` | Stall / más lento de lo esperado |
| `error` | Tool o comando fallido |
| `cancelled` | Turno o conversación cancelada |
| `retrying` | Reintento tras error |

Cada estado: iconografía, color y animación propios (`mobile-workbench.css`).

---

## Pensamiento del agente

- Resumen ejecutivo colapsado (`thought-brief`).
- Expandir para detalle.
- Nunca paredes de texto en el timeline.

---

## Tool calls

Herramientas de primera clase: Read, Write, Search, Terminal, Browser, Preview, Git, MCP.

Cada tool call: herramienta, parámetros resumidos, resultado, duración, expandible.

---

## Archivos

- Número total de archivos modificados.
- Lista resumida expandible.
- Diff disponible.

**Estado Qaap:** `createTranscriptChangedFilesCard()`, agrupación "Edited N files".

---

## Terminal

Comando, estado, duración, salida resumida, expandir para logs completos.

---

## Streaming

Timeline actualizado en tiempo real (parches DOM incrementales). Mínimo 1 actualización visible cada 1–2 s.

**Estado Qaap:** `patchStreamingActivityTimeline()`, stall watch cada 1 s.

---

## Autoscroll

Seguir actividad actual; desactivar si el usuario hace scroll manual; botón "Volver al final" / scroll al step activo.

**Estado Qaap:** `qaap-transcript-scroll-to-bottom.ts`, `qaap-transcript-user-scroll-pin.ts`.

---

## Colapso inteligente (20+ steps)

Colapsar pasos completados; mantener expandidos: actual, error, último completado.

**Estado Qaap:** `qaap-transcript-timeline-visibility.ts` (colapso inline 20+).

---

## Errores

Extremadamente visibles: qué, dónde, impacto, acción tomada, resultado.

**Estado Qaap P0:** steps `error` en timeline + pill expandido automático.

---

## Mobile

Paridad funcional: timeline, tool calls, diffs, logs, estados. Adaptar layout/densidad/espaciado, no ocultar funcionalidad.

---

## Rendimiento

100+ eventos, 60 FPS, virtualización, render incremental, memoización, sin rerender global.

**Estado Qaap:** virtual list de mensajes; timeline incremental; virtualización de steps pendiente P2.

---

## Mapa código ↔ spec

| Sección | Archivo(s) |
|---|---|
| Steps / estados | `qaap-transcript-activity-navigation.ts`, `qaap-transcript-activity-step-state.ts` |
| Duración | `qaap-transcript-activity-timing.ts` |
| Fases streaming | `qaap-transcript-stream-status.ts` |
| Render DOM | `mobile-projects-transcript-messages-artifacts-ui.ts` |
| Tool pills | `mobile-projects-transcript-messages-tool-ui.ts` |
| CSS | `mobile-workbench.css` |
| Paridad CI | `examples/playwright/scripts/qaap-agent-trace-verify.mjs` |

---

## Auditoría / paridad objetivo

≥ 95% paridad funcional y visual. Checklist en `qaap-agent-trace-verify.mjs` → `report.parity`.

| ID | Requisito | Estado |
|---|---|---|
| P-01 | Timeline colapsable inline | ✅ |
| P-02 | Thought brief colapsado | ✅ |
| P-03 | Stream line live (composer + transcript) | ✅ |
| P-04 | 9 estados con clases CSS | ✅ P0 |
| P-05 | Duración por step | ✅ P0 |
| P-06 | Step error visible | ✅ P0 |
| P-07 | Tool calls expandibles | ✅ |
| P-08 | Changed files card | ✅ |
| P-09 | Autoscroll pin | ✅ |
| P-10 | Colapso 20+ inteligente | ✅ P1 |
| P-11 | Virtualización timeline | ✅ P2 |
| P-12 | Scroll al step activo | ✅ P2 |

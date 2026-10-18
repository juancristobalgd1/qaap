# Plan editable y fan-out a N subtareas (roadmap H3.1)

Estado: diseño del 18 oct 2026, revisado por un deep-reasoner. Completa H3.1 junto con
`doc/qaap-task-to-pr.md`.

## Flujo objetivo

Tarea en la Work Hub → **plan visible y editable** → N subtareas en paralelo, cada una en su worktree y su
sandbox → resultados fusionados en la rama de la conversación → verificación → revisor adversarial → **un PR
con evidencia**. Las tareas de un solo paso siguen como hoy.

## Qué se reutiliza (y qué no)

| Pieza | Se reutiliza tal cual |
|---|---|
| Plan | El modo `plan` del composer (turno de solo lectura, `readOnlyWorkspace`), con una instrucción extra que pide un bloque `qaap-plan` |
| Subtarea | Una **conversación hija** normal: transcript en vivo, fila propia en mission control, verificación por turno |
| Aislamiento | `QaapConversationWorktreeService.create` (rama `qaap/worktree/<id>`). El sandbox va **por worktree** (`qaap-task-<sha(root)>`), así que cada hija tiene el suyo sin código nuevo |
| Integración | Un turno normal del padre: su checkpoint pre se toma **antes** de escribir los resultados y su post después, así que verificación, revisor y `QaapTaskPullRequestService` ven el diff combinado sin cambios |
| PR | `QaapTaskPullRequestService` del padre. Las hijas nacen con `taskPullRequestEnabled: false` |

**Dynamic Workflows no es el motor.** El IR solo tiene fan-out estático, el join solo cuenta llegadas, no hay
worktree por nodo (se quitó a propósito y la validación rechaza escritores concurrentes sobre el mismo cwd) y no
hay SSE. Un nodo "map" dinámico con worktree y merge por nodo sería un cambio grande al IR. El plan, en cambio,
ya está materializado cuando el usuario pulsa Run: N es conocido. El turno integrador es un turno de chat, así
que lo cubre el grafo de turnos de ADR-002 (auto-resume tras reinicio, fallback de modelo). Registrar la
ejecución como traza de workflow (`adoptRun` con un grafo estático plan → N → join → integrar) queda como
mejora: no aporta comportamiento.

## Estado: `conv.taskPlan`

```
QaapTaskPlan {
  id, state, sourceMessageId, summary?, subtasks[], autoRun, autoRunAt?, edited?,
  integrationMessageId?, error?, createdAt, updatedAt
}
state: drafting → awaiting-approval → running → integrating → done
       (+ failed, cancelled; "single" cuando el plan salió de un paso y se siguió como hoy)
subtask: { id, title, prompt, state: pending|running|done|failed|cancelled,
           conversationId?, branch?, headSha?, conflict?, error? }
```

Viaja completo en el resumen de la conversación (tope: 6 subtareas, 2 000 caracteres por prompt). Las hijas
llevan `parentConversationId` y `taskPlanSubtaskId`.

## Fases

1. **Disparo.** `QAAP_TASK_FANOUT=off|auto|on`, por defecto `auto` (entró apagado en el primer commit y pasó a `auto` en el mismo PR tras el e2e). Al crear una
   conversación con primer mensaje en modo build, cwd git y un agente con solo lectura forzada:
   - `fanOut: true` en la petición (toggle del composer) → planifica;
   - `auto`: también si el mensaje es claramente multi-paso (≥ 3 elementos de lista accionables);
   - `on`: siempre (tests, benchmark).
   En los demás casos no cambia nada: la conversación sigue el camino de hoy.
2. **Planificación.** El primer turno corre en modo `plan` con la instrucción de terminar con
   ` ```qaap-plan {"summary", "subtasks":[{"title","prompt"}]} ``` `. Si falta el bloque se usa la lista
   numerada del plan. Es de solo lectura, así que no produce PR (`turnVerdict.readOnly`).
3. **Aprobación.**
   - Con **≥ 2 subtareas**, el plan queda en `awaiting-approval`: tarjeta en el transcript con los campos
     editables, **Run** como acción principal, "Run as one task" y Cancel. Con auto-run (activo por defecto)
     corre solo tras `QAAP_TASK_FANOUT_AUTORUN_MS` (60 s). Editar el plan (PATCH) apaga el auto-run: la
     persona ya está mirando.
   - Con **< 2 subtareas** se sigue como hoy: un turno build con el mensaje original y el plan como contexto
     (estado `single`).
4. **Fan-out.** Run crea una conversación hija por subtarea, en paralelo hasta
   `QAAP_TASK_FANOUT_MAX_PARALLEL` (4; el broker admite 8 sandboxes por tenant), y el resto espera en
   `pending`. Cada hija tiene su worktree (rama `qaap/worktree/<id>` desde HEAD), su sandbox y su
   verificación, con prompt = subtarea + resumen del plan + "solo tu parte".
5. **Join.** Una hija termina cuando queda en reposo (idle, sin tarea viva ni cola). El desenlace del turno
   lo da el gancho de asentamiento del store; un fallo, cancelación o timeout de inactividad cuenta como
   `failed`, nunca deja el join colgado. Al terminar se hace commit en su propia rama (`add -A` +
   `commit --no-verify`), nunca `worktreeService.apply()` (eso comitea en la rama base).
6. **Integración.** Con todas las hijas asentadas, el padre vuelve a modo build y recibe un turno interno,
   "Integrate the subtasks' results…", con la lista, sus estados y conflictos. Con la opción `prepareWorkspace`
   de `postUserMessage`, serializada en `runSerializedGit` justo **después** del checkpoint pre-turno, y solo si
   ese checkpoint quedó registrado:
   - compone `T` con `git merge-tree --write-tree`: base = HEAD, nuestro lado = el commit del checkpoint pre
     (con los ficheros sucios del usuario), su lado = cada hija en orden. Una hija en conflicto se salta y se
     marca `conflict` (el prompt se lo dice al integrador con su rama);
   - escribe `T` en el árbol de trabajo con un índice temporal (`read-tree` + `checkout-index` de las rutas
     cambiadas y borrado de las eliminadas). Sin commit y sin tocar el índice real: verificación y revisor
     leen `git diff HEAD` más los untracked;
   - si algo falla, el turno falla de forma visible y el agente no arranca.
7. **PR.** El post-checkpoint del turno integrador contiene todo. `QaapTaskPullRequestService` abre un único
   PR en `qaap/task/<padre>`, con evidencia, veredicto y "needs attention" si algo salió rojo.

## Cancelación y reinicio

- Cancelar el plan (o el turno del padre) cancela las hijas vivas y deja el plan en `cancelled`.
- El estado está en el documento persistido. Al arrancar, el servicio reconcilia:
  - `awaiting-approval` → reprograma el auto-run;
  - `running` → relee las hijas (una hija sin tarea viva y sin veredicto cuenta como `failed: interrupted`);
  - `integrating` → `done` en cuanto el turno integrador se asienta.

## Mission control (móvil)

- **Padre:** `awaiting-approval` va al carril *Needs you* ("Plan ready · runs in 40s"); `running` /
  `integrating` van a *Running* con "Subtasks 2/3".
- **Hija:** fila propia en *Running* con la insignia "Subtask k/N", que es como se ven en vivo las subtareas
  paralelas.

## API

- `POST /qaap/api/agent-conversations` con `fanOut?: boolean`.
- `PATCH /:id/task-plan {summary?, subtasks:[{id?, title, prompt}]}`, solo en `awaiting-approval`.
- `POST /:id/task-plan/run`, `POST /:id/task-plan/run-single`, `POST /:id/task-plan/cancel`.

## Pruebas

- Specs: parser del bloque y heurística (shared-core), composición y escritura con git real, máquina de
  estados del servicio con store falso.
- e2e: `scripts/qaap-task-plan-fanout-e2e.mjs`. Usa la receta de `qaap-task-to-pr-e2e.mjs` (backend local,
  `qaiq` falso, remote bare, stub de GitHub) y prueba: plan mostrado → editado → N hijas en paralelo (≥ 2
  `streaming` a la vez, cada una en su worktree) → un PR cuyo árbol tiene los ficheros de todas.

## Fuera de este corte

- Traza de la ejecución en el run store de Workflows (`adoptRun`).
- Subtareas con dependencias (DAG). Hoy todas son independientes y paralelas.
- Re-planificar tras un fallo de una hija. Hoy el integrador recibe el fallo y decide.

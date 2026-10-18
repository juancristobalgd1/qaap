# Qaap competitive roadmap (vs Capy.ai / Ona)

Octubre 2026. Objetivo: igualar la **fiabilidad asíncrona** ("lanzo una tarea, me olvido, vuelve bien") y el **aislamiento** de Capy y Ona, y explotar nuestras ventajas: mobile-first, multi-agente real (13 agentes) e IDE completo.

Principio rector: fiabilidad antes que paralelismo. No paralelizar agentes que todavía se caen.

## Estado (17 oct 2026)

Revisado contra producción (VPS Contabo `161.97.69.219`) y master. La primera versión de este
documento daba por pendientes cosas que ya estaban hechas; quedan marcadas abajo.

| Hito | Estado | Dónde |
|---|---|---|
| H0.1 Deploy rápido | 🟡 En revisión. El pipeline GHCR ya existía (~25 min push→sirviendo). Se añaden pull rootless en paralelo + reintentos, rollback en un comando, huella SSH fijada, y capas Docker estables (el VPS baja ~71 MB por deploy en vez de 457 MB). "≤5 min" no es realista: el build de la imagen tarda ~10 min | #272, #273 |
| H0.2 Rotar secret de GitHub | ⏸ Manual, lo hace el dueño | — |
| H0.3 Smoke E2E post-deploy | 🟡 En revisión. Turno real read-only con token tras cada deploy; señala rojo (no bloquea: la release ya sirve) y apunta al rollback. Sin la parte de preview | #274 |
| H1.1 Turnos sobreviven reinicios | 🟢 Casi hecho: auto-resume, drain en el deploy y backend por tenant ya existían; prod con 0 reinicios y 0 OOM del kernel en 14 días (VPS con 23 GB). Falta el test que mata el backend a mitad de turno | — |
| H1.2 Preview fiable | ❓ Sin medir. Varias correcciones entraron en sep/oct (#208, #239, #253, #254) | — |
| H1.3 Salud por agente | 🟡 Parcial: estados instalado/conectado/activado, conexión para cada harness, detección de Copilot exit 0. Falta "último turno" por agente y test por tipo de fallo | — |
| H2.1 C1-full | ✅ Hecho (12 jul, activo por defecto). Prod reporta `agentUidPerUser` y backend aislado por tenant | — |
| H2.2 Sandbox por tarea | 🟢 Activo en producción desde el 17/10/2026 (`QAAP_TASK_SANDBOX=1`, modo broker): cada tarea corre en su propio contenedor `qaap-task-*` con su propio PID y red, devcontainer si lo hay, y se destruye tras el linger. E2E del broker en el daemon rootless del VPS: 14/14, 2 tareas en paralelo en el mismo puerto, arranque 2,8–5,5 s. Agent smoke post-deploy en producción servido por un sandbox: arranque 8,0 s en frío, turno completado en 33 s, sandbox eliminado tras el linger. Pendiente: verificar 2 tareas en paralelo con preview desde la UI — ver `doc/qaap-task-sandbox.md` | #282, #283, #284, #287 |
| H3.1 Camino único por defecto | 🟢 Tarea → plan visible y editable → N subtareas en paralelo → integración → un PR con evidencia. Un pedido multi-paso (≥ 3 pasos en lista, o `fanOut: true`) empieza con un turno de plan de solo lectura; la tarjeta del plan (editar, Run por defecto, auto-run a los 60 s) lanza una conversación hija por subtarea, cada una en su worktree y su sandbox, visibles en vivo en mission control ("Subtask k/N"); un turno integrador del padre fusiona sus commits (`merge-tree`) tras su checkpoint pre, así que verificación, revisor y `QaapTaskPullRequestService` abren un solo PR. Tareas de un paso, como antes (`QAAP_TASK_FANOUT=auto` por defecto). e2e en el gate pre-deploy. Falta: dependencias entre subtareas (DAG) y traza en el run store de Workflows. Diseño: `doc/qaap-task-plan-fanout.md` | #286, H3.1 fan-out |
| H3.2 PR con evidencia | 🟢 Cuerpo del PR con resumen, diffstat, checks, veredicto del revisor y capturas (`refs/qaap/evidence/<conv>`); rojo → draft + etiqueta `qaap: needs attention` + carril "Needs you". e2e con stub de GitHub en el gate pre-deploy. Falta validarlo contra GitHub real (ref de evidencia, enlaces raw, draft por GraphQL) | #286 |
| H3.3 Mission-control por defecto | ✅ Hecho (8 jul): flag retirado y vista vieja borrada | — |
| H3.4 E2E contrato senior | 🟡 Suite de 10 tareas (bugfix/feature/refactor) con oráculos ocultos por el camino de conversación por defecto, tope de coste por suite, workflow nocturno opt-in. Falta cargar el secret `QAAP_BENCHMARK_ANTHROPIC_API_KEY` (con límite de gasto) y la primera cifra | #285 |
| H4.1 Entradas externas | ⏳ Sin empezar | — |
| H4.2 Pulido móvil | 🟡 Arnés reproducible `scripts/qaap-transcript-scroll-perf.mjs` (backend real + agente falso en streaming, 375×812, CPU 4×). Arreglados: el tirón de scroll (el anchor deshacía el gesto del lector: 16–21 escrituras/10 s → 0; 80 gestos recorrían 180–450 px → ~3000 px), tres congelaciones de la respuesta en vivo (ids de traza que cambiaban bajo los deltas, inanición del worker de markdown, bloque de respuesta nunca montado), layouts forzados por parche y el worker de markdown que esbuild no empaquetaba. fps streaming/scroll/reposo 7,0/6,1/5,2 → 13,7/12,7/10,3. **60 fps aún no**: queda el recálculo de estilo por `:has()` (~3 s/10 s; sin `:has()` 28/19/24 fps), un panel desconectado que re-renderiza cada tick y ~20 rAF por frame | este PR |

Hallado de paso: el relay de ingress de un tenant con backend pausado acumulaba healthchecks
colgados hasta su límite de PIDs (#275).

## Fase 0 — Desbloqueos rápidos (~1 semana)

| Hito | Qué | Hecho cuando |
|---|---|---|
| H0.1 Deploy rápido GHCR | CI construye imagen → GHCR → VPS hace pull + restart | Merge a master llega a prod en ≤5 min sin pasos manuales; rollback a la imagen anterior con un comando |
| H0.2 Rotar secret de GitHub | Revocar el antiguo, cargar el nuevo | Secret viejo revocado, nuevo en GH secrets y VPS, ausente de historial y logs |
| H0.3 Smoke E2E post-deploy | Script lanza un agente real (QAIQ) en un repo de prueba, espera al fin del turno y verifica que el preview responde | Corre automático tras cada deploy; si falla, bloquea el deploy y alerta |

## Fase 1 — Fiabilidad de ejecución (2–3 semanas)

| Hito | Qué | Hecho cuando |
|---|---|---|
| H1.1 Turnos sobreviven reinicios | Tuning de memoria (límites del contenedor, heap de Node, concurrencia de agentes) | Matar el backend a mitad de turno lo reanuda sin perder output; 0 OOM en 7 días de uso real; test que reproduce el reinicio |
| H1.2 Preview fiable | Arreglar bug A (widget oculto/suspendido) y bug B (crash al hidratar, `process is not defined`) | 20 apps generadas seguidas (Vite, Next, tipo Lovable) muestran preview al primer intento, en móvil y desktop |
| H1.3 Matriz de salud por agente | Estado visible por agente: auth, versión CLI, último turno OK/fallido, chip de acción (Sign-in / Actualizar) | Los 13 agentes tienen detección de errores clasificada, sin falsos "OK" (caso Copilot exit 0); un test por tipo de fallo |

**Métrica de fase:** >95 % de turnos terminan sin intervención manual (medido en prod durante 1 semana).

## Fase 2 — Aislamiento real (3–4 semanas, solapada con el final de la Fase 1)

| Hito | Qué | Hecho cuando |
|---|---|---|
| H2.1 Completar C1-full | Fases 2–5: uid por usuario aplicado en ficheros, procesos, terminales y preview | Suite de tests demuestra que el usuario A no puede leer, escribir ni ver procesos o puertos de B; pasa en CI |
| H2.2 Sandbox efímero por tarea | Cada tarea en su propio worktree y entorno de procesos; devcontainer si el repo lo tiene, si no imagen base; se destruye o archiva al terminar | 2 tareas sobre el mismo repo corren a la vez sin conflictos de ficheros ni puertos; arranque del sandbox ≤30 s |

## Fase 3 — Flujo estrella tarea → PR (~3 semanas)

| Hito | Qué | Hecho cuando |
|---|---|---|
| H3.1 Camino único por defecto | Tarea → plan (visible y editable) → N subtareas en sandboxes → verificación → revisor adversarial → PR. Cierra el review y el trigger UI de Dynamic Workflows y la Fase B de ADR-002 | Desde la Work Hub, un usuario nuevo lanza una tarea y recibe un PR sin tocar nada más |
| H3.2 PR con evidencia | Resumen, checks, veredicto del revisor, capturas o vídeo del preview | 100 % de los PRs generados llevan evidencia; veredicto rojo bloquea el PR y lo marca "needs attention" |
| H3.3 Mission-control por defecto | Fase 4 pendiente: flip del flag y limpieza | Flag retirado, código viejo borrado; la vista Work muestra N tareas paralelas con estado en vivo en móvil |
| H3.4 E2E del contrato senior con LLM real | Benchmark de ~10 tareas reales (bugfix, feature, refactor) | Se ejecuta cada noche y registra la tasa de éxito |

**Métrica de fase:** >70 % de las tareas del benchmark acaban en PR mergeable sin edición humana.

## Fase 4 — Entradas y pulido (~2 semanas)

| Hito | Qué | Hecho cuando |
|---|---|---|
| H4.1 Entradas externas | Lanzar tareas desde un issue de GitHub (label o `@qaap`) y desde Slack o Linear; aviso al terminar (push móvil + mensaje en el origen) | Un issue etiquetado genera un PR enlazado sin abrir la app |
| H4.2 Pulido móvil | Eliminar el tirón de scroll del transcript; backlog de render incremental #1–#3 (cola del markdown, fila de agente, timeline) | Scroll a 60 fps en teléfono de gama media durante un turno en streaming, medido con la receta de instrumentación existente |

## Fuera de alcance de este ciclo

- Nuevos agentes o integraciones de modelos.
- Adoptar un Theia más nuevo (salvo fallo de seguridad).
- Funciones nuevas en el IDE.

## Calendario orientativo (~10–12 semanas)

| Semana | Trabajo |
|---|---|
| 1 | Fase 0 |
| 2–4 | Fase 1 |
| 3–6 | Fase 2 |
| 7–9 | Fase 3 |
| 10–11 | Fase 4 |

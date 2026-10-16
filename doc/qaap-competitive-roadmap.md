# Qaap competitive roadmap (vs Capy.ai / Ona)

Octubre 2026. Objetivo: igualar la **fiabilidad asíncrona** ("lanzo una tarea, me olvido, vuelve bien") y el **aislamiento** de Capy y Ona, y explotar nuestras ventajas: mobile-first, multi-agente real (13 agentes) e IDE completo.

Principio rector: fiabilidad antes que paralelismo. No paralelizar agentes que todavía se caen.

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

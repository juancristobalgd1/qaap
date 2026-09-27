[CLOSED]

# Debug session: preview-per-section

## Objetivo

Verificar si la preview del navegador integrado es global/compartida o aislada por proyecto/sección, y corregir interferencias entre 2+ proyectos (puertos/estado/hot-reload).

## Hipótesis (falsables)

1. Existe un único “preview service” singleton a nivel app que enruta TODAS las secciones al mismo host/puerto (estado global compartido).
2. El lifecycle “start/stop” de la preview está acoplado a la sección activa, por lo que cambiar de sección destruye y recrea la preview (pierde estado).
3. Los watchers/hot-reload están registrados globalmente y reaccionan a cambios de cualquier workspace/proyecto, disparando refresh en previews ajenas.
4. El mecanismo de asignación de puertos o ID de preview no es por-sección (p. ej. usa un puerto fijo o un único registro), causando colisiones al abrir 2+ proyectos.
5. Cerrar un proyecto ejecuta un “dispose” global (no scoped) que termina procesos/servidores de otras previews activas.

## Evidencia

- Backend: `QaapDevPreviewPortRegistry` + `/qaap-preview/:previewId/` ya aíslan por `(user, workspace, project, conversation, process)`. Logs `[qaap-preview] reserved|superseded|current claim|released`.
- Work Hub embedded: `previewRuntimeByConversationId` / `embeddedPreviewByConversationScopeId` cachean un iframe por sección.
- Classic IDE widget: un tab **por proyecto** (`QaapPreviewWidgetKey` = workspaceId + projectId). No por conversación: un tab por chat inundaría el IDE.
- Fuga real: Work Hub `resumePreview` llamaba `mini-browser.openUrl` **sin key** → widget legado singleton. Dos proyectos compartían el mismo iframe.
- Segunda fuga: `fetchCurrentProjectClaimUrl` caía a `/api/current` **sin** `conversationId` y podía montar el claim de una sección hermana.

## Estado

- Descubrimiento: hecho
- Instrumentación: `[qaap-preview] open widget` / `current claim` (sectionId, previewId, port)
- Reproducción: tests de URI, hub key, claim scope, `/api/current?conversationId=`
- Análisis: hecho
- Fix: hub resume keyed; sin fallback unscoped; `/api/current` devuelve `conversationId`
- Verificación (desktop/móvil): tests de paquete; preview local tras `build:browser`

## Contrato tras el fix

- Dos proyectos → dos tabs de mini-browser (nunca el URI legado).
- Dos secciones del mismo proyecto → dos claims/puertos; el transcript no adopta la hermana.
- Resume / F5 en un proyecto reabre **su** tab, no el de otro proyecto.

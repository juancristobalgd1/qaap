[OPEN]

# Debug session: preview-per-section

## Objetivo

Verificar si la preview del navegador integrado es global/compartida o aislada por proyecto/sección, y corregir interferencias entre 2+ proyectos (puertos/estado/hot-reload).

## Hipótesis (falsables)

1. Existe un único “preview service” singleton a nivel app que enruta TODAS las secciones al mismo host/puerto (estado global compartido).
2. El lifecycle “start/stop” de la preview está acoplado a la sección activa, por lo que cambiar de sección destruye y recrea la preview (pierde estado).
3. Los watchers/hot-reload están registrados globalmente y reaccionan a cambios de cualquier workspace/proyecto, disparando refresh en previews ajenas.
4. El mecanismo de asignación de puertos o ID de preview no es por-sección (p. ej. usa un puerto fijo o un único registro), causando colisiones al abrir 2+ proyectos.
5. Cerrar un proyecto ejecuta un “dispose” global (no scoped) que termina procesos/servidores de otras previews activas.

## Evidencia requerida

- Logs con: sectionId/projectId, previewId, puerto asignado, start/stop/dispose, eventos de file-change y a qué preview afectan.

## Estado

- Descubrimiento: pendiente
- Instrumentación: pendiente
- Reproducción: pendiente
- Análisis: pendiente
- Fix: pendiente
- Verificación (desktop/móvil): pendiente

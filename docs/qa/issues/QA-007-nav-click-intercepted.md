## «Back to Work Hub» no clickeable — interceptado por `<h1>` del transcript

**Prioridad:** Media  
**Labels sugeridos:** `bug`, `ux`, `mobile`, `priority:medium`, `qa`

### Descripción

En vista transcript (desktop/móvil ancho), el botón **Back to Work Hub** no recibe clicks: el pointer event lo intercepta el `<h1>` del título de la tarea (`Mockup · Figure out how to…`).

### Pasos para reproducir

1. Abrir transcript de cualquier tarea en Mockup
2. Intentar click en «Back to Work Hub» (browser automation o dedo)

### Resultado esperado

- Navegación inmediata a Work Hub

### Resultado actual

```
Click target intercepted by non-interactive text element: <h1>
Blocking element ref: e52
```

### Criterios de aceptación

- [x] Botones de nav workbench siempre por encima del contenido scrollable del transcript
- [x] `pointer-events: none` en título sticky o padding/z-index corregido
- [x] Test accesibilidad: botón nav alcanzable vía click y teclado (`rioja-ui-flow-eval` gate `backToWorkHub`)

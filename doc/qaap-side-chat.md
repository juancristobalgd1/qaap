# Side chat en el panel derecho de la Work Hub

Estado: fases 0-3 en la rama `feat/work-hub-harness-round2` (PR #534). Es una conversación rápida abierta junto a la
tarea que está en el área principal, sin salir de ella.

## Uso

- Pestaña «Side chat» del panel derecho (escritorio). Su composer tiene un selector de harness y modelo.
- El primer envío crea la conversación. El título de la pestaña es ese primer mensaje, recortado.
- «Context from · {tarea}» muestra la tarea padre. Su prompt y su última respuesta van como contexto del primer
  turno, nunca en la burbuja ni en el transcript principal.
- El selector empieza con el harness y el modelo que muestra el composer principal. Si no hay ninguno fijado,
  con el harness de la tarea padre.
- En la barra lateral, la fila lleva una marca «Side». Al abrirla, se muestra en el área principal como
  cualquier otra conversación.

## Datos

- Conversación normal con dos campos extra: `origin: 'side-chat'` y `sideChatParentId` (id de la tarea padre).
- `sideChatParentId` es solo una referencia. No es el enlace de fan-out de planes (`parentConversationId`).
- Creación: `POST /qaap/api/agent-conversations` con `origin`, `sideChatParentId`, `message` (texto del usuario tal
  cual) y `contextPreamble` (opcional, ≤8000 caracteres; más largo responde 400). El servidor lee el padre con la
  misma búsqueda y el mismo control de propiedad que las rutas GET. Si el padre no existe o no es del usuario, el
  campo se descarta y la conversación se crea sin padre. Un `origin` distinto de `side-chat` no marca nada.
- `contextPreamble` se guarda en el primer mensaje del usuario como campo oculto (`QaapAgentMessage.contextPreamble`),
  nunca en `content`, en el título ni en la conversación. `buildPromptExtracted` lo antepone al prompt del turno; los
  reintentos (Retry) y las reanudaciones del mismo turno lo reutilizan. Ninguna vista lo renderiza.
- Conversaciones creadas antes de ese campo tienen el preámbulo dentro del texto: el render lo recorta
  (`stripSideChatPreamble`, también anidado) y el título de la lista sale de la primera pregunta.
- Si el padre es a su vez un side chat, el contexto es su raíz (cadena de `sideChatParentId`, como máximo 3 saltos).
- Resumen (`toConversationSummary` y `conversationToSummary`) expone `origin` y `sideChatParentId` a la barra lateral.
- Helpers puros, sin DOM: `packages/qaap-shared-core/src/common/qaap-agent-conversation-side-chat.ts`
  (validación del padre y del preámbulo, preámbulo de contexto acotado a 5000 caracteres, recorte de preámbulos
  antiguos, composición del prompt).
- Vista y modelo: `qaap-work-hub-aux-side-chat-view.ts` y `qaap-work-hub-aux-side-chat-model.ts`.
  El padre y el composer llegan por el host del panel (`QaapWorkHubAuxSideChatHost`).

## Límites

- Una pestaña de side chat a la vez en el panel.
- No se restaura tras recargar: el panel no guarda el id de la conversación. La conversación sigue en el servidor
  y se puede abrir desde la barra lateral.
- Sin pills de herramientas: solo la línea «Used N tools».
- El composer usa la misma estructura y clases que el principal. Su pill es el mismo `populateAgentToolbarButton`.
  No tiene bloque de acceso en el picker (no aplica). El adjunto «+» está visible pero solo explica en la barra de estado que no hay adjuntos.
- Solo escritorio. En móvil y en el IDE no hay panel derecho.
- El contexto del padre es una foto del momento de la primera pregunta. Los turnos posteriores del padre no se
  reenvían.
- Borrar un side chat borra la conversación del servidor (con confirmación). Cerrar la pestaña no borra nada.
- Bring back abre la conversación en el área principal y cierra la pestaña; el panel queda con el lanzador.
- El `contextPreamble` viaja en la respuesta JSON al propio dueño (no se renderiza, pero no es secreto).

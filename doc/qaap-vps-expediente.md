# Expediente de fallos de Qaap en producción (VPS)

Producción: `https://161.97.69.219.sslip.io`. QA hecha por agentes Haiku en el navegador como usuario real (cuenta `jcristgd`); diagnóstico con logs del VPS y el código. Cada entrada dice qué pasa, por qué pasa y cómo se resuelve.

Estados: **Resuelto** (desplegado y verificado), **Desplegado** (en producción, sin verificar del todo), **Abierto**.

## Resumen

| ID | Problema | Severidad | Estado |
|---|---|---|---|
| E-01 | El backend del usuario se mata a sí mismo al gestionar la preview | Bloqueante | Resuelto (#349) |
| E-02 | Un backend caído no se recupera: 502 permanente | Bloqueante | Resuelto (#349) |
| E-03 | Bucle de 403 en socket.io tras reiniciar un backend | Alta | Desplegado (#350) |
| E-04 | Un temporal huérfano bloquea la creación de tareas (503) | Bloqueante | Desplegado (#351), pendiente de recreación del backend |
| E-05 | Respuesta vacía del modelo: el transcript muestra JSON crudo | Alta | Abierto |
| E-06 | BYOK no muestra dónde poner la API key | Alta | Abierto |
| E-07 | Dev server huérfano en el sandbox al sustituir la preview | Media | Abierto |
| E-08 | Errores de arranque y de backend se muestran como "took too long to start" | Media | Abierto |
| E-09 | El agente por defecto (OpenCode · Big Pickle) agota su cuota gratuita y se cuelga en silencio | **Bloqueante** | PR abierta (fallo rápido); la cuota y el agente por defecto siguen abiertos |
| E-10 | "New agent" no crea un chat nuevo en el proyecto activo | Alta | Abierto |
| E-11 | Al cargar se abre una sesión de otro proyecto | Alta | Abierto |
| E-12 | Contador del estado del turno incoherente | Media | Abierto |
| E-13 | Sondeo excesivo del cliente y SSE reconectando en bucle | Media | Abierto |
| E-14 | Conflicto de `index.lock` en los snapshots de OpenCode | Media | Abierto |

## E-01 · El backend se mata a sí mismo con la preview

- **Síntoma:** spinner indefinido y luego "The application took too long to start". Contenedor `qaap-backend-*` en `Exited (1)`.
- **Causa:** el forwarder del sandbox hace que el propio backend escuche en el puerto de la preview. `terminateListenersOnPort` mandaba SIGTERM a quien escuchaba en ese puerto (el backend) y a su grupo de procesos. Lo disparaban tanto la sustitución de una preview como el limpiador automático de previews antiguas, sin acción del usuario.
- **Solución:** guards `isSelfOrUnsafeSignalTarget` / `canSignalProcessGroup` en `qaap-shared-core` (#349).
- **Verificación:** log en producción `refusing to signal own process listening on port 5173` y el backend sigue vivo con 0 reinicios.

## E-02 · Un backend caído no se recupera

- **Síntoma:** `502 {"error":"Tenant backend unavailable","detail":"socket hang up"}` en todas las llamadas, para siempre.
- **Causa:** el relay `qaap-ingress-*` sigue vivo y el proxy recibe un hang-up en vez de un error de conexión, así que nunca descarta el backend guardado. Además, sin política de reinicio.
- **Solución:** un hang-up antes de la respuesta descarta el target y reintenta una vez los GET/HEAD; `RestartPolicy on-failure` (#349).

## E-03 · Bucle de 403 en socket.io

- **Síntoma:** cientos de `403 {"code":4,"message":"Forbidden"}` en `/socket.io`; arranque lento o incompleto.
- **Causa:** cada backend genera un token de conexión nuevo al arrancar; el control plane lo cachea una vez y sigue mandando el viejo.
- **Solución:** un 403 de socket.io o del upgrade WebSocket descarta el target, y el siguiente sondeo captura el token nuevo (#350).

## E-04 · Temporal huérfano bloquea las tareas

- **Síntoma:** health del backend en 503 con `agentStorage.writeFailed: true`; `create()` responde 503 a todas las tareas nuevas.
- **Causa:** `writeJsonAtomic` nombraba el temporal `{file}.{pid}.{contador}.tmp`; el backend siempre es pid 7 y el contador vuelve a 0 al arrancar. Un crash dejó `index.json.7.11.tmp`, así que la escritura nº 11 de cada arranque fallaba con EEXIST, y nada volvía a escribir.
- **Solución:** sufijo aleatorio, reintento en EEXIST, limpieza de temporales del mismo pid anteriores al arranque, error registrado y reintento automático a los 5 s (#351).
- **Pendiente:** el backend de `jcristgd` se recreará con la imagen de #351 cuando terminen sus turnos activos; entonces debe desaparecer el huérfano.

## E-05 · Respuesta vacía: JSON crudo en el transcript

- **Síntoma:** el transcript muestra `{"type":"step_start"…}` / `{"type":"step_finish"…}` en vez de una respuesta.
- **Causa:** el modelo `opencode/big-pickle` devolvió 6 tokens y nada de texto; `parseOpencodeLog` (`qaap-shared-core/src/common/qaap-opencode-stream.ts`) usa `getDisplayText() || log` y, sin texto, enseña el registro crudo.
- **Solución propuesta:** tratar "sin texto" como turno vacío o fallido, con mensaje claro y reintento o modelo de reserva. Revisar también `qaap-cli-transcript-stream.ts`.

## E-06 · BYOK no muestra la API key

- **Síntoma:** la sección BYOK de Settings enseña ajustes del editor o "Notifications/Privacy"; no hay campos de clave, proveedor ni modelo.
- **Causa probable:** la sección filtra el editor de preferencias con la búsqueda `ai-features` (`mobile-work-hub-preferences-sheet.ts`) y ese filtro no deja visibles los ajustes de IA. Por confirmar.
- **Pista nueva (24 oct):** en producción el frontend registra `[qaap-user-ai-settings] tenant AI preference provider is not bound; AI settings are not persisted per user` (`qaap-user-ai-settings-sync.ts:49`). Es decir, el proveedor de preferencias `User` no está envuelto por `QaapTenantAiUserPreferenceProvider`. El envoltorio se instala con `onActivation` en `qaap-product-bindings-frontend-module.ts:62`. Hipótesis: el proveedor `User` se activa antes de que ese hook esté registrado, o se resuelve por un alias que el hook no intercepta. Consecuencia: los ajustes de IA de cada usuario (incluida la API key de BYOK) no se guardan por usuario. Confirmar con un arranque local con sesión de tenant.

## E-07 · Dev server huérfano en el sandbox

- **Causa:** al sustituir una preview servida desde el sandbox, el terminate local ya no mata al backend, pero tampoco llega al dev server dentro del sandbox. Además, un `osProcessId` del sandbox está en otro espacio de pids y no debe señalarse localmente.
- **Solución propuesta:** enrutar el terminate al exec server del sandbox.

## E-08 · Mensajes de error que no explican nada

- **Síntoma:** con el backend caído, el usuario solo ve "The application took too long to start" y un Retry que no sirve.
- **Solución propuesta:** distinguir un 502 o 503 del backend de un arranque lento y mostrar el motivo.

## E-09 · El agente por defecto se cuelga en silencio al agotar su cuota

- **Síntoma** (QA 24 oct, 00:56–01:11 UTC, chat nuevo en `qaap` con "Levanta la app"): 15 minutos en bucle "Starting the agent…" → "The agent didn't respond in time" → "Task restarted", con 0 tokens. Nunca hay texto, herramientas ni preview.
- **Evidencia:**
  - Log de OpenCode en el sandbox: `stream error providerID=opencode modelID=big-pickle … AI_APICallError: Free usage limit reached. Subscribe to OpenCode Go to keep going`, en cada intento desde las 00:34.
  - La salida de la tarea que lee Qaap (`agent-tasks/owners/jcristgd/<task>.log`) tiene **0 bytes**.
  - El proceso `opencode run` sigue vivo 13 minutos después del error, al 5 % de CPU y sin hijos.
  - El registro de tareas muestra que todas las de OpenCode desde las 00:33 terminan `cancelled` o `interrupted` (una tras 20 min, el `IDLE_TASK_TIMEOUT_MS`).
- **Causa:**
  1. Big Pickle (OpenCode Zen, gratis) tiene un límite de uso gratuito y en producción está agotado; probablemente lo comparten todos los usuarios porque salen por la misma IP.
  2. Con `--format json`, OpenCode 1.18.28 no escribe el error en stdout ni en stderr (solo en su log interno) y **no termina** tras el error.
  3. Qaap no recibe nada: el clasificador de fallos (`qaap-agent-failure-message.ts`) no tiene evidencia, el servidor solo corta a los 20 min, y el watchdog del cliente cancela y relanza el turno contra la misma cuota agotada, en bucle.
  4. Además, `QUOTA_PATTERNS` no reconoce el texto "Free usage limit reached".
- **Solución propuesta:**
  1. Lanzar OpenCode con `--print-logs --log-level ERROR` (plantilla en `qaap-shared-core/src/common/qaap-builtin-agents.ts:28`) para que el error llegue a stderr y al log de la tarea.
  2. Añadir `/\busage\s+limit\s+reached\b/i` (o similar) a `QUOTA_PATTERNS`.
  3. Fallo rápido: si stderr trae un `stream error` terminal (`AI_RetryError: Failed after N attempts` o un error de cuota), matar el proceso y cerrar el turno como `quota`, con mensaje claro, sin esperar 20 minutos.
  4. En un fallo de cuota, no relanzar el mismo modelo: pasar a otro agente o modelo (por ejemplo QAIQ con la clave BYOK del usuario) o pedir al usuario que elija.
  5. Producto: no dejar como agente por defecto un modelo gratuito con cuota compartida; elegir uno según lo que el usuario tenga conectado.
- **Agravante:** con E-06, un usuario nuevo tampoco puede poner su propia clave en BYOK. Hoy un usuario nuevo **no tiene ningún agente que funcione**.
- **Hecho (PR `fix/opencode-quota-fast-fail`):** puntos 1 a 3 de la solución.
  - Plantilla con `--print-logs --log-level ERROR`.
  - Patrones `usage limit reached` / `free usage limit` en `QUOTA_PATTERNS`.
  - `qaap-opencode-fatal-error.ts` detecta el `stream error` de cuota o de límite del turno principal (`small=false`) en stderr. El runner escribe `[qaap] OpenCode reported: …`, mata el proceso y la tarea queda `failed` con motivo `quota`.
  - `agentTurnQualifiesForModelFallback` ya no cambia de modelo en silencio ante un fallo de cuota sin salida, porque el fallo rápido lo habría activado.
  - `parseOpencodeLog` no pinta como respuesta las líneas de log.
- **Verificado en el VPS (24 oct, 01:28 UTC):** `opencode run --format json --print-logs --log-level ERROR -m opencode/big-pickle` en el sandbox escribe en stderr `timestamp=… level=ERROR … message="stream error" … small=false … error.error="AI_APICallError: Free usage limit reached…"`. Sin el arreglo, el proceso no termina (`timeout` → exit 124, 0 bytes en stdout).
- **Sigue abierto:** el punto 4 (ofrecer otro agente con un clic) y el 5 (agente por defecto). Mientras Big Pickle esté sin cuota, el usuario verá un error claro en segundos en lugar de un cuelgue, pero seguirá sin un agente que funcione hasta arreglar E-06 o cambiar el agente por defecto.

## E-10 · "New agent" no abre un chat nuevo

- **Síntoma:** con un proyecto activo, "New agent" del panel lateral (probado por ref, coordenadas y JS) no cambia la vista; el "+" junto al proyecto abre una sesión antigua. Solo funcionó "⋮ → New Chat" tras cambiar el proyecto desde el selector de la cabecera.
- **Causa:** por investigar en `qaap-work-hub` (handler de "New agent" en el panel de proyectos).

## E-11 · Al cargar se abre una sesión de otro proyecto

- **Síntoma:** en 3 de 3 cargas se abrió una sesión de `shadcn-landing-page` con "Working", aunque el usuario estaba en un chat de `qaap`. El chat en curso no se reabre.
- **Causa:** por investigar; contradice la regla de superficie al recargar (`.cursor/rules/work-hub-reload-default.mdc`).

## E-12 · Contador del turno incoherente

- **Síntoma:** "didn't respond in time… 12m 49s" y un minuto después "Starting the agent… 9m 35s", sin reinicio visible.
- **Causa probable:** el reloj mezcla el inicio de la tarea relanzada con el de la original tras cada "Task restarted" (E-09).

## E-13 · Sondeo excesivo y SSE en bucle

- **Síntoma:** más de 2.000 peticiones por pestaña en unos 20 minutos: `agent-approvals`, `agent-conversations/<id>`, `agent-tasks/all` y `POST agent-tasks/warm` varias veces por segundo, más `qaap-dev/api/probe/<puerto>` para una decena de puertos. `agent-conversations/stream` se reconecta cada pocos segundos con `ERR_ABORTED` y el mismo `lastEventId`.
- **Impacto:** carga en el servidor y batería en móvil; con muchos usuarios, riesgo de saturar el backend.
- **Causa:** por investigar (temporizadores de sondeo del Work Hub y reconexión del stream).

## E-14 · Conflicto de `index.lock` en los snapshots de OpenCode

- **Evidencia:** `failed to add snapshot files … Unable to create '…/opencode/snapshot/…/index.lock'` en casi todas las ejecuciones.
- **Causa probable:** varias ejecuciones de OpenCode (o una colgada) comparten el mismo directorio de snapshots en `XDG_DATA_HOME`; la colgada de E-09 deja el lock tomado.
- **Solución propuesta:** directorio de datos por tarea, o limpiar el lock al matar la tarea.

## Rondas de QA

- **Ronda 1 (23 oct):** la app no arrancaba (E-01, E-02).
- **Ronda 2:** 403 en bucle (E-03), JSON crudo (E-05), BYOK (E-06).
- **Ronda 3, build `2396aee`:** carga, socket.io y preview resueltos; BYOK sigue.
- **Ronda 4, build `22b61e3`, "Levanta la app" en `qaap`:** bloqueado por E-09; nuevos E-10 a E-14.

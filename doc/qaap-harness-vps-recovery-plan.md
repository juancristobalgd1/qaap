# Plan de recuperación: harnesses y modelos en el VPS

Estado: IMPLEMENTADO Y DESPLEGADO. Fecha: 2026-09-21.

La corrección de Codex ya está compilada, publicada y activa en el VPS. La
verificación visual muestra `Not connected on this workspace` y `Connect`
cuando el CLI está instalado pero no existe una sesión de usuario. El gate de
lanzamiento del VPS todavía requiere crear los backups iniciales y ejecutar la
prueba de aislamiento con dos tenants antes de considerarlo completamente
cerrado desde el punto de vista operativo.

Este documento es el traspaso para un modelo de menor coste y conserva el checklist completo. La implementación actual ya verificó que el backend del tenant devuelve `codex login status: Not logged in`; está aplicando la separación entre CLI instalado, sesión propia y acceso hospedado. Al continuar, siguen vigentes las autorizaciones anteriores de commit, push a origin/master y actualización del VPS.

## Resultado que necesita el usuario

El usuario debe poder conectar su propia cuenta de un harness desde Work Hub, seleccionar un modelo admitido por ese harness y trabajar en el VPS. Un ejecutable instalado no demuestra que haya una cuenta conectada. La suscripción del proveedor (por ejemplo, la cuenta de Codex) y el plan comercial de Qaap son estados distintos.

La corrección anterior NO completó este objetivo: consiguió mostrar modelos, pero los deshabilitó y no verificó una ejecución real. No repetir esa definición de éxito.

## Evidencia ya obtenida: no repetir la investigación completa

Repositorio local: `C:\Users\Personal\qaap`, rama `master`, HEAD `d117df8b688ea6211a33625a28889c0044397941`. El árbol estaba limpio antes de crear este documento.

VPS: `root@161.97.69.219`, repositorio `/opt/qaap`, clave local `C:\Users\Personal\.ssh\qaap-vps-deploy`. Sitio: `https://161.97.69.219.sslip.io/`. Workspace observado: `/workspace/repos/users/juancristobalgd1/octocat/Hello-World`.

Hay cuatro problemas demostrados:

1. **Bloqueo inventado en el fallback del navegador.** `CODEX_FALLBACK_MODELS` en `packages/qaap-mobile-shell/src/common/qaap-agent-task-client.ts` asigna `available: false` a todas las entradas cuando el endpoint devuelve una lista vacía. La UI convierte ese valor directamente en `disabled` y `Locked`.
2. **La facturación clasifica por nombre de modelo, sin identificar quién aporta la cuenta.** `isHostedCodexUsage(agentId, modelId)` en `packages/qaap-cloud-workspace/src/common/qaap-billing-plans.ts` identifica como uso hosted cualquier modelo del catálogo comercial de Codex. Se usa para bloquear la selección, rechazar el inicio del turno y descontar créditos. Quitar solamente el atributo `disabled` no resolvería el problema.
3. **Falta un estado real de conexión.** `QaapAgentTaskRunner.listAgents()` usa la detección del ejecutable. El helper de `qaap-agent-task-runner-utils3.ts` asigna `available: true` a los CLIs detectados. El picker muestra `Connect` cuando `entry.available === false`. Por tanto, actualmente un CLI instalado sin login puede aparecer conectado, y uno ausente puede aparecer como si solo necesitara login. La comprobación anterior de Hermes con `Connect` no demuestra detección de autenticación.
4. **El despliegue deja el backend del usuario en una versión vieja.** Hay dos daemons Docker: el del host y el rootless usado por los tenants. `preload_tenant_image()` en `scripts/qaap-vps-update.sh` termina si el nombre de imagen ya existe; no comprueba si es la versión nueva. `tenantBackendContainerMatches()` en `qaap-docker-orchestrator.ts` compara `Config.Image` con el nombre configurado; reutilizar `qaap-theia:local` no garantiza actualización. Las peticiones autenticadas se enrutan al backend del tenant mediante `qaap-tenant-backend-proxy.ts`.

Lecturas realizadas en el VPS el 2026-09-21 (los nombres de contenedor son evidencia, no objetivos permanentes para scripts):

| Elemento | Evidencia |
| --- | --- |
| Principal `qaap-theia-1` | `QAAP_BUILD_SHA=d117df8b688e` |
| Imagen del host `qaap-theia:local` | `sha256:1f250e94e2bd98b552671bc70f72064b3aa36016e16355fc67765879eebeebad` |
| Imagen rootless `qaap-theia:local` | `sha256:d332598e93a23d3f98d95582c56fb00b6736cd0380742737fb94bb673fb25aab` |
| Backend rootless `qaap-backend-7626afe0dd16` | `QAAP_BUILD_SHA=31d0f3241269`, imagen `d332...`, creado `2026-09-21T06:28:42Z` |
| Código compilado de ese backend | Aún usa `filterModelsForHostedPlan(...)`, que elimina las entradas de Codex |
| Worker rootless `qaap-tenant-eb4aa042231a` | `unhealthy`, 720 fallos consecutivos de healthcheck; causa todavía no investigada |

La lectura `id` por `docker exec` en el backend rootless devolvió uid 0 dentro del contenedor. Eso no demuestra root del host: preservar el aislamiento existente y verificar el usuario/contexto efectivo del proceso que ejecuta el harness. No convertir esto en un refactor de seguridad ajeno al problema.

**CI ya publica imágenes.** El workflow `.github/workflows/qaap-vps-deploy.yml`, ejecución [35571345235](https://github.com/juancristobalgd1/qaap/actions/runs/35571345235), completó el gate, la publicación y la verificación de imagen para `d117df8b6`. Falló únicamente `Deploy over SSH` con `dial tcp ... i/o timeout` antes de ejecutar el script remoto. No atribuir ese fallo de CI a los backups.

Imagen publicada de aquella versión:

```text
ghcr.io/juancristobalgd1/qaap:d117df8b688ea6211a33625a28889c0044397941@sha256:7a4f031edae4d68f83d268a9fa5fbc9a0468de7cbb4fd241ea54324a36434332
```

Esta imagen contiene la corrección incompleta: sirve como evidencia de que existe el canal de distribución, no como solución final. No desplegarla como si completara este plan.

El despliegue manual anterior compiló otra imagen en el VPS y acabó con servicios principales sanos, pero el launch gate dio **6 passed, 3 failed**: instalación del backup inicial, ausencia de archivos de backup y ausencia de dos tenants de prueba. Stripe no configurado fue una advertencia adicional. No describir los tres FAIL como pruebas aprobadas o meras advertencias. Su reparación completa es trabajo separado salvo que impidan el despliegue necesario.

## Comportamiento esperado

| Situación | Picker y acción |
| --- | --- |
| Harness desactivado por el usuario | No se ofrece en el composer |
| Harness activado, ejecutable ausente | Estado de instalación; acceso a Harness/instalación, no un login que fallará |
| Instalado y requiere login, sin sesión | `Not connected` y botón `Connect` que abre su terminal de login |
| Instalado y sesión propia válida | Modelos admitidos seleccionables aunque el plan Qaap no incluya modelos financiados por Qaap |
| Credenciales inválidas/caducadas | `Connect`/reconectar con motivo legible; invalidar estado cacheado |
| QAIQ sin claves de proveedor | `Add BYOK` y acceso directo a Configuration → BYOK |
| OpenCode con modelos gratuitos públicos | Permitir esos modelos sin obligar a login; otros proveedores respetan su autenticación |
| Estado de conexión desconocido por error/timeout | Mensaje de comprobación fallida y `Retry`; no inventar conectado o desconectado |
| Uso elegido y respaldado por credenciales de Qaap | Aplicar el plan y créditos de Qaap con explicación y acción pertinente |

Un catálogo no determina autenticación, y un modelo configurado no prueba que la cuenta tenga acceso a él. Los rechazos reales del proveedor deben mostrarse como tales, con una acción de recuperación.

## Secuencia de ejecución

### 1. Fijar contexto y cerrar las incertidumbres con lecturas breves

- Leer `AGENTS.md`; comprobar HEAD, árbol y workflows en curso. Preservar cambios ajenos. Los SHA anteriores pueden haber cambiado: volver a leer solo las versiones actuales, no repetir el historial.
- Identificar el backend de la sesión mediante labels y la ruta del proxy; inspeccionar ambos Docker. Un `docker ps` del host no enumera los tenants rootless.
- Registrar por componente: referencia inmutable de imagen, revisión, estado y mounts persistentes. No volcar `.env`, cookies, tokens ni archivos de credenciales.
- Leer el healthcheck y su salida del worker `unhealthy`, y determinar si ese worker participa en el flujo actual. Corregirlo dentro del flujo solo si es necesario; no ocultar el estado.
- En el contexto efectivo de login Y de ejecución del agente, comprobar versiones y ayuda de CLIs instalados, usuario, `HOME`, `CODEX_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` y mounts. Verificar qué rutas deben ser escribibles. No probar autenticación desde el home del administrador para inferir la del usuario.
- Revisar las órdenes de status/login de las versiones instaladas. Para Codex el código ya propone `codex login --device-auth`; comprobar `login --help` y `login status` sin ejecutar un login. Usar documentación oficial solo si la ayuda del CLI no resuelve el contrato. No adivinar comandos de otros harnesses ni iniciar una llamada LLM para sondear su estado.
- Salida de esta fase: una tabla pequeña por harness instalado: autenticación admitida, comprobación de estado disponible y ubicación de datos. No desplegar aún.

### 2. Separar instalación, conexión y origen de credenciales

- Mantener compatible `available` para consumidores antiguos; dejar de usarlo como prueba de login.
- Añadir un contrato común explícito, preferentemente `packages/qaap-mobile-shell/src/common/qaap-agent-connection.ts`, para evitar dependencias circulares (cloud ya depende de mobile):
  - `installed: boolean` y `enabled: boolean`.
  - `connectionState: 'connected' | 'disconnected' | 'not-required' | 'unknown'`.
  - `authSource: 'user-session' | 'user-api-key' | 'public' | 'qaap-hosted' | 'none'`.
  - Acción `connect | byok | install | retry` y motivo tipado cuando corresponda.
- Implementar `QaapAgentConnectionService` como servicio DI en cloud/node, con adaptadores por harness. Registrar la dependencia en `qaap-cloud-workspace-backend-module.ts`.
- Probes limitados (por ejemplo timeout 5 s, caché 15 s por tenant/agente/contexto, concurrencia máxima 3), sin bloquear el proceso con `spawnSync` al abrir el menú. No lanzar comandos interactivos como probes. Existencia del binario o de un archivo vacío no equivale a sesión válida.
- Reutilizar el ejecutor/contexto de tenant de `qaap-tenant-spawn-service.ts` y `qaap-docker-orchestrator.ts`. Los probes, login y ejecución deben coincidir en identidad, configuración y almacenamiento persistente.
- Exponer un endpoint autenticado complementario de estado de conexiones, por ejemplo `GET /qaap/api/agent-tasks/agent-connections`, y un refresco explícito acotado. Registrar rutas estáticas antes de `/:id`. Resolver propietario desde autenticación; no aceptar un tenant arbitrario enviado por el cliente. La respuesta nunca incluye secretos.
- Separar el estado del catálogo: no esperar a todos los probes para mostrar todos los modelos. Un fallo de un harness no debe romper los demás.

### 3. Corregir conjuntamente selección, inicio de tarea y facturación

- Eliminar la asignación incondicional `available: false` de `CODEX_FALLBACK_MODELS`. No reemplazarla por acceso gratuito universal.
- Centralizar el catálogo de Codex para frontend/backend siguiendo el patrón de los catálogos comunes de Hermes/OpenClaude. Evitar dos listas que vuelvan a divergir. Contrastar los IDs con el CLI instalado; los nombres existentes no prueban soporte actual. Nunca interpretar stderr como modelos ni convertir fallos HTTP en un catálogo válido.
- El servidor debe resolver el origen efectivo de credenciales. Una elección del cliente puede expresar preferencia, pero no autorizar `user-session` o `qaap-hosted` por sí sola.
- Aplicar las restricciones de modelos financiados por Qaap solamente a ejecuciones que realmente utilizan esa fuente. Para sesión propia, validar la conexión del usuario; conservar las cuotas de cómputo de Qaap que sean independientes del pago al proveedor.
- Usar la misma resolución en estos lugares:
  1. `qaap-agent-task-runner-render2.ts`: `listModelsForAgentExtracted`.
  2. `qaap-agent-task-endpoint.ts`: `handleListAgentModels` y su fallback; no permitir que el fallback eluda la política.
  3. `qaap-agent-task-runner-timeline2.ts`: control previo a ejecución.
  4. `qaap-agent-conversation-store-activity2.ts`: `debitHostedUsage`.
  5. `qaap-billing-plans.ts`: clasificación `isHostedCodexUsage` y sus consumidores/pruebas.
- Persistir en la tarea el origen de credenciales decidido por el servidor al inicio para que el cobro final use esa misma fuente. Tratar tareas antiguas sin el campo de forma compatible y conservadora; no reclasificar retroactivamente ni descontar créditos nuevos por una inferencia.
- No resolverlo activando Pro para todos, deshabilitando facturación global o copiando credenciales del administrador. Si no existe una vía real de credenciales Qaap-hosted, no inventarla como parte de esta reparación.

### 4. Conectar el estado real con el picker y la terminal

- Cargar estados en el picker sin perderlos al combinar snapshots HTTP/WebSocket. Revisar `listQaapComposerPickerAgents`, los helpers de merge, `QaapAgentTaskAgentOption` y `QaapAgentPickerSearchEntry`.
- En `mobile-projects-sticky-composer-sheets-ui-timeline.ts`, renderizar según el contrato anterior, no según `entry.available`.
- En `mobile-projects-sticky-composer-sheets-ui-activity.ts`, usar motivos reales para disponibilidad. `Locked: requires Qaap plan` no debe describir una cuenta del proveedor desconectada.
- Mantener el flujo existente: `openAgentSignInTerminalExtracted` en `mobile-projects-panel-timeline.ts` → `launchAgentTuiInTranscriptTerminalExtracted` en `mobile-projects-transcript-surfaces-ui-live-status.ts` → comando de login verificado. Reutilizar esta terminal, no crear otra arquitectura de login.
- Revisar la discrepancia entre `qaap-agent-auth-login.ts`, que considera varios harnesses sin login dedicado como BYOK, y `openAgentSignInTerminalExtracted`, que abre TUI para todos salvo QAIQ. Resolver por capacidades reales de cada CLI instalado.
- Tras login, refrescar estado al volver al picker y ofrecer refresco explícito. Invalidar caché también tras un fallo de autenticación; no exigir F5 ni reiniciar el servidor. No depender solo del cierre de la terminal: el usuario puede dejarla abierta después del login.
- Comprobar todas las entradas: composer principal, conversación existente, menús con búsqueda y pickers secundarios. Una CTA sin callback o sin proyecto debe mostrar recuperación útil, no hacer silencio.
- Reutilizar la apertura directa de Configuration → BYOK y localizar todo texto nuevo con `nls`.

### 5. Reparar la publicación de la imagen que realmente ejecuta la sesión

- Usar imágenes inmutables por SHA/digest para principal y tenants. Para la release, pasar de forma explícita `QAAP_THEIA_IMAGE` y `QAAP_TENANT_DOCKER_IMAGE` al mismo candidato verificado. Un `.env` con el antiguo `qaap-theia:local` no puede prevalecer silenciosamente.
- En `scripts/qaap-vps-update.sh`, asegurar que el daemon rootless tenga el candidato exacto antes de enrutar tráfico nuevo. Si el registro requiere autenticación y rootless no la tiene, reutilizar la imagen ya verificada del host mediante transferencia de imagen o credenciales temporales limitadas; no crear credenciales permanentes ni exponerlas en logs.
- Para un tag local mutable admitido por herramientas de desarrollo, comparar identidad efectiva/revisión, no solo existencia. Evitar depender de que `docker pull qaap-theia:local` encuentre una imagen privada que solo existe localmente.
- En `qaap-docker-orchestrator.ts`, validar referencia inmutable/identidad esperada para backends y workers; invalidar cachés `tenantBackendTargets` cuando cambie la versión esperada. Revisar tanto `tenantBackendContainerMatches` como la validación de workers.
- Actualizar los tenants administrados que correspondan conservando exactamente sus mounts persistentes. Comprobar tareas/terminales activas antes de reemplazarlos y usar la política de drenaje disponible; no forzar una recreación que pierda trabajo activo ni borrar homes, repositorios o volúmenes. Si hace falta interrumpir una sesión activa, reportar el impacto concreto.
- Registrar/verificar revisión del backend autenticado, no solamente `/qaap/api/auth/config` del principal. Una vista `healthy` del principal no demuestra que el usuario haya recibido el cambio.

### 6. Pruebas antes de publicar

Iterar primero con compilación de paquetes y pruebas de comportamiento. Antes de la entrega, ejecutar el compile y build de navegador requeridos por AGENTS.md. No ejecutar TypeScript fuente con tsx/ts-node.

Pruebas mínimas que detectan las causas reales:

- Instalado + desconectado → `Connect`; sesión propia válida → modelos seleccionables con plan Starter; desconocido/timeout → `Retry` sin falso login.
- `Connect` abre el comando correcto en el contexto del tenant; refrescar tras autenticación permite seleccionar sin recargar.
- Cuenta propia inicia la tarea sin bloqueo de modelos hosted ni débito de créditos de proveedor Qaap; cuenta Qaap-hosted conserva restricciones y débito. Ambos mantienen las cuotas de ejecución aplicables.
- Credenciales de dos tenants no se mezclan; refrescar uno no cambia el otro. Probar con fixtures/mock, sin crear cuentas externas de pago.
- OpenCode: error EROFS/stderr nunca se presenta como modelo; modelos públicos no exigen login. Comprobar la escritura en los directorios de estado en un contenedor de prueba, sin hacer el rootfs entero escribible como atajo.
- Tag de imagen igual pero contenido/revisión distintos → detectado; referencia inmutable coincidente → reutilización segura; reemplazo conserva mounts; principal nuevo con tenant viejo → verificación de despliegue falla.
- Catálogo HTTP que falla conserva error/Retry; catálogo válido con usuario conectado es seleccionable. El fallback no puede ocultar un fallo de backend.

Extender pruebas existentes donde corresponda:

```text
packages/qaap-mobile-shell/src/common/qaap-agent-task-client.spec.ts
packages/qaap-mobile-shell/src/common/qaap-agent-auth-login.spec.ts
packages/qaap-mobile-shell/src/browser/qaap-agent-picker-search.spec.ts
packages/qaap-mobile-shell/src/browser/mobile-projects-transcript-surfaces-ui.spec.ts
packages/qaap-cloud-workspace/src/node/qaap-agent-task-runner-model-catalog.spec.ts
packages/qaap-cloud-workspace/src/common/qaap-billing-plans.spec.ts
packages/qaap-cloud-workspace/src/node/qaap-docker-tenant-runner.spec.ts
packages/qaap-cloud-workspace/src/node/qaap-tenant-backend-proxy.spec.ts
```

Añadir pruebas específicas de conexión y origen de credenciales, y una prueba del preload con Docker simulado. No limitarse a comprobar que hay cuatro filas en la UI.

Comandos locales para las comprobaciones finales (las pruebas Mocha deben apuntar a `lib/` ya compilado):

```powershell
npm run compile
node scripts/qaap-drift-check.js
npm run build:browser
# Iniciar solamente si no hay ya un servidor utilizable en 3000:
npm run start:browser
```

Hacer una verificación de navegador con estados de sesión propia y sin conexión, idealmente en un entorno Linux/container equivalente al tenant. Local Windows sin autenticación de Qaap no cubre el fallo del VPS. No repetir toda la suite tras cada cambio pequeño; repetir solo lo afectado hasta preparar un candidato final.

### 7. Publicar una release candidata y reutilizarla

- Agrupar las correcciones coherentes y verificadas. `git diff --check`, revisar diff y status; commit y push a `origin/master` solo cuando estén listas. No hacer cinco pushes de parches especulativos que lancen cinco pipelines.
- Usar el workflow existente para generar el candidato por digest. Ese pipeline hace sus propios builds de gate e imagen; no prometer que internamente solo compila una vez. El objetivo es una release candidata y **cero compilaciones del proyecto en el VPS**.
- Consultar el estado compacto del workflow y sus fallos concretos, sin volcar logs enteros ni mantener consultas frecuentes durante un build sin novedades.
- Si vuelve a fallar únicamente SSH después de publicar/verificar, reutilizar ese mismo digest por la conexión SSH local que ya funciona. No relanzar todo el workflow y no volver a compilar en el VPS. No cambiar firewall ni secretos de GitHub como atajo.
- Plantilla para el despliegue futuro, con SHA/digest reales del NUEVO candidato, después de corregir el script y su propagación a tenants:

```text
cd /opt/qaap
./scripts/qaap-vps-update.sh --branch master --revision <SHA_COMPLETO> --image <REFERENCIA_GHCR_CON_DIGEST>
```

Los marcadores son valores a sustituir; no ejecutar el comando literalmente. El script de la revisión corregida debe estar presente en `/opt/qaap`; comprobar árbol remoto y actualizarlo sin sobrescribir cambios del operador. No ejecutar la variante sin `--image`, porque inicia un build completo.

- Si fallan gates, conservar el resultado exacto. No usar `skip_gate`, no borrar evidencia ni ampliar esta tarea a configurar pagos. Si el servicio se actualizó pese al fallo, reportar ambas cosas de forma separada y verificable.

### 8. Aceptación final en la sesión real del VPS

1. Verificar que principal, backend autenticado y worker que ejecuta el harness usan la revisión esperada. Revisar logs del backend al que realmente llegan las peticiones.
2. Sin cuenta conectada, Codex muestra `Connect` y abre su login en la terminal correcta. El usuario completa el login interactivo y cualquier paso de autenticación que requiera su participación; el agente nunca inventa credenciales ni confirma un login que no ocurrió.
3. Tras login propio, los modelos permitidos se pueden seleccionar y enviar. Ejecutar una única tarea mínima de humo con el modelo accesible de menor coste, sin modificar archivos del proyecto. Recibir una respuesta real valida mucho más que `healthy`, un checkmark o una lista renderizada.
4. El uso de cuenta propia no descuenta créditos de proveedor Qaap. Verificar por aserciones/tests y registros de uso sin exponer secretos. Mantener las cuotas independientes de cómputo.
5. Reabrir el picker y recargar: estado de sesión y selección permanecen; login, ejecución y persistencia coinciden en el mismo contexto. Validar persistencia tras recreación mediante test/candidato o ventana controlada, sin reiniciar producción solo para obtener una captura.
6. QAIQ sin clave lleva a BYOK. OpenCode muestra modelos válidos, no errores del sistema. Los otros harnesses instalados muestran estado de conexión coherente con sus adaptadores.

Si no hay credenciales disponibles para una ejecución real, completar código, pruebas, despliegue y comprobaciones posibles; dejar explícitamente pendiente el login del usuario y la prueba real. **No declarar resueltos los harnesses solo porque los modelos ya se ven.**

## Entrega y límites para el ejecutor

- Entrega breve: SHA, digest, revisión del backend de la sesión, resultado de selección/login/ejecución real y cualquier bloqueo restante. Mantener un registro de avance por fase para no rehacer trabajo tras un cambio de modelo.
- No comenzar con otro build remoto. No cambiar la cuenta del usuario a Pro. No quitar todos los bloqueos ni eliminar la facturación. No instalar/actualizar indiscriminadamente CLIs. No copiar `lib` a mano dentro de contenedores de producción como solución permanente.
- No modificar otros cambios visuales de Settings/sidebar ni paquetes upstream. No convertir la tarea en una reescritura de CI o en una reparación general de backups/Stripe.
- No crear otra tarea ni cambiar de modelo automáticamente. El usuario pidió dejar este plan preparado y elegir cuándo ejecutarlo.

Texto para activar este trabajo más adelante:

> Ejecuta el plan de `doc/qaap-harness-vps-recovery-plan.md`. Empieza por comprobar la revisión del backend real del tenant. Corrige conexión, selección y facturación juntas; verifica antes de hacer un solo push final y despliega una imagen publicada por digest sin compilar el proyecto en el VPS. No declares éxito hasta comprobar el flujo funcional, o especifica claramente si falta que yo complete el login.

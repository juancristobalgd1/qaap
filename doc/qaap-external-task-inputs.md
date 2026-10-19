# Entradas externas de tareas (H4.1)

Estado: implementado para GitHub detrás de `QAAP_EXTERNAL_TASKS_GITHUB` (apagado por defecto), octubre 2026.
Slack y Linear vienen después, detrás de la misma interfaz.

Objetivo: lanzar una tarea de Qaap sin abrir la app y avisar al terminar. Un issue con la etiqueta `qaap`,
o un comentario que empieza por `@qaap`, abre una conversación en el backend del usuario que lo pidió.
Esa conversación termina en un PR enlazado al issue (`Closes #N`, con el flujo de `doc/qaap-task-to-pr.md`).
Al requester se le avisa de dos formas: con un comentario en el issue y con un push móvil.

## Piezas

```
GitHub ──webhook firmado──▶ plano de control: /qaap/api/github/webhook
                                │  1. firma HMAC sobre el cuerpo crudo
                                │  2. QaapGithubExternalTaskSource.parse → disparo o "ignorado"
                                │  3. QaapExternalTaskIntake: dedup de entrega, requester, allowlist, límites
                                ▼
                 ┌─ modo compartido: in-process
                 └─ backend por tenant: POST /qaap/api/external-tasks/intake
                    (aserción de tenant + firma HMAC del cuerpo con el secreto del tenant)
                                ▼
           QaapExternalTaskLauncher (backend dueño de las conversaciones)
                                │  4. opt-in del repo, permiso push con el token del requester, clon existente
                                │  5. crea la conversación (o añade un mensaje a la del issue)
                                ▼
           QaapTaskPullRequestService (sin cambios de política) → PR "Closes #N"
                                ▼
           QaapExternalTaskNotifier → comentario en el issue + web push al requester
```

La interfaz común es `QaapExternalTaskSource` (`qaap-cloud-workspace/src/common/qaap-external-task.ts`).
Cada fuente traduce su evento a un `QaapExternalTaskRequest` normalizado:

- fuente;
- repo;
- número, título, cuerpo y URL del issue;
- requester y autor;
- id de entrega.

Cada fuente también sabe responder en su origen (`postStatus`). Slack y Linear añadirán una fuente más, sin
tocar el intake, el launcher ni el notifier.

## Por qué webhook y no polling

Las dos opciones caben en un solo VPS sin infraestructura nueva. Se elige el webhook por estas razones:

- **Ya existe la ruta pública** `/qaap/api/github/webhook` en el plano de control, que el proxy de tenants
  deja pasar (`isControlPlanePath`), con su secreto `QAAP_GITHUB_WEBHOOK_SECRET`. Solo hacía falta arreglar
  la firma, que se calculaba sobre `JSON.stringify(req.body)` y no sobre los bytes que firma GitHub.
- **La latencia es de segundos**, frente a 1 min de polling.
- **No gasta cuota de API** del token del usuario sin actividad.
- **El polling necesitaría** que el plano de control conociera los repos con opt-in. Esos viven en el
  SQLite de cada tenant.

Coste: el operador configura el webhook (o una GitHub App) en cada repo u organización. Ver "Puesta en marcha".

## Quién puede disparar una tarea

El **requester** es quien hace la acción: el `sender` del evento, es decir, quien puso la etiqueta o escribió
el comentario. No es el autor del issue. El cuerpo del issue siempre es dato no confiable, lo haya escrito
quien lo haya escrito.

Se acepta el disparo solo si se cumple todo esto:

1. **Evento admitido**:
   - `issues` con acción `labeled` y etiqueta `qaap`, sin distinguir mayúsculas;
   - `issue_comment` con acción `created` en un issue (no en un PR), cuyo cuerpo empieza por `@qaap`.

   Se ignoran los senders de tipo `Bot` y los comentarios que llevan nuestro marcador
   `<!-- qaap:external-task -->`.
2. **Usuario de Qaap con sesión.** El requester tiene una sesión de GitHub en Qaap (token en
   `QaapGithubSessionStore`). Si no, no hay token con el que actuar.
3. **Repo en la allowlist del operador.** Se aplica si existe `QAAP_EXTERNAL_TASKS_REPO_ALLOWLIST`, una
   lista separada por comas de `owner/repo` o `owner/*`.
4. **Opt-in explícito de ese usuario para ese repo**, hecho desde la app y nunca desde un comentario. Se
   guarda en el mismo almacén que el consentimiento de PR (`QaapTaskPullRequestConsentStore`), en un ámbito
   distinto (`external-github:`). Activarlo también concede el consentimiento de PR de ese repo: sin él, la
   tarea se quedaría en `awaiting-consent` y no habría PR.
5. **El webhook solo dispara; la verdad la da la API de GitHub.** Hay un único secreto global de webhook y
   lo conoce cada admin que lo configura, así que con él se podría forjar un payload con `sender` = otra
   persona. Por eso, antes de despertar a ningún tenant, el plano de control confirma los hechos con el
   token del propio requester (`QaapGithubExternalTaskSource.verify`):
   - el repo, ligado por `repository.id` y no por nombre;
   - el permiso de push real (`permissions.push`). Un usuario con rol triage puede etiquetar pero no
     empujar, así que no puede lanzar trabajo que no podría hacer él mismo;
   - que existe un evento `labeled qaap` hecho por el requester;
   - que el comentario `@qaap` es suyo, tiene el mismo texto y no fue editado (`created_at == updated_at`);
   - que el título y el cuerpo del issue coinciden con la instantánea firmada. Si cambiaron, se rechaza con
     "issue editado".
6. **Autor del texto con permiso de escritura.** El código del agente llega a una rama del propio repo, no a
   un fork, y el CI de esa rama corre con los secretos del repo **antes** de cualquier revisión humana. Por
   eso el texto de un issue solo se convierte en prompt si su autor es el requester o tiene
   `author_association` `OWNER`, `MEMBER` o `COLLABORATOR`. Si el autor es otra persona, el requester tiene
   que copiar la petición en su propio comentario `@qaap …`. Abrir el PR desde un fork del requester queda
   para más adelante.
7. **Clon ya existente** en el workspace del requester (`resolveOwnedRepositoryCwdForLogin`). No se clona
   nada de forma implícita.

Respuesta en cada caso: **nunca un comentario en el issue**, porque eso diría públicamente que ese login usa
Qaap y convertiría el webhook en un oráculo.

- **Fallan 2 o 3, o GitHub no confirma la petición** (posible falsificación): solo se registra en el log.
- **Fallan el opt-in, el push, el autor, la edición o el clon:** el requester recibe un web push que explica
  qué hacer.

## Límites

| Límite | Defecto | Variable |
|---|---|---|
| Tareas por requester y hora | 10 | `QAAP_EXTERNAL_TASKS_MAX_PER_HOUR` |
| Tareas externas activas por requester | 3 | `QAAP_EXTERNAL_TASKS_MAX_ACTIVE` |
| Tareas por repo y hora | 20 | `QAAP_EXTERNAL_TASKS_MAX_PER_REPO_HOUR` |
| Tamaño del texto citado (título + cuerpo + comentario) | 8 KB | — |
| Entregas recordadas para dedup (`X-GitHub-Delivery`) | 24 h | — |

Además:

- **Orden.** Los límites y la deduplicación se aplican en el plano de control **antes** de despertar el
  contenedor del tenant. La autoridad de la deduplicación es la tabla durable del tenant (`external-tasks`
  en el SQLite de conversaciones); la del plano de control es solo una caché.
- **Una conversación por (repo, issue).** Un `@qaap` posterior de un requester autorizado entra como
  mensaje de seguimiento en la misma conversación, y el PR se actualiza (mismo flujo que un segundo turno).
- **Coste:** se aplica la cuenta de facturación del requester, la misma que en la app. Las tareas pasan
  por el sandbox por tarea (`QAAP_TASK_SANDBOX`) y por el fan-out (`QAAP_TASK_FANOUT`) igual que una tarea
  de la Work Hub.

## El issue es entrada no confiable

- **El primer mensaje lleva un preámbulo fijo** y después cita el título, el cuerpo y el comentario dentro de
  un bloque con una valla más larga que cualquier racha de backticks del texto, así que no se puede cerrar
  desde dentro. El preámbulo dice al agente que eso son datos escritos por `@autor` en GitHub, que solo
  describen el cambio pedido, y que no siga instrucciones sobre herramientas, credenciales, variables de
  entorno, red, otros repositorios o el propio preámbulo.
- **Nosotros no descargamos** enlaces ni imágenes del issue.
- **El agente nunca tiene el token** (`doc/qaap-github-token-boundary.md`) y corre en su sandbox. Lo peor
  que puede hacer un issue envenenado es proponer código malo. Ese código llega como PR, que pasa la
  verificación, el revisor adversarial y una revisión humana antes de merge. Si el veredicto es rojo, el PR
  queda en draft con la etiqueta `qaap: needs attention`.
- **Los comentarios de Qaap en el issue no llevan texto del agente**, solo estado y enlaces (PR, tarea). Así
  un issue público no puede usar la respuesta del agente para sacar datos. El cuerpo del PR mantiene las
  reglas de repos públicos de `doc/qaap-task-to-pr.md`.
- **Instantánea del texto.** El texto que se usa es el del payload firmado, comprobado contra GitHub en el
  momento del disparo. Nunca se vuelve a leer el issue: un seguimiento solo lleva el comentario que lo
  dispara.
- **Siempre en su propio worktree**, nunca en el checkout en el que trabaja el usuario.

## Firma y reenvío

- **Webhook.** HMAC-SHA256 en tiempo constante sobre el cuerpo crudo. La ruta registra su propio parser
  `raw()` y, si llega un cuerpo ya parseado, falla cerrado (401). Sin `QAAP_GITHUB_WEBHOOK_SECRET` responde
  503, salvo en skip-auth local.
- **Ruta del webhook.** Va por delante de cualquier otro middleware. El `json()` global de
  `@theia/filesystem` (upstream) consumía el cuerpo antes. Queda justo detrás de las capas de inicialización
  de Express.
- **Reenvío al tenant.** Lleva dos cosas:
  - una aserción normal de tenant (30 s, con el token, que de paso refresca `QaapGithubOwnerTokenCache` para
    el aviso posterior);
  - `x-qaap-external-task-signature` = `v1.<t>.HMAC(secreto del tenant, "external-task\0" +
    login|entrega|t|sha256(cuerpo))`, válida 60 s.

  El proxy borra esa cabecera del tráfico del navegador, así que un usuario no puede llamar a `/intake` a
  mano aunque lleve una aserción.

## Aviso

`QaapExternalTaskNotifier` observa las conversaciones con `externalTask`:

| Momento | Comentario en el issue | Push |
|---|---|---|
| Arranca | "Qaap is working on this (requested by @x)" + enlace a la tarea | — |
| PR abierto | "Opened #N" (y "needs attention" si es draft rojo) | sí |
| Sin cambios / error / `needs-sign-in` / `awaiting-consent` | estado y qué hacer | sí |

Reglas del aviso:

- Cada estado se avisa una sola vez (`externalTask.notified`).
- El push va solo al login del requester (`QaapWebPushService.notify` con `userLogin`). Sin claves VAPID no
  hace nada, como hoy.
- Los comentarios se publican con el token del requester: GitHub los muestra como suyos, con el marcador de
  Qaap.

## Opt-in

- API (con sesión):
  - `GET /qaap/api/external-tasks/github/opt-in` lista los repos activados;
  - `PUT /qaap/api/external-tasks/github/opt-in/:owner/:repo` activa un repo;
  - `DELETE /qaap/api/external-tasks/github/opt-in/:owner/:repo` lo desactiva.
- UI: menú del proyecto en la Work Hub → "Start tasks from GitHub issues". Solo aparece en proyectos de
  GitHub y con el flag activo.

## Puesta en marcha (operador)

1. Generar un secreto (`openssl rand -hex 32`) y ponerlo como `QAAP_GITHUB_WEBHOOK_SECRET` en el VPS.
2. Poner `QAAP_EXTERNAL_TASKS_GITHUB=1` y, opcionalmente:
   - `QAAP_EXTERNAL_TASKS_REPO_ALLOWLIST`;
   - `QAAP_EXTERNAL_TASKS_AGENT`, el agente de estas tareas. Por defecto se usa el agente por defecto del
     usuario.
3. En cada repo: Settings → Webhooks → Add webhook.
   - **Payload URL:** `https://<host>/qaap/api/github/webhook`.
   - **Content type:** `application/json`.
   - **Secret:** el mismo valor del paso 1.
   - **Eventos:** "Issues" e "Issue comments".
4. Crear la etiqueta `qaap` en el repo.
5. En Qaap, activar el opt-in del repo.

Las variables llegan al contenedor `theia` por `docker-compose.yml`. El plano de control pasa a los backends
de tenant `QAAP_EXTERNAL_TASKS_GITHUB`, `QAAP_EXTERNAL_TASKS_AGENT` y `QAAP_EXTERNAL_TASKS_MAX_ACTIVE`; el
secreto del webhook no sale nunca del plano de control. Si se activa o desactiva el flag, los backends de
tenant se recrean.

**Push móvil en modo por tenant:** hoy no llega. Las claves VAPID no se pasan a los tenants y las
suscripciones se guardan en el tenant. Mientras se arregla, el aviso de una tarea externa es el comentario
en el issue.

## Fuera de este corte

- **PR desde un fork del requester** para aceptar issues de autores sin permiso de escritura, porque los PRs
  de forks no reciben secretos.
- **Escaneo de secretos del diff** antes del push sellado (estilo gitleaks), sandbox sin red salvo registries
  para tareas externas, y una nueva comprobación de push y opt-in justo antes de cada push.
- **Revocar el opt-in** no cancela todavía las tareas en curso.

- **GitHub App con secreto por instalación.** Hoy hay un único secreto global de webhook. Quien lo conozca
  puede falsificar eventos de cualquier repo, pero solo disparan trabajo de requesters que hicieron opt-in
  y tienen permiso push. Por eso el daño queda limitado a tareas que esa persona habría podido pedir.
- **Comentarios `@qaap` en PRs** (revisar o arreglar un PR existente).
- **Slack y Linear.**

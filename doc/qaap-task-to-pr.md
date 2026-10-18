# Task → PR con evidencia (Fase 3: H3.1, H3.2, H3.4)

Estado: plan aprobado el 17 oct 2026. Lo implementan los PRs enlazados en la tabla de estado de
`doc/qaap-competitive-roadmap.md`.

## Qué hay hoy

- **El camino por defecto es el chat.** El composer de la Work Hub hace `POST /qaap/api/agent-conversations/:id/messages`
  y el runner cierra cada turno con este orden: puerta de turno vacío, verificación (`task.verification`) y
  revisor adversarial (`task.review`, `QAAP_AGENT_REVIEW=high-risk` por defecto). Un veredicto rojo deja el turno
  en `completed_with_warnings`.
- **Cada turno ya guarda checkpoints** pre y post en `refs/qaap/checkpoints/<conv>/…`. Son commits sin padre
  hechos con un índice temporal.
- **La captura visual** (`QaapHeadlessVisualCaptureService`) llega de forma asíncrona cuando la conversación queda
  inactiva. Guarda los PNG detrás de auth.
- **El push hospedado ya existe** (`QaapHostedGitPush`): sube un sha cualquiera a un ref, y el token nunca llega al
  agente. **No hay creación de PR en el backend**: hoy el PR solo se crea desde la UI, con la extensión GitHub PR.
- **Dynamic Workflows** (`/qaap/api/workflows`) no tiene UI (se revirtió el trigger), ni nodo PR, ni fan-out, y
  todos sus nodos comparten un mismo cwd. La Fase B de ADR-002 está a medias, detrás de `QAAP_TURN_GRAPH`, que está
  apagado.

## Decisión: terminar el camino del chat, no migrar a Workflows

Se descarta enrutar las tareas por Workflows: costaría semanas e iría contra el camino que usan hoy todos los
usuarios. Lo que se construye es un servicio backend, `QaapTaskPullRequestService` (qaap-cloud-workspace/node),
suscrito a los eventos del store de conversaciones:

1. **Disparo: la conversación queda en reposo**, es decir, idle, sin cola, sin goal-loop y sin auto-continue
   pendiente, durante unos 10 s. No se dispara en cada `applyTaskOutcome`: un turno asentado no significa que la
   tarea haya terminado, y disparar ahí causaría un push por sub-turno.
2. **Árbol del PR a partir de los checkpoints**, no de `git add -A` sobre el checkout vivo. Se hace un
   `git merge-tree --write-tree --merge-base=<pre> <tip del PR | rama base remota> <post>` y luego
   `commit-tree -p <tip>`. Así quedan fuera los cambios sucios del usuario anteriores al turno y otros hilos (el
   segundo hilo sobre el mismo repo ya va a un worktree propio). Si hay conflicto, no se hace push y la tarea queda
   en "needs attention".
3. **Push** a `refs/heads/qaap/task/<convId>` con `QaapHostedGitPush`. El token del dueño se busca por login
   (`QaapGithubSessionStore`). El destino owner/repo se resuelve con el resolver hospedado compartido, nunca a
   partir del `.git/config` que pueda escribir el agente.
4. **Un PR por conversación** (`POST /repos/{o}/{r}/pulls`). Los turnos siguientes suben commits a la misma rama y
   reescriben el cuerpo entre marcadores `<!-- qaap:evidence -->`. Se guarda en `conv.linkedPullRequest`.
5. **Cuerpo con evidencia**:
   - resumen (último mensaje del agente);
   - diffstat;
   - checks (veredicto de verificación, comando e intentos);
   - veredicto del revisor;
   - capturas del preview.
6. **Rojo bloquea**: si hay `success:warned`, `blocked`, conflicto o un fallo de verificación o revisión, el PR se
   abre como **draft**, con la etiqueta `qaap: needs attention` y el prefijo `[needs attention]` en el título. La
   tarjeta de mission control pasa al carril `needs-you`.
7. **Capturas**: cuando llega la evidencia visual, los PNG se suben como commit a un ref que no es de rama,
   `refs/qaap/evidence/<convId>`, para no ensuciar el diff ni la lista de ramas. Se enlazan con
   `https://github.com/o/r/raw/<sha>/<file>` y se actualiza el cuerpo con PATCH. En repos públicos esto está
   apagado por defecto, porque una captura puede filtrar datos.
8. **Flag `QAAP_TASK_PR`, activo por defecto** (`0/off` lo apaga). El servicio no hace nada si no hay token, ni
   remote de github.com, ni cambios, o si la conversación es de solo lectura o plan. Los fallos (token caducado,
   rate limit) se muestran en la conversación; nunca se tragan en silencio.
9. **e2e**: `QAAP_GITHUB_API_BASE_URL` apunta la API a un stub local, y un remote bare local recibe el push. El
   script `scripts/qaap-task-to-pr-e2e.mjs` arranca el backend con el agente mock (con la misma receta que
   `qaap-restart-resume-e2e.mjs`), lanza una tarea y comprueba que sale un PR con evidencia.

## Correcciones tras la revisión (#286)

- **Consentimiento.** "Create PR when done" se puede apagar por conversación desde el menú de la tarea
  (`taskPullRequestEnabled`, PATCH). Antes del primer push hace falta un consentimiento único por usuario y
  repositorio, guardado en el servidor (`QaapTaskPullRequestConsentStore`, SQLite de las conversaciones,
  espacio `task-pr-consent`). Sin él no se sube nada: la conversación queda en `awaiting-consent` ("PR ready:
  allow Qaap to open PRs on owner/repo?") y el menú ofrece Allow / Not now
  (`POST /agent-conversations/:id/task-pull-request/consent`). Los hilos plan/ask y los turnos de solo
  lectura no generan PR.
- **Token en per-tenant.** Ver `doc/qaap-github-token-boundary.md`, "Task pull requests". Se reutiliza la
  aserción HMAC del proxy: el guard guarda el token en memoria (`QaapGithubOwnerTokenCache`).
- **Divergencia.** Antes de cada push se mira la cabeza remota (`ls-remote` sellado). Si otra persona subió
  algo encima de lo nuestro, se trae (bundle sellado) y se construye encima. Si no se puede, se sigue en
  `qaap/task/<conv>-2` con un PR nuevo que dice a cuál sustituye. Se anota en `taskPullRequest.divergence`.
- **Rewind / restore.** Si el último turno empujado desaparece o hay un restore posterior, la rama se
  reconstruye desde la base sin los turnos deshechos y se sube con force-push. El cuerpo lo indica.
- **Fugas.** El asunto del commit es el título solo si el usuario lo puso; si el título sale del primer
  prompt, se usan los ficheros cambiados. En repos públicos el cuerpo no lleva palabras del agente (ni
  resumen, ni salida de checks, ni razonamiento del revisor). En todos, `redactQaapSecrets` quita secretos
  obvios.
- **Veredicto persistido.** Al asentarse el turno, el veredicto (estado, verificación, revisión, bloqueo,
  solo lectura) se guarda en el mensaje del usuario (`turnVerdict`); el task runner queda de respaldo.
- **Reintentos.** Errores de red, 5xx, 429 y 403 por rate limit secundario se reintentan tras 2 s, 8 s y
  30 s (`QAAP_TASK_PR_RETRY_DELAYS_MS`). Los 401 piden volver a iniciar sesión; los 422 no se reintentan.
- **Validación contra GitHub real:** `node scripts/qaap-task-pr-github-validate.mjs --repo owner/scratch`
  (solo `gh`, repo privado de pruebas).

## Fuera de este corte (siguiente)

- **Plan visible y editable y fan-out a N subtareas en sandbox.** Hoy existe como modo `plan` del composer y como
  la plantilla `qaap.plan-then-implement` de Workflows, que no tiene UI. Sigue siendo el resto de H3.1.
- **Vídeo del preview** en el PR.

## H3.4 Benchmark nocturno

- **Se reutiliza** el runner y el scorer que ya existen (`scripts/qaap-agent-benchmark-runner*.mjs`).
- **Novedades**:
  - una suite de 10 tareas reales sobre fixtures pequeños (bugfix, feature, refactor), cada una con su oráculo
    oculto;
  - un adaptador `qaap-conversation` que recorre el camino por defecto (conversación) en vez de Workflows;
  - un tope de coste total por suite (`maxSuiteCostUsd`) que corta las tareas restantes al superarse.
- **Workflow programado** `qaap-agent-benchmark-nightly.yml`:
  - opt-in: solo corre si existe el secret `QAAP_BENCHMARK_ANTHROPIC_API_KEY`;
  - sube los artefactos;
  - añade la tasa de éxito a `report.json` y al resumen del job.

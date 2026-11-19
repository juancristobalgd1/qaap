# Handoff

## 2026-11-19 — Antigravity CLI login en web

**Investigación solo hasta el inicio de OAuth** (`agy` local 1.5.12; `HOME` temporal; sin introducir credenciales, HOME eliminado y proceso terminado):
- `Google OAuth`: indica que se abra el navegador y muestra una URL de `accounts.google.com/o/oauth2/auth`. La URL usa `redirect_uri=https://antigravity.google/oauth-callback`, no localhost. El CLI espera el resultado del navegador y no pide pegar código ni URL de redirección.
- `Use a Google Cloud project` → `Continue with Google Cloud`: genera igualmente una URL de autorización de Google con `redirect_uri=https://antigravity.google/oauth-callback`. Tampoco ofrece un prompt de paste-back; queda esperando la finalización en el navegador.
- Las URLs completas, incluidos `state` y `code_challenge`, se redactaron y no se guardaron. La prueba se detuvo antes de introducir credenciales.

**Decisión:** no añadir inicio integrado de Antigravity en web/móvil: estos flujos no dan al usuario un código ni una URL que pueda devolver al PTY del tenant. En web, el inicio de sesión de Antigravity requiere Qaap Desktop, según el flujo actual. Repetir la investigación si `agy` añade un flujo de código/URL pegable o cambia el callback.

Estado para continuar el trabajo desde otra cuenta o sesión. Actualízalo al cerrar cada tarea: qué queda pendiente, cómo se validó y qué limitaciones conviene conocer. La política de modelos está en la sección «Selección de modelos y orquestación» de `CLAUDE.md`.

## 2026-11-19 — Instancias de harness: sesión, catálogo, uso, hook de Codex y esfuerzo por instancia

Decisiones aplicadas: clave de caché `${instanceId}:${owner}` (la base sigue `${base}:${owner}`); cada instancia tiene su propio estado de sesión, calculado con su sondeo (su binario, su carpeta y sus variables), nunca heredado del base; si el override no valida, la instancia queda sin sesión (`disconnected`) sin caer al base; el uso de una instancia lee su carpeta; el hook de Codex comprueba con el binario de la instancia, y el overlay copia la sesión de la carpeta de la instancia.

Hecho, un commit por subsistema (specs por subsistema, suite completa de `qaap-cloud-workspace` en verde: 4069 passing, 0 failing; `tsc -b`, `qaap-package-graph-check`, `qaap-drift-check` y `qaap-endpoint-ownership-check` en verde):
1. Clave de caché por instancia (`9f555a6d1`): `listAgents` y la caché de modelos nativos usan el id completo; el catálogo de la instancia no comparte entrada con la base (spec `qaap-agent-native-models-instance-cache.spec.ts`).
2. Sondeo de sesión y catálogo de la instancia (`ac202defd`): helper `resolveQaapHarnessLaunchEnvironment` (`qaap-harness-launch-environment.ts`) con plan + `apply(env)`; el sondeo corre con el binario y la carpeta/variables de la instancia; no hereda la credencial de Settings del base; el catálogo de una instancia solo se descubre con su propio spawner (`instanceNativeModelSpawner`), sin spawner nunca usa el binario base; el endpoint de modelos pasa el id de la instancia al catálogo.
3. Uso (`74fec7f80`): `QaapUsageScanTarget.harnessHome` y `QaapUsageScannerRegistry.forHarnessInstance` (escáner y ledger por instancia; sin overrides devuelve el del owner).
4. Hook de Codex (`52c1e0844`): `codexBin` en las opciones del overlay, usado por `codex --version` y `codex app-server`; el runner lo pasa desde el plan.
5. Esfuerzo (`6239348dc`): `QaapAgentEffort.support` resuelve la instancia a su base.

Pendiente, con diseño:
- «Connect» de una instancia: el login corre en la terminal oculta del navegador (`qaap-agent-login-background.ts`, `buildAgentLoginShellCommand` con `env`). Hace falta que el servidor entregue un descriptor ya validado (binario y `CODEX_HOME`/`CLAUDE_CONFIG_DIR` de la instancia) en vez de que el cliente vuelva a validar rutas. Sin ese cambio, el login sigue en el home por defecto. No se ha ejecutado ningún login real.
- Uso: `QaapUsageEndpoint` (GET de uso) necesita un parámetro `harness` y acceso al plan (las preferencias viven en el runner). El registro ya expone `forHarnessInstance`.
- Mejorar prompt y evaluador (`improveComposerPromptExtracted`, `qaap-agent-task-runner-tool-pills2.ts`): hay que confirmar si la petición lleva el id de instancia antes de cablear el binario y el `apply(env)` del plan en `improveEnv`.
- Motivo visible: una instancia con override inválido aparece como sin sesión, pero el motivo (ruta no válida) solo queda en la lógica; falta exponerlo en el selector.
- Invalidación: confirmar que guardar binario o carpeta en Settings limpia las cachés de sondeo de esa instancia (`refreshAgentCatalog`).
- En vivo (Electron): una instancia `Codex 2` con otra carpeta ya autenticada debe mostrarse conectada sin tocar la de la base; un binario inválido debe mostrarla sin sesión.

## 2026-11-19 — Desktop installers (unsigned)

Hecho: instaladores SIN FIRMAR de macOS (dmg arm64/x64), Windows (NSIS) y Linux (AppImage + deb) con electron-builder 26.18.1, workflow `.github/workflows/qaap-desktop-release.yml` y auto-update. Detalle completo en `doc/qaap-desktop-release.md`.

Cómo publicar: crear y empujar el tag `desktop-vX.Y.Z` (o `workflow_dispatch` con el tag). Crea un borrador, sube los 4 runners y lo publica como **pre-release**. Aún no se ha creado ningún tag.

Artefactos: `Qaap-mac-arm64.dmg`, `Qaap-mac-x64.dmg`, `Qaap-win-x64.exe`, `Qaap-linux-x86_64.AppImage`, `Qaap-linux-x86_64.deb` (+ `.blockmap`, `latest*.yml`).

Variables del VPS (válidas cuando una release sea "latest"; mientras sean pre-release, enlazar por tag `releases/download/desktop-vX.Y.Z/<archivo>`):
- `QAAP_DESKTOP_DOWNLOAD_URL_MAC=https://github.com/juancristobalgd1/qaap/releases/latest/download/Qaap-mac-arm64.dmg`
- `QAAP_DESKTOP_DOWNLOAD_URL_WIN=https://github.com/juancristobalgd1/qaap/releases/latest/download/Qaap-win-x64.exe`
- `QAAP_DESKTOP_DOWNLOAD_URL_LINUX=https://github.com/juancristobalgd1/qaap/releases/latest/download/Qaap-linux-x86_64.AppImage`

Auto-update (`qaap-desktop-updater.ts`): Windows y AppImage descargan y ofrecen "Restart to update"; macOS sin firma y `.deb` solo avisan y abren la página de releases; desactivado sin empaquetar. El repo tiene otras releases (`qaap-master-…`), por eso se elige la release `desktop-v*` más alta por la API en vez del feed "latest" de electron-updater.

**PENDIENTE: firmar**
- macOS: Developer ID Application + notarización (`notarytool`); secretos `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `CSC_LINK`, `CSC_KEY_PASSWORD`; target `zip` y fusión de `latest-mac.yml`.
- Windows: certificado de firma de código.
- Entonces: `qaapDesktopSigned: true` (activa auto-update en macOS) y quitar el flag pre-release (workflow + `releaseType`).

Limitaciones / sin verificar: solo se empaquetó y arrancó macOS arm64 en local; los runners Windows, Linux y macOS x64 no se han ejecutado (el workflow no se ha lanzado). `macos-13` está retirado: x64 usa `macos-15-intel`. El `maintainer`/email del deb es `noreply@qaaq.dev` (inventado, revisar). `@electron/rebuild` subió de 4.0.4 a 4.2.1 por electron-builder (lockfile). Plugins: arranque del plugin host verificado, carga de extensiones concretas no.

## 2026-11-18 — Settings → Harness: variables de entorno por harness/instancia (PR #534)

Hecho (specs, tsc, drift y package-graph en verde; sin verificar en vivo):
- Sección «Environment / Variables» en el panel del engranaje, solo en escritorio: filas `NOMBRE = ••••••••` con «Replace» y borrar; «Add variable» con valor en `type=password` y botón mostrar mientras se edita.
- Nombres: `^[A-Z_][A-Z0-9_]{0,127}$` + lista de denegación (`checkQaapHarnessEnvName` en `qaap-harness-launch-settings.ts`, aplicada en frontend, rutas y runner): básicos del proceso, hooks de cargador/intérpretes, `ELECTRON_*`/`LD_*`/`DYLD_*`/`GIT_*`/`SSH_*`/`GH_*`/`QAAP_*`/`THEIA_*`/`XDG_*`, `GITHUB_TOKEN` y las que fija el runner/gate/sandbox (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_SHELL`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `IS_SANDBOX`, `OPENCLAUDE_MAX_RETRIES`, `OPENCODE_PERMISSION`, `OPENCODE_CONFIG_CONTENT`, `HTTP(S)_PROXY`, `ALL_PROXY`, `NO_PROXY`).
- Almacenamiento: los nombres van en `ai-features.harness.settings[id].envNames`; los valores, en el almacén de credenciales del SO mediante el `KeyStoreService` (keytar) de Theia en node, servicio `qaap-harness-environment`, cuenta `<harnessId>/<NOMBRE>` (`QaapHarnessEnvSecretStore`). Si keytar falla, se usa `~/.qaap/secrets/harness-environment.json` (0600, carpeta 0700, escritura atómica). Rutas `GET|POST /qaap/api/agent-tasks/harness-settings/env` y `POST …/env/delete` (404 fuera de escritorio); el GET solo devuelve `name` + `hasValue`.
- Lanzamiento: el runner añade las variables al `env` del spawn justo después de `buildChildEnv` (nunca a la línea de comandos). El runner gana: no se pisa ninguna variable que el runner haya puesto con un valor propio, y el gate, el overlay de Codex y la carpeta de configuración se escriben después. Reintentar, reanudar y el fallback de modelo las conservan (mismo `harnessInstanceId`). «Restore defaults» y «Delete harness» borran también los valores.

Qué verificar en vivo: añadir `ANTHROPIC_API_KEY` en una instancia de Claude y ejecutar un turno; si macOS pide acceso al llavero (la app dev se clona y firma en cada arranque), aceptar o comprobar que se usa el archivo de respaldo; confirmar que en web la sección no aparece; buscar el valor en el log del backend y en `settings.json` (no debe salir).

Limitaciones: si keytar falla una vez, el proceso usa el archivo hasta reiniciar; los valores guardados en el archivo no migran solos al llavero. El sondeo de sesión y la carga de modelos de la instancia no reciben estas variables (usan el entorno del harness base).

## 2026-11-18 — Settings → Harness: engranaje por harness y «Add harness» (PR #534)

Hecho (sin verificación en vivo todavía; specs, compilación, drift y package-graph en verde):
- Engranaje a la izquierda del switch de cada fila: panel inline con nombre visible, ruta del binario y carpeta de configuración (`CODEX_HOME` para Codex, `CLAUDE_CONFIG_DIR` para Claude Code; el resto no ofrece carpeta), «Restore defaults» (built-in) o «Delete harness» (instancia).
- «Add harness»: elige un harness base y crea `<base>#<n>` (n = 2…9). Aparece en la lista tras su base, con engranaje y switch propios, y en el selector del composer (el backend la añade a `listAgents` con la sesión del base). El runner la lanza como el harness base (`task.agentId` = base, `task.harnessInstanceId` = instancia; retry/resume/fallback de modelo la conservan).
- Persistencia en preferencias de usuario: `ai-features.harness.settings` (mapa id → `{label, binaryPath, homeDir}`) y `ai-features.harness.instances`; el switch sigue en `ai-features.harness.disabledAgents`.
- Seguridad: binario y carpeta solo se muestran y se aplican en escritorio (`isQaapHarnessLaunchOverrideRuntime`, mismo criterio que `QaapGithubMcpCredentialResolver.mode()` = `desktop`); en web/VPS/tenant el backend los ignora sin mirar el disco (spec). Ruta absoluta, sin metacaracteres ni `..`, archivo existente y ejecutable (o carpeta existente); se valida al guardar (`POST /qaap/api/agent-tasks/harness-settings/check`, 404 fuera de escritorio) y otra vez al lanzar: si falla, el turno falla en vez de usar otro binario/cuenta. Solo se sustituye el primer token del comando ya construido (entrecomillado); flags de gate/aprobación intactos; el overlay del gate de Codex copia el `auth.json` desde la carpeta elegida.

Qué verificar en vivo (Electron): engranaje y panel en Settings → Harness; guardar un binario inválido muestra el error; una instancia `Codex 2` con otro `CODEX_HOME` ya autenticado ejecuta un turno con esa cuenta y el Tool Gate pide aprobación igual; en web (:3000) el panel solo enseña el nombre.

Pendiente / limitaciones (estado tras la ronda de instancias, ver la sección siguiente):
- «Connect» de una instancia todavía inicia sesión en el home por defecto (ver «Instancias: estado» abajo).
- Los one-shots (mejorar prompt, evaluador) no reciben el id de instancia: usan el `codex`/`claude` base y su entorno.
- El endpoint de uso no acepta todavía un parámetro de instancia (el registro ya lo soporta).
- Modelos personalizados extra por harness: no incluidos (el catálogo nativo sale del CLI y la validación de acceso al modelo lo exige).
- Si el sandbox de tareas en macOS restringe lecturas, una carpeta/binario fuera de las raíces permitidas haría fallar el turno (visible, no silencioso): comprobar en vivo.

## 2026-11-18 (noche) — Prueba de usuario final y arreglos antes de desplegar (PR #534)

Tres rondas de prueba como usuario final en el Electron de prueba (proyecto `qa-e2e-todo`, OpenCode + Beam Free). Arreglado y verificado:
- Graves: Side chat enviaba 409 `dirty_workspace` (ahora `acceptDirty`); volver del IDE reabre conversación, scroll y sidebar; verificación visual ignora 404 implícitos del navegador y es de solo lectura; anotaciones en cola como tarjeta plegada, sin `_qaap_cache_bust` ni selectores.
- Preview: tras un turno se recarga sola y reinicia el dev server gestionado si cambió código de servidor (`qaap-preview-turn-refresh*`, `qaap-project-bootstrap-service-restart.ts`); el reinicio ya no se queda sin `reserved`; límite de 3 redescubrimientos/10 s (el bucle llevaba el renderer a 2,4 GB y lo mataba); Browser vuelve tras IDE → Agents; "Starting preview…" ya no se atasca; bucle de `resize` que mantenía el renderer al 25–30 % de CPU en reposo (ahora 1–3 %).
- Medios/menores: enviar con turno en curso encola y Stop ignora doble toque; aviso de PR como nota neutra (`notice-` trace id); "Commits as Qaap"; contadores unificados (`QaapLiveTaskDiff`, "Changes this turn"); Settings estrecho; diálogo de confianza sin "under development"; "Location"; primeros pasos en el estado vacío; Escape ya no oculta el sidebar en escritorio; Profile muestra la credencial de gh.

Pendiente menor: tras reiniciar el dev server la preview vuelve a la raíz (nuevo hostname); sondeo de puerto ~4/s en `refreshTranscriptPreviewOffer`; posible falso negativo del revisor independiente en cambios de server.js; cambios sin commitear del usuario en `notes-dev` (`public/index.html`, `public/style.css`) mezclados con ediciones de una prueba — decisión del usuario.

## 2026-11-18 (tarde) — Correcciones del usuario sobre escritorio (PR #534)

Hecho y verificado en vivo en el Electron de prueba (HEAD `2d2605ec3`):
- GitHub en escritorio sin sesión de Qaap: repos, PR (lista izquierda, pestaña Pull request y vista central), merge e importación usan la credencial de `gh`/env (`QaapGithubDesktopCredentialSession`, solo modo desktop + skip-auth; token solo en backend). Selector: 59/59 repos.
- Tema System sigue claro/oscuro del SO, también tras elegir un color; Electron recibe `themeSource=system` (`qaap-appearance-mode-service.ts`). Verificado con emulación CDP, no con cambio real de macOS.
- Degradados de scroll en todos los `.dialogContent` (`QaapWorkHubDialogScrollFadesContribution`).
- Settings: botón "Toggle views panel" a la derecha de la cabecera; botón de reabrir el sidebar ya no queda bajo los semáforos de macOS.
- CI: spec del resolutor ya no depende de tener `gh`; tests Playwright upstream que dependían de `@theia/api-samples` ajustados o saltados (output-view, quick-command, toolbar).

Ronda siguiente (HEAD `ce2178ced`, verificado en vivo salvo la landing):
- Settings → Harness: engranaje por harness (nombre, binario y CODEX_HOME/CLAUDE_CONFIG_DIR solo en escritorio) y «Add harness» (instancias `codex#2`…); pendientes de instancias en la sección del agente de harness más abajo.
- Escritorio: el diálogo «Open GitHub repository» oculta Workspace memory; panel derecho del IDE 34 % (440–640 px) si no hay tamaño guardado; cabeceras y barra de pestañas centradas en los semáforos (±0,5 px); el Dock dice «Qaap» (dev arranca desde un clon APFS `node_modules/electron/qaap-dev/Qaap.app`, id `dev.qaaq.desktop.dev`).
- Landing web: enlace «Download the desktop app for …» oculto hasta definir en el VPS `QAAP_DESKTOP_DOWNLOAD_URL_MAC` / `_WIN` / `_LINUX` (https) y reiniciar el backend. No hay instaladores publicados todavía.
- Conversaciones de prueba de notes-dev borradas.

Pendiente: confirmar CI verde de `2d2605ec3`; rendimiento (store de conversaciones ~71 MB, ~1 s por persistencia; stall de 1,1 s al arrancar; avisos de modelos duplicados) para otro PR; borrar o no las dos conversaciones de prueba de notes-dev (decisión del usuario). No hacer merge de #534 sin confirmación.

## 2026-11-18 — Servidor MCP de GitHub gestionado (rama `feat/work-hub-harness-round2`)

**Hecho (commits)**
- `39a38fdeb` credencial de GitHub resuelta por el servidor gestionado; `a3a6fd17a` servidor MCP de GitHub gestionado, de solo lectura; `ff469df2b` arranque bajo demanda; `10e8e1cb3` la entrada GitHub legacy no arranca y queda retirada; `fb41fe62a` la retirada legacy llega también al espejo de settings por usuario; `596ae9be4` la identidad del servidor gestionado no se puede suplantar; `5411fb2ac` chip «Connect GitHub», estado de credencial y rechazo por política; `6db2fd99f` documentación del límite de tokens.

**Verificación en vivo (2026-11-18, Electron de prueba :9334, `npm run build:electron` sin errores)**
- Al arrancar: 0 quick inputs y 0 procesos `server-github`. Captura `/tmp/round2-shots/v6-a-startup.png`.
- Agente GitHub: no aparece en el selector de menciones del composer (solo OpenCode, Claude Code, Codex, Copilot CLI, Cursor Agent, Grok Build, Pi y Antigravity). Escribir «@GitHub» como texto no elige ningún agente. Dos turnos de prueba en Mockup (modelo beam-free) con «list my 3 most recent repositories using the GitHub tools» respondieron con 3 repos, pero con «Run 2 commands» (shell `gh repo list`). No se invocó ninguna herramienta `mcp__qaap-github_*` y el log del backend no contiene «qaap-github» ni arranque del servidor GitHub. Capturas `v6-b-turn-60s.png` y `v6-b-retry-turn.png`.
- Confianza: no apareció «Trust workspace for GitHub». Sí apareció «This workspace has uncommitted changes» en notes-dev (public/index.html, public/style.css); se canceló sin aceptar «Continue here» ni «Start clean». Además, un toast «Could not open qa-sandbox/notes-dev: GitHub sign-in required» (`v6-b-cancelled.png`).
- Secretos: 0 coincidencias de `gho_|ghp_|github_pat_` en el log del Electron de prueba ni en `~/.qaap/users/_dev/settings.json`.
- PR #534 (una comprobación): 2 pasados (`CI gate`, `qaap:drift-check`), 0 fallidos, 13 pendientes.

**Decisión del usuario (18 nov): se deja como está.** El servidor `qaap-github` queda dormido: ningún harness lo usa (los CLI de harness no reciben servidores MCP de Theia y el agente GitHub de Theia no está en el selector del composer). No arranca al iniciar. Por eso el diagnóstico del selector, la escritura opcional y las verificaciones del VPS 1-5 quedan aparcados, no pendientes. Si algún día se conecta a un harness, retomar desde aquí y respetar `doc/qaap-github-token-boundary.md`.

**Correcciones tras las pruebas en vivo (18 nov)**
- Toast «Could not open qa-sandbox/notes-dev: GitHub sign-in required»: en escritorio sin sesión GitHub de Qaap, `POST …/repositories/:owner/:repo/open` respondía 503 aunque el checkout existía. Ahora abre el checkout local sin red y, si falta, clona con el git del usuario (credential helper / `gh`). Web/VPS sin cambios.
- Proceso `server-github` fugaz: la entrada legacy hidratada desde el espejo de settings llegaba al gestor MCP y un frontend sin el filtro la autoarrancaba antes de la migración (visto en los logs de las 21:49 y 21:53 UTC del 17 nov y en un `ps` de las 23:18 UTC, todos con bundles anteriores al filtro). El gestor MCP del backend rechaza ya cualquier `server-github` sin `GITHUB_PERSONAL_ACCESS_TOKEN`.
- «Connect GitHub» y los demás «Sign in with GitHub» en escritorio ya no navegan la ventana: abren el diálogo de device flow (el mismo de importar repositorios) y GitHub en el navegador del sistema.

## 2026-11-17 — Ronda 2b (PR #534)

**Hecho**
- Harness Pro, fail-closed: los modelos Pro quedan bloqueados mientras la sesión del harness esté `signed-out` o `unknown`; un `checking` o sesión sin valor no muestra acción de sign-in. Las filas bloqueadas por sign-in del selector llevan `aria-disabled="true"` y `theia-mod-disabled`: el clic abre el sign-in de ese harness; Enter y ⌘N no seleccionan. Las bloqueadas por plan no hacen nada. Enter en la búsqueda elige la primera fila seleccionable. (`qaap-composer-model-picker.ts`, specs nuevos.)
- Transcript: un turno cuyo resultado dice éxito ya no muestra fila «Failed:» ni estado fallido en el resumen (`toConversationSummary`). El error guardado no se borra; solo se oculta en lectura.
- Work Hub: CSS de cabecera, proyectos y sidebar de sesiones.
- Electron: `QaapWorkHubElectronMainMenuFactory` filtra el menú nativo según la superficie y el menú de app de macOS toma el nombre del producto («Qaap») en vez de «Theia». Spec nuevo.
- Investigación de «hola» en esor-vite: no hubo envíos nuevos (ni turnos ni tareas en las últimas 2 h). El `updatedAt` de tres conversaciones (46eb0af5, 9e564278, 29ff13af) se fijó a 19:48:48–53 en el arranque del backend, por la reinicialización de turnos `streaming` (`interruptStreamingTurnForRestartExtracted` / `sweepZombieStreamingTurns`, que escriben `updatedAt = nowMs`). `toConversationSummary` no altera fechas ni orden: no es el culpable. No se ha tocado; ver pendiente.
- File › Preferences y ⌘, abren Settings del Work Hub (General, Keybindings, Appearance) y el menú nativo del Work Hub oculta File Icon Theme (el IDE lo conserva). Nueva pestaña «Pull request» en el panel derecho: sin sesión muestra Connect GitHub; sondea solo un PR open o draft cada 60 s con pestaña y documento visibles; deduplica y deja 15 s entre fetches automáticos (1 petición sin sesión, medido). Side chat (`doc/qaap-side-chat.md`): pestaña en el panel derecho con Bring back, borrar, cerrar, Context from y composer igual al principal (mismo wrapper, clases y pill vía `populateAgentToolbarButton`; medido por CDP). El preámbulo de contexto va en el campo oculto `contextPreamble` del primer mensaje (no en `content` ni en el título; Retry y reanudaciones lo reutilizan). Conversaciones antiguas con el preámbulo en el texto: el render lo recorta (también anidado) y el título sale de la primera pregunta. Un side chat abierto desde otro cita la raíz (3 saltos como máximo). Bring back cierra la pestaña y deja el lanzador: el «+» no se perdía antes porque cerrar la última pestaña ocultaba el panel.

**Validación**
- `npx tsc -b` de qaap-shared-core, qaap-transcript, qaap-cloud-workspace, qaap-composer, qaap-work-hub y qaap-product: 0 errores.
- Tests: shared-core 2626 ok (3 pending); transcript 957; cloud-workspace 3984 (2 pending); composer 519; work-hub 1069 (1 pending); product 171 (incluye el snapshot de bindings).
- eslint sobre los 30 `.ts` cambiados: 0 errores, 113 avisos (ninguno nuevo de lógica).
- `scripts/qaap-drift-check.js`, `qaap-package-graph-check.js`, `qaap-endpoint-ownership-check.js`, `qaap-spec-jsdom-check.js`: OK.
- `npm run build:electron` sin errores. Aviso de CSS preexistente en `mobile-workbench-transcript.css` (llave sin cerrar), fichero no tocado.
- CDP sobre el Electron de prueba (:9334): en Copilot CLI, las 5 filas Pro están `aria-disabled`; ⌘1 no cambia el pill («Beam Free»); el clic abre «Connect Copilot CLI» (sign-in).
- Menú: el DTO del renderer (`createElectronMenuBar`) trae «Qaap» como menú de app. No se pudo leer la barra de menús del sistema (osascript sin permiso de accesibilidad; una captura salió con Chrome al frente), así que el texto visible en macOS está sin verificar.

**Limitaciones**
- Enter sobre una fila bloqueada por sign-in dispara su `click` nativo y abre el sign-in (no selecciona). Es lo que se pidió por clic; se documenta aquí por si no se quiere.
- Side chat: una pestaña a la vez; no se restaura tras recargar (la conversación sigue en el servidor y se abre desde la barra lateral); sin pills de herramientas (solo «Used N tools»); solo escritorio; los turnos posteriores del padre no se reenvían; el textarea del side chat tiene el texto visible (el principal lo lleva transparente sobre una capa de resaltado); el picker del side chat no se pudo capturar en imagen (sí verificado en DOM: sin bloque de acceso).
- Los commits por tema no se han compilado uno a uno: el orden A→B→C→D respeta dependencias, pero no se ha verificado cada commit por separado.

**Pendiente**
- Validar agy en el VPS con el fail-closed.
- Usuarios de Copilot y Grok: un re-sign-in una vez (sin él, sus Pro salen bloqueados).
- El error persistido en turnos antiguos sigue en la BD; solo se oculta en lectura.
- Decidir si el arranque debe conservar `updatedAt` en las conversaciones reinicializadas (hoy las sube a «ahora» y cambian de orden en la barra lateral).
- Propuesta MCP de GitHub sin prompt al arrancar.
- Verificar en el menú real de macOS que aparece «Qaap».

## 2026-11-17 — Resto de la ronda 2 (rama `feat/work-hub-harness-round2`)

**Hecho:** trabajo por temas en la rama, en commits separados.
- Escáner de uso: registro por home de agente (`qaap-usage-scanner-registry`), scan target y acceso a ficheros (directo, o por un helper con el uid del agente cuando los agentes corren con otro usuario).
- Login de agente: diálogo y flujo muestran el resumen de un crash nativo, dan más tiempo a los desafíos de las TUI y llevan el `env` del comando de login. Work Hub lo arranca en segundo plano (`qaap-agent-login-background`).
- Sign-in preflight, atestación y acceso de agente: la guardia previa a la ejecución solo bloquea ante un sign-out positivo; las sesiones de Codex del overlay se copian al home del dueño.
- Disponibilidad de modelos: `checking` y `unknown` ya no bloquean los modelos Pro; `agent-tui-command` usa el comando y el `env` de login.
- Transcript: marca los cambios de harness entre turnos (`qaap-transcript-harness-switch`) y tiene el CSS del timeline.
- Composer: la fila de pastillas de cambios es dueña de Run app / Starting preview… / View Preview, así no se apilan dos «Run app».
- Bootstrap de proyectos: diagnóstico de errores del dev server y streaming/actividad.
- Work Hub: atajos de escritorio (passthrough de ⌘F y ⌘1–9 solo con el buscador o el selector de modelos enfocados) y CSS de conversación móvil.

**Validación:** `tsc -b` de 6 paquetes OK; 23 ficheros de spec (525 tests) verdes; drift, package-graph, endpoint-ownership y spec-jsdom OK; eslint 0 errores.

**Pendiente:** probar en la app de escritorio ⌘1–5 con teclado real y Preview de un repo sin compilar.

## 2026-11-17 — Atajos del Work Hub en escritorio (rama `feat/work-hub-harness-round2`)

**Causa:** el registro de keybindings de Theia escucha en captura y se traga ⌘F (`core.find`) y ⌘1–9 (`workbench.action.focus<N>EditorGroup`) antes que los handlers del Work Hub. **Hecho:** `qaap-work-hub-shortcut-passthrough-contribution.ts` registra `passthrough` para esas teclas solo con el foco en el buscador del transcript o con el selector de modelos abierto; el selector toma el foco al abrirse en escritorio y escucha ⌘1–9 en el documento mientras está abierto. La página Settings › Keybindings solo lista los atajos propios del Work Hub (`qaap-work-hub-keybinding-allowlist.ts`). **Validación:** `tsc -b` de composer y work-hub; 12 specs de keybindings y 25 del selector en verde; en la app Electron (CDP :9333) ⌘1 con el foco en el buscador, ⌘2 con el foco en el composer y Esc funcionan. CDP no pasa por el menú nativo de macOS. **Pendiente:** probar ⌘1–5 con teclado real y con grupos de editor abiertos en el IDE (el menú Go tiene esos aceleradores).

## 2026-11-17 — Preview: la salida de los dev servers ocultos se perdía (rama `feat/work-hub-harness-round2`)

**Causa:** en escritorio y web (no en móvil, que usa `QaapHeadlessTerminalService`) el dev server de Preview corre en un `TerminalWidgetImpl` que nunca se abre (`reveal: false`). Upstream guarda lo que llega antes de `open()` en `initialData`: no dispara `onOutput` ni llena el buffer de xterm. Un fallo rápido (`sh: vite: command not found` en una copia sin `node_modules`, `Error: Port 5173 is already in use` con `--strictPort`; los dos salen con código 1) llegaba como «Dev server exited with code 1.» o «Dev server tab closed.», sin el motivo, y tampoco se ejecutaban ni el auto-install ni la recuperación de puerto, que leen esa salida. Además, el aviso de salida (TerminalWatcher) puede llegar antes que la salida, que viaja por otro canal.

**Hecho:** `QaapTerminalWidget` (rebind de `TerminalWidget` en `qaap-work-hub-frontend-module.ts`) dispara `onOutput` para los terminales `qaap-preview` sin abrir y expone `qaapUnrenderedOutput`, que `readTerminalTail` usa como respaldo. El aviso de salida espera a que el widget se cierre (con toda la salida ya recibida) o 1,5 s (`waitForDevExitOutput`), y el cierre del widget ya no compite con él. Una salida con código distinto de 0 cita las últimas líneas («Last output:»), igual que el error final cuando el diagnóstico es genérico. El comando para workspaces pnpm ya era correcto (`pnpm --filter '<pkg>' dev --port N --strictPort` desde la raíz, con `PORT`/`QAAP_PREVIEW_PORT` y `--host 127.0.0.1`); el repo de Qaap sigue usando `npm run start:browser`, aislado y con el puerto que le asigna la preview, y si no está compilado ahora muestra el aviso build-required en lugar del código de salida pelado.

**Validación:** `tsc -b` de shared-core y work-hub; 236 specs de bootstrap/terminal en verde; eslint sin errores; drift y package-graph OK. Comando reproducido a mano en `Mockup`: arranca; sin `node_modules` sale con 1 y `sh: vite: command not found`; con :5173 ocupado sale con 1 y `Port 5173 is already in use`.

**Pendiente:** probarlo en la app (Preview de `Mockup` en una sesión de worktree y del repo de Qaap sin compilar).

## 2026-11-17 — Sesiones de harness en escritorio (rama `feat/desktop-harness-polish`)

**Hecho (sin commitear al cerrar la sesión):**
- Codex en escritorio (`QAAP_DESKTOP=1`): `resolveCodexAgentHome` apunta a `~/.codex`; antes usaba la ruta del contenedor, el overlay del tool-gate no copiaba `auth.json` y cada turno fallaba con 401 «Missing bearer».
- Cuota: `QUOTA_PATTERNS` exige el verbo de agotamiento (un «quota»/«billing» suelto en prosa ya no es cuota). En salida limpia solo las líneas de error del CLI declaran cuota, y se ignoran las peticiones laterales de OpenCode (`small=true`, título de sesión).
- `refreshAgentCatalog(ownerLogin)` levanta solo las sesiones rechazadas de ese owner.
- Antigravity (`agy`): el guard pre-spawn exige sesión para todo modelo; si agy pide sign-in a mitad de turno, `qaap-agy-sign-in-wait-watcher.ts` lo mata en la primera línea de espera (antes esperaba 60 s).

**Validación:** `tsc -b packages/qaap-cloud-workspace`; cloud-workspace 3939 en verde, shared-core 2581 en verde; drift-check y package-graph-check OK; eslint sin errores.

**Pendiente:** commits por fix (no incluir `package-lock.json`, que es ruido de `npm install`); probar en la app de escritorio un turno real de Codex y de agy sin sesión.

## 2026-11-17 (tarde) — Escritorio: gate, UI del Work Hub y evidencia visual (rama `feat/desktop-harness-polish`, sin commitear)

**Hecho:** el gate de herramientas responde en Electron (validador de token propio en `qaap-cloud-workspace/src/electron-node`); icon theme por defecto `theia-file-icons`; plugins (gramáticas) arrancan al abrir Files en escritorio; `api-provider-sample` vuelve a upstream (rompía el plugin host); nombre «Qaap» en la barra de menús (dev: renombra el bundle Electron); vista Changes rediseñada (scopes Task changes/Uncommitted, unified/split, wrap, sin botón History, toggles sin borde) y sin parpadeo/recarga del iframe al cambiar de pestaña (`moveBefore`); hover card de tareas con logos de harness; PR del sidebar con «Made by <harness>»; botón de actualización estilo T3 (preview dev: `localStorage qaap.devPreviewBackendUpdate=1`); evidencia visual visible (se re-adjunta a trace/segments en `materializeAgentMessageForApi`); inset de semáforos con el panel derecho maximizado.

**Validación:** tests de shared-core, cloud-workspace, diff-review, product y work-hub en verde; drift y package-graph OK; comprobado en la app Electron por CDP.

**Pendiente:** commits, push, CI (`ci:full` por specs con temp paths) y deploy al VPS. Backend para scopes por turno/commit y «ignore whitespace» en Changes. Sin auto-updater de escritorio.

## 2026-11-09 — Pulido de UI del Work Hub (rama `claude/work-hub-ui-polish`)

**Hecho** (13 commits, una sola PR):
- Changes y Files son vistas separadas (panel derecho y menú de vistas en móvil) sobre la misma superficie de archivos. `review` es ahora una pestaña propia, ya no se pliega en `files`; el panel acopla la superficie bajo la vista que pidió. El conmutador interno Files/Changes se oculta en el Work Hub; el IDE no cambia.
- Panel derecho: los ítems del launcher se abren con un clic en toda la fila; el glifo del selector de vista sigue a la media query (doble chevron ↔ panel derecho al cambiar de ancho).
- Picker de modelos: Sign in en la fila del buscador y solo con `disconnected` confirmado (Copilot, Grok y Antigravity no tienen comando de estado: `unknown` ya no pide sesión). Codex usa el logo de OpenAI/ChatGPT.
- Sidebar: «New local project» en el menú Add project; chip de Retry con borde neutro. Barra Project/Branch/Run in sin la línea de ancho completo.
- Chat vacío: logo y título más pequeños; el título es una frase distinta cada día (34 frases, ciclo barajado con semilla, `qaap-daily-welcome-phrase.ts`).
- El nombre del proyecto ya no se corta en el IDE (el tope de ancho del selector central solo aplica cuando ese selector es visible).
- Changes: el resumen ya no trunca; el diff JSON conserva la indentación (bug del resaltador); diff perezoso con `content-visibility`. Files: filas de 28px con ratón.

**Validación:** `npx tsc -b examples/browser`; suites de composer, diff-review, shared-core, transcript, transcript-overlay y work-hub en verde; eslint sin errores; drift-check y package-graph-check OK; todo comprobado en la preview (escritorio y móvil).

**Pendiente:** `scripts/qaap-transcript-scroll-perf.mjs` aún usa un `qaiq` falso (ningún workflow lo ejecuta).

## 2026-11-08 — Decisión: tenants siguen en runc; gVisor queda dormido

**Decisión del usuario:** no se usa gVisor para los backends de Theia. El arranque en frío es ~8 veces más lento (76 s frente a 9 s cargando módulos) y `npm`, `git` y `tsc` son 3–5 veces más lentos todo el rato. El código queda con `runc` por defecto (sin coste) para usos futuros: código de terceros en sandboxes cortos sin Theia. No borrar nada.

**Auditoría de endurecimiento con runc** (VPS, 8 nov, en vivo): Docker rootless 29.8.1, seccomp `profile=builtin`. Backend, relay, Squid y sandboxes llevan `no-new-privileges`, `cap-drop ALL` y rootfs de solo lectura. El backend conserva solo `SETUID`/`SETGID`, que necesita para bajar al uid 1001 del agente. Probé las syscalls dentro de un backend de staging, como root y como uid 1001. Devuelven EPERM o ENOSYS: `unshare` (user y mount ns), `clone3`, `io_uring_setup`, `keyctl`, `add_key`, `bpf`, `userfaultfd`, `perf_event_open`, `mount`, `setns`, `open_by_handle_at`, `fsopen`, `kexec_load` e `init_module`. Siguen permitidas `ptrace` y `process_vm_readv`, dentro del propio contenedor; `ptrace_scope=1` impide atacar procesos de otro uid. Host: `kernel.io_uring_disabled=2`, `unprivileged_bpf_disabled=2`, `apparmor_restrict_unprivileged_userns=1`. Kernel 6.8.0-149: el más reciente instalado, reiniciado el 7 nov. AppArmor no se aplica (limitación de rootless).

**Hueco corregido:** el orquestador no exigía seccomp. Ahora rechaza un daemon alojado que no informe seccomp o que lo tenga `unconfined` (`dockerDaemonSeccompProblem`), con 3 specs nuevos (3507 en total).

**Pendiente (host, lo hace el usuario):** Livepatch no está instalado y `unattended-upgrades` no reinicia solo. Un kernel nuevo exige un reinicio manual o activar Livepatch (Ubuntu Pro). Hay que quitar las variables de gVisor de `/opt/qaap-staging/staging.env`.

## 2026-11-07 — gVisor (systrap) para tenants: sonda sobre el daemon rootless

**Hecho** (rama `claude/gvisor-systrap-implementation-73cb80`): `scripts/qaap-runsc-rootless-probe.sh` comprueba si runsc funciona sobre rootless con el contrato real de los tenants. Usa un daemon desechable y no toca producción. Si funciona, sobran el daemon rootful y el proxy de `origin/claude/tenant-runsc-theia-homes`, cuya revisión fue NO APTO.

**Validación** (Docker Desktop arm64, `docker:29-dind-rootless`, sin cgroups delegados; no equivale al VPS)
- Pasan: arranque con systrap (solo con `--ignore-cgroups` en este entorno), bind y uid mapping, setpriv a 1001, git, SQLite WAL, inotify, exec y TTY, restart, relay runc→runsc y aislamiento de la red interna. La limpieza no deja restos.
- Fallan: DNS desde runsc en bridge de usuario (gVisor #7469), también con las dos redes conectadas antes del start, y memoria (1024 MiB bajo un límite de 256 MiB, esperable sin cgroups). Aviso: pids sin aplicar (204 bajo un límite de 64).
- Sin probar: `--reproduce-nat`, añadido como arreglo del DNS después de esa ejecución. Existe en `runsc/config/flags.go`; la reejecución local quedó bloqueada por permisos.

**Resultado en el VPS** (7 nov, kernel 6.8.0-149, Docker 29.8.1, driver systemd): `NOT VIABLE` tal como está, limpieza correcta.
- Cgroups: runsc solo arranca con `--ignore-cgroups`, que elimina los límites (1024 MiB bajo un límite de 256). Con el driver systemd usa el bus del sistema y polkit lo rechaza: gVisor #11543, con arreglo propuesto en #13853 sin fusionar.
- DNS: falla desde runsc en bridge de usuario también con `--reproduce-nat` (gVisor #7469, abierto). Los tenants usan el alias `qaap-tenant-egress-proxy` para llegar a Squid.
- Pasa el resto del contrato. Coste de una sola medición: 2000 ficheros en bind 1,66 → 6,21 s; arranque de node 1,00 → 1,98 s.

**Fork de gVisor** (decisión del usuario, 7 nov): `juancristobalgd1/gvisor`, rama `qaap-release-20261102.0-rootless` (05ea21fd2; sin `/` porque `build.yml` filtra con `branches: "*"`, que no la admite) = release `20261102.0` + los dos commits de google/gvisor#13853 + un commit vacío que dispara el CI. El segundo se portó a mano sobre el refactor `resourceProps`. El CI propio de gVisor (`build.yml`) debe compilar `//:release` al hacer push; GitHub exige habilitar Actions en la web del fork.
- Validado: el parche compila sobre la rama `go` (commit de la release +17, no la release exacta) y pasan sus tests de `runsc/cgroup`. `TestCreateController` falla igual sin el parche (corre como root en Docker). No probado aún con Docker real ni en x86_64.
- Corrección: el ✅ de «la red interna no tiene egress» de la ejecución anterior no probaba nada, porque usaba DNS roto. La sonda ya comprueba por IP.

**Sonda con el binario del fork en el VPS** (run 42374045629, x86-64, Docker 29.8.1): `VIABLE` con 2 avisos, flags `--platform=systrap --systemd-cgroup`, limpieza correcta.
- Pasan: límite de memoria (la asignación se detuvo en 448 MiB con `--memory 256m`; no se confirmó el exit 137 y es coherente con los 256 MiB de swap que Docker añade por defecto), setpriv, bind, git, SQLite WAL, inotify, relay runc→runsc, `--add-host`, aislamiento por IP, dos redes, exec, TTY, restart.
- Avisos: DNS embebido sigue roto (#7469). Prueba de pids sin resultado (sin salida con `--pids-limit 64`): no sabemos si se limitó o si murió el sandbox.
- Coste, una medición: 2000 ficheros en bind 1,91 → 7,92 s (×4,1); arranque de node 0,95 → 1,93 s (×2).

**Implementado sin commitear ni desplegar** (7 nov): `qaap-tenant-runtime.ts` con `QAAP_TENANT_RUNTIME` y `QAAP_TENANT_RUNSC_LOGINS`; orquestador y broker con runtime por tenant y `ExtraHosts` con la IP actual de Squid; `deploy/rootless/gvisor/qaap-gvisor-install.sh` (`install|check|remove`) y su test. Release publicada: `qaap-20261102.0-1` en el fork, asset `gvisor-fork.tar.zstd`, SHA-512 fijado en el instalador. Verificado: 218 specs, 14 tests del instalador con dobles, sin daemon real.

**Mediciones en el VPS, primera ronda** (filas limpias runc/runsc; el resto se solapó en parte con una segunda ejecución): `npm install` ×3, `tsc` ×4,2, `git` ×3. `--dcache` y `--file-access-mounts=exclusive` no ayudan; `--directfs=false` empeora. Recarga con HUP: daemon vivo, runtime nuevo operativo, contenedor conservado. Limpieza al interrumpir: comprobada.
- Pids: 31 tareas en reposo y unas 2,4 tareas del host por proceso del invitado. Con límite 256: 100 procesos llegan a 246; 200 matan el sandbox entero (exit 2), sin `EAGAIN`. Fork bomb: muere en menos de 10 s, host intacto. **El límite actual no sirve bajo runsc.**

**Segunda ronda** (`tune2`): más CPU no ayuda (`npm` 80 s con 2 CPUs, 74 s con 8; runc 25 s), `RLIMIT_NPROC` no se aplica, 1024 de pids aguantan 400 procesos y a 500 muere el sandbox. Aplicado `QAAP_RUNSC_PIDS_FACTOR = 4`.

**Revisión de seguridad independiente** (`deep-reasoner`, solo lectura, sin nada en vivo): canario en un login sí con condiciones; todos los tenants no. Corregido: A1 (plazo de 30 min y `reconcileTenantRuntimes` en el reaper), M2 (README con `--noproxy`), M4 (`check` lee el cgroup de un sandbox real), M5 (flags exactos, ruta del binario, nueva lectura cada 60 s), M6/M7/B5/B6 (instalador), M8 (`forCreate`), M9 (límites de Squid, recrea Squid de todos los tenants en el siguiente despliegue), M11 (`qaap-gvisor-upstream-watch.yml`), B2, B3. Sin corregir: B1 (IP de Squid, falla cerrado), B4 (no afecta a logins de GitHub).

**Sonda de seguridad y contrato final en el VPS** (flags definitivos, ajustes de red de producción, `VERDICT: VIABLE`): sentry con uid sin privilegios y 0 capacidades; gofer sigue con uid 1000, capacidades y seccomp. El uid del agente no lee el entorno de root, raíz de solo lectura, `/tmp` sin ejecución. Con controles positivos, ni runc ni runsc alcanzan desde la red interna el relay de otro tenant, la gateway, `10.0.2.2` ni la IP pública. Pausa, reanudación, OOM (137, 3 reinicios) sin unidades fallidas ni scopes restantes. Adoptado `--directfs=false`: `npm` igual, `tsc` +16 %, `git` +35 %, pero 2000 ficheros pequeños ×10 frente a runc. A2 resuelto con `qaap-<hash>.slice` (`TasksMax=8192`) bajo `qaap.slice` (50000); los límites de slice no se han probado aún en el VPS.

**Canario en staging, primer intento** (`jcristgd`, imagen ba9ac937d): instalador correcto en el host real, producción intacta. El backend real arranca bajo runsc. Dos fallos que la sonda no vio: `setfacl` da ENOTSUP bajo gVisor, y eso impedía agentes y terminales (cambiado a grupo compartido 1001 con `setgid` y umask 002, validado en una sonda: acceso mutuo y `git` funcionan, lo privado sigue denegado); el arranque en frío llegó a 95 s a 1 CPU frente a 10,6 s en runc (plazo subido a 150 s).

**Pendiente**
- Repetir el canario con el arreglo. Medir el arranque con `QAAP_PROBE_MODE=group` y `QAAP_PROBE_BOOT_IMAGE` (la descarga falló la primera vez). Revisión de seguridad del cambio de permisos.
- Canario en staging y luego en un login, con los pasos del README. M3 se simuló: repetirlo contra relays reales. Medir tareas reales antes de decidir activarlo para todos.
- `--memory` deja el doble con swap, igual que en runc; decidir aparte si fijar `MemorySwap`.
- Restos en el VPS: `/tmp/gvisor-fork.tar.zstd`, `/tmp/qaap-runsc-rootless-probe.sh`. En el fork, rama antigua `qaap/release-20261102.0-rootless` sin uso.
- Revisión de seguridad independiente del fork y del montaje antes de producción, y medir un build real.
- Mantener el fork al día con los parches de seguridad de gVisor; la PR sigue sin revisión de Google.
- Restos en el VPS: `/tmp/gvisor-fork.tar.zstd`, `/tmp/qaap-runsc-rootless-probe.sh`.

## 2026-10-24 — VPS caído: backend de tenant se autoeliminaba y no se recuperaba

**Diagnóstico** (prod `https://161.97.69.219.sslip.io`, build `f89ce0b32`): toda la app quedaba en spinner + "took too long to start", 502 `Tenant backend unavailable / socket hang up` en `project-sessions`, `user-settings` y `socket.io`.
- Causa 1: el forwarder del sandbox hace que el propio backend escuche en el puerto de la preview; al sustituir la preview, `terminateListenersOnPort` le mandaba SIGTERM a sí mismo y a su grupo (logs: `[qaap-preview] reserved` → 3 s → `Stopping backend contributions`, Exited 1, ambos tenants el 23 oct).
- Causa 2: el relay `qaap-ingress-*` sigue vivo, el proxy ve `socket hang up` (no un connect error), nunca invalida el target ni re-ensura → 502 permanente. Sin restart policy.

**Hecho** (rama `fix/tenant-backend-preview-selfkill`)
- Mitigación en prod: `docker start` de los dos `qaap-backend-*` en el Docker rootless (uid 1000). Se volverán a caer al abrir una preview hasta desplegar el fix.
- `qaap-shared-core`: guard `isSelfOrUnsafeSignalTarget` / `canSignalProcessGroup` (nunca pid ≤1, el propio pid ni un grupo que contenga al backend; fail-safe si no se lee el pgid) en `terminateListenersOnPort`, `terminatePreviewProcessExtracted` y `releasePreviewsForWorkspace`; `findListeningProcessCwdsOnPort` ignora el propio pid.
- `qaap-cloud-workspace`: hang-up antes de respuesta (no abortado por el cliente) invalida el target y reintenta GET/HEAD una vez; WS invalida igual; backend de tenant creado con `RestartPolicy on-failure` (3).

**Validación**
- `npx tsc -b` de ambos paquetes OK; specs: shared-core 116 passing, cloud-workspace 147 passing; drift-check OK; eslint 0 errores.
- Diagnóstico de usuario hecho por un agente Haiku en el navegador (bloqueado en el arranque, flujos 2-8 sin probar).

**Pendiente**
- PR + CI + deploy; tras deploy, repetir la prueba Haiku de flujos 2-8 (Work Hub, añadir repo, delegar tarea, Settings/BYOK, recarga, móvil).
- Al sustituir una preview servida desde el sandbox, el dev server dentro del sandbox no se termina (huérfano): enrutar el terminate al exec server del sandbox.
- `osProcessId` reportado desde el sandbox está en otro pid namespace: no debería señalarse localmente.
- P1: mensaje de error real en el frontend cuando el backend devuelve 502; fallos `opencode`/`qaiq` exit 1; `could not grant agent uid 1001 access … cache`; `task storage write failed`.

**Ronda 2 de QA (Haiku, cuenta jcristgd, 23 oct 23:10 UTC)**
- El autokill también lo dispara el reaper sin acción del usuario: `qaap-backend-7626…` murió a las 22:35 tras `[qaap-preview] reaped stopped process` (preview vieja del puerto 3000). Reiniciar a mano es inútil hasta desplegar #349.
- 403 `{"code":4}` en bucle de socket.io: token de conexión rotado al reiniciar el backend y cacheado en el control plane. Arreglado en #349 (commit 02c77d30d). Mientras no se despliegue, afecta a jcristgd (reinicio manual).
- **Pendiente P0, otra PR:** `parseOpencodeLog` (`qaap-shared-core/src/common/qaap-opencode-stream.ts`) devuelve `content: getDisplayText() || log`; cuando el modelo no produce texto (opencode/big-pickle: 6 tokens de salida), el transcript muestra el NDJSON crudo (`step_start`/`step_finish`) como respuesta. Debe tratarse como turno vacío o fallido, con retry o modelo de reserva. Revisar también `qaap-cli-transcript-stream.ts` ~98.
- "Working" sin fin: el primer turno tenía `runFinishedAt` en el registro; el segundo turno ("njn", enviado por el usuario) seguía ejecutando la verificación `npm run build` del monorepo qaap. Verificar tras el deploy si la UI cierra el turno.
- BYOK en Settings muestra la lista entera del editor: la sección filtra `ai-features` en el widget de preferencias; probablemente el filtro no se aplicó por el 403. Reverificar tras el deploy.
- UX: el selector de proyecto de la cabecera no abre menú; no hay acción visible para abrir la preview; Copy sin feedback; controles del composer (Build / Approve for me / Standard) sin explicación y truncados en móvil.

## 2026-10-23 — Política de selección de modelos

**Hecho**
- `CLAUDE.md`: la sección de orquestación sustituye el esquema Fable/Sonnet por Opus (pensar, revisar, decidir) + Haiku (ejecución rutinaria), con reglas de escalado y ejecución.
- `.claude/agents/fast-worker.md`: `model: haiku` (antes `sonnet`) y regla de escalado a `deep-reasoner`. `.claude/agents/deep-reasoner.md` sigue en `model: opus`.
- `scripts/qaap-drift-check.js`: `docs/HANDOFF.md` añadido al `ALLOWED`.

**Validación**
- `node scripts/qaap-drift-check.js` en verde. Sin cambios de código: no aplica compile ni build.

**Limitaciones**
- `.claude/agents/` se versiona en el repo desde el 2026-10-23 (excepción en `.gitignore`), así que la política de modelos de los subagentes viaja con el repo a cualquier cuenta o máquina.
- El modelo por defecto de la sesión principal lo fija `~/.claude/settings.json` (`"model"`) o el selector de la app; en la cuenta original se cambió de `fable[1m]` a `opus` el 2026-10-23. En otra cuenta, ajústalo igual.

**Pendiente**
- Nada.

**GitHub MCP gestionado (rama feat/work-hub-harness-round2, PR #534)**
- Hecho: resolvedor de credenciales, servidor `qaap-github` de solo lectura por conexión, arranque bajo demanda con single-flight, chat agent que no persiste entradas de GitHub, documentación en `doc/qaap-github-token-boundary.md`.
- Hecho (revisión de seguridad, 18 nov): identidad del gestionado por objeto (nombre y clientId reservados en frontend y backend; solo `/mcp/readonly`); el arranque bajo demanda respeta la confianza del workspace; Errored => error; modo `local` solo con `QAAP_LOCAL_DEV=1`/`QAAP_CLOUD_MODE=local`; gh por ruta absoluta sin `GH_*`; `/user` limitado a una consulta por token cada 5 min; la migración parchea el espejo en vez de reemplazarlo; `QaapGithubMcpOnDemandStarter` faltaba en DI (ahora registrado).
- Hecho (lote UX, 18 nov): chip «Connect GitHub» en el input del chat (needs-credential / auth-required / untrusted), estado por RPC sin valor (pista `gh auth login` en escritorio), rechazo por política estable y sin reintentos (1 h por token), alias `mcp_github_tools` para `code-reviewer`/`explore` cuando no hay `github` del usuario.
- Pendiente: opt-in de escritura `qaap.mcp.github.allowWrite` con confirmación obligatoria (`mcp_qaap-github_*`). Hasta entonces el filtro de solo lectura del backend bloquea cualquier herramienta sin `readOnlyHint`.
- Limitación: `code-reviewer`/`explore` solo ven las herramientas gestionadas si el servidor ya arrancó (lo arranca un turno de GitHub); ellos no lo arrancan.
- Pendiente de verificar en vivo:
  1. desktop: `api.githubcopilot.com/mcp/readonly` acepta el token OAuth de Qaap y el de `gh` sin licencia de Copilot (401/403 con `/user` válido => mensaje «no soportado»);
  2. `tools/list` en `/readonly` devuelve herramientas con `readOnlyHint` y el filtro no vacía la lista;
  3. VPS: el backend de tenant llega a `api.githubcopilot.com` a través de Squid (`NODE_USE_ENV_PROXY`);
  4. VPS: la caché del token del dueño se llena antes del primer turno de GitHub; las restricciones de la OAuth App dan 403 legible;
  5. grep de `gho_`, `ghp_` y `github_pat_` en logs y en `settings.json` del tenant tras una sesión completa.

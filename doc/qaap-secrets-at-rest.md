# Cifrado de secretos en reposo (diseño)

Estado: **propuesta**, pendiente de aprobación. Origen: E-15 en `doc/qaap-vps-expediente.md` (las API keys solo se enmascaran en pantalla).

## Situación actual (inventario, 24 oct 2026)

No hay cifrado a nivel de aplicación. Lo único que existe es el HMAC de integridad de la aserción de tenant y el hash SHA-256 de los tokens personales `qaap_pat_*` (`qaap-api-token-store.ts:143`). Todo lo demás está en claro, protegido solo por permisos (0600/0700) y por el aislamiento por contenedor.

| Secreto | Dónde | Formato | Riesgo |
|---|---|---|---|
| API keys de IA (`ai-features.*ApiKey`) | `{home}/.qaap/users/<login>/settings.json`. En el VPS: `/opt/qaap-runtime/auth/users/<login>/settings.json`. Escritura en `writeUserSettingsToDisk` (`qaap-agent-task-runner-utils2.ts:441-462`); lectura en `readUserSettingsFromDisk` (381-428) | JSON en claro | Alto: claves de pago del usuario |
| Token OAuth de GitHub (`gho_…`) | SQLite `sessions.sqlite`, namespace `github-sessions` (`qaap-github-session-store.ts:472`). Además, el `sessions.json` legado importado **no se borra** | JSON en claro | Alto: acceso a los repos del usuario |
| Token de GitHub en la aserción de tenant | `createQaapTenantBackendAssertion` (`qaap-tenant-backend-auth.ts:54-74`): base64url firmado con HMAC, sin cifrar, en una cabecera interna control plane → tenant | En claro en tránsito interno | Medio |
| Tokens de tareas del helper | `~/.qaap/task-tokens.json` (`qaap-agent-task-runner-render2.ts:55-78`); deben ser reversibles porque se reinyectan en `QAAP_TASK_TOKEN` | JSON en claro | Medio |
| Credenciales de CLIs (Claude, Codex, Gemini…) | Home persistente del tenant (`qaap-tenant-persistent-home.ts:14-32`), volumen `qaap-tenant-homes`; las escribe cada CLI | En claro | Alto, pero fuera del alcance de la aplicación |
| Keystore de Theia (MCP OAuth, Copilot) | `KeyStoreServiceImpl` sin libsecret en el contenedor: solo en RAM, se pierde al reiniciar | Memoria | Bajo en reposo (es un problema funcional, no de cifrado) |
| Suscripciones push, facturación, intake externo | SQLite (`push-subscriptions`, `billing`, `external-tasks`) | JSON en claro | Medio |

**Copias de seguridad:** el backup nocturno (`scripts/qaap-vps-backup.sh` → `/var/backups/qaap/`, unos 1,4 GB por archivo) incluye todo lo anterior. Es el vector de fuga más probable: un archivo de backup copiado o filtrado lleva todos los secretos en claro.

## Modelo de amenaza

**Protege contra:** lectura de disco, backups o volúmenes sin acceso al proceso; volcados de la base de datos; ficheros de settings copiados por error.

**No protege contra:** root en el host con acceso al entorno del contenedor (la clave está en `.env`), ni contra un backend comprometido en ejecución. Para eso hacen falta un KMS o un HSM (fase 3).

## Diseño propuesto

### Primitiva común

Un módulo `QaapSecretCipher` en `@theia/qaap-persistence` (node) con estas características:

- **Algoritmo:** AES-256-GCM con IV aleatorio de 12 bytes. Formato de sobre: `qaapenc:v1:<kid>:<iv_b64>:<ciphertext_b64>:<tag_b64>`.
- **AAD obligatorio:** el contexto del valor (por ejemplo `settings:<login>:<prefId>` o `kv:<namespace>:<key>`), para que un valor cifrado no se pueda copiar a otro usuario o campo.
- **Claves:** `QAAP_SECRETS_KEYS="<kid1>:<base64 de 32 bytes>,<kid2>:…"`. Se cifra con la primera y se descifra con cualquiera, lo que permite rotar sin tiempo de inactividad. La longitud se valida como hace el orquestador con `QAAP_TENANT_BACKEND_MASTER_SECRET`. No se reutiliza ese secreto, para no acoplar firma y cifrado.
- **Lectura tolerante:** si el valor no lleva el prefijo `qaapenc:`, se trata como texto en claro heredado y se recifra en la siguiente escritura (migración perezosa). Así no hace falta una migración masiva ni hay corte de servicio.
- **Sin clave configurada:**
  - en desarrollo, se escribe en claro con un aviso;
  - en producción (`NODE_ENV=production`), el arranque registra un error claro y el *launch gate* (`scripts/qaap-vps-launch-gate.sh`) falla. No se niega a arrancar, para no tumbar el servicio por un `.env` incompleto.

### Fase 1 (para el lanzamiento)

1. **API keys de IA:** cifrar solo los valores de preferencias de credenciales (las de `SETTINGS_CREDENTIAL_PREFS_BY_AGENT` y las que casan `isQaapSecretPreferenceId`) dentro de `writeUserSettingsToDisk`, y descifrarlos en `readUserSettingsFromDisk`. El resto del JSON sigue legible. El endpoint `qaap-user-ai-settings-endpoint.ts` sigue recibiendo y devolviendo texto en claro a su usuario autenticado, así que el frontend no cambia en esta fase.
2. **Token de GitHub:** cifrar el campo `accessToken` en `QaapGithubSessionStore` antes de `set` y descifrarlo en `get`/`list`, con AAD `kv:github-sessions:<sessionId>`. Tras una importación legada correcta, borrar o vaciar `sessions.json`.
3. **`task-tokens.json`:** cifrar cada valor y conservar la reinyección.
4. **Despliegue:**
   - generar `QAAP_SECRETS_KEYS` (`openssl rand -base64 32`, kid `k1`);
   - añadirla a `/opt/qaap/.env` y pasarla al control plane y a los backends de tenant (lista blanca de env del orquestador);
   - guardar una copia de la clave **fuera** del VPS y separada de los backups (si se pierde, los usuarios tendrán que volver a introducir sus claves y a iniciar sesión).
5. **Tests:**
   - ida y vuelta de cifrado;
   - un AAD distinto debe fallar;
   - lectura de texto en claro heredado y recifrado;
   - rotación con dos kids;
   - comportamiento sin clave en desarrollo y en producción;
   - integración con `writeUserSettingsToDisk` y `readUserSettingsFromDisk`, y con el store de sesiones.

### Fase 2

- Cifrado a nivel de valor en `QaapSqliteStore` (`get/set/list/replace`, con el namespace como AAD) para todos los namespaces sensibles, con descifrado dentro de `list()` porque se usa para filtrar.
- Sacar el token de GitHub de la aserción de tenant: enviar el id de sesión y resolver el token en el backend del tenant mediante una llamada autenticada al control plane, o cifrar ese campo con una clave distinta.
- Que el GET de settings deje de devolver las claves en claro al navegador. Devolvería `{ set: true, last4 }` y la escritura sería solo de entrada. Antes hay que comprobar que ninguna funcionalidad del frontend (modelos de IA de Theia registrados en el frontend) usa la clave directamente.

### Fase 3

- Cifrado de disco del volumen `qaap-tenant-homes` (LUKS o equivalente del proveedor) para las credenciales que escriben las CLIs.
- Backups cifrados (age/gpg) con la clave fuera del VPS.
- Clave maestra en un KMS en lugar de `.env`.

## Decisiones que requieren al operador

1. Aprobar la fase 1 y el formato `QAAP_SECRETS_KEYS`.
2. Dónde se custodia la copia de la clave fuera del VPS.
3. Si en producción, sin clave, se prefiere **arrancar con error visible** (propuesto) o **negarse a arrancar**.

# GitHub triggers (`@qaap`)

Dispara tareas de agente en el VPS desde issues y pull requests de GitHub, al estilo `@cursor` o label `jules`.

**Requisitos:** Qaap desplegado con OAuth GitHub (`QAAP_GITHUB_CLIENT_ID`, `QAAP_GITHUB_CLIENT_SECRET`, `QAAP_OAUTH_PUBLIC_URL`) y el paquete `@theia/qaap-cloud-workspace` cargado (trigger + goal loop + evidencia en PR).

Ver también: [qaap-vps-deployment.md](./qaap-vps-deployment.md) (deploy + health).

---

## Flujo

1. Alguien comenta `@qaap fix the flaky test` en un issue/PR, o abre un issue con label `qaap`.
2. GitHub envía un webhook a `POST /qaap/api/github/webhook`.
3. Qaap resuelve `owner/repo` → directorio de trabajo (repo ya añadido en Work Hub, o clone en `QAAP_REPOS_ROOT`).
4. Se crea una conversación VPS con `autoApprove: true` y arranca el agente.
5. Qaap responde en el hilo: *"Qaap started a task…"* + link a Work Hub.
6. Al terminar el turno (o el goal loop), se publica un comentario de **evidencia** con resumen, diff y link.

---

## Variables de entorno

| Variable | Obligatorio | Default | Uso |
|----------|-------------|---------|-----|
| `QAAP_GITHUB_CLIENT_ID` | Sí (OAuth) | — | Login GitHub en Qaap |
| `QAAP_GITHUB_CLIENT_SECRET` | Sí | — | Login + API GitHub |
| `QAAP_OAUTH_PUBLIC_URL` | Sí | — | Links en comentarios (`?qaap_route=transcript&qaap_conversation=…`) |
| `QAAP_GITHUB_WEBHOOK_SECRET` | Recomendado | — | Si está definido, rechaza webhooks sin firma HMAC válida (**401**) |
| `QAAP_GITHUB_TRIGGER_LABEL` | No | `qaap` | Label en issues que dispara agente sin `@qaap` en el body |
| `QAAP_REPOS_ROOT` | No | `/workspace/repos` | Raíz donde se clonan repos nuevos desde GitHub |

Copia las claves en `.env` desde [`.env.docker.example`](../.env.docker.example).

---

## Configurar el webhook en GitHub

En el repo (o en la GitHub App / org hook):

| Campo | Valor |
|-------|--------|
| **Payload URL** | `{QAAP_OAUTH_PUBLIC_URL}/qaap/api/github/webhook` |
| **Content type** | `application/json` |
| **Secret** | Mismo valor que `QAAP_GITHUB_WEBHOOK_SECRET` |
| **Events** | `Issue comments`, `Issues`, `Pull requests` |

`Pull requests` alimenta el inbox SSE de Work Hub (sin disparar agente). Los triggers de agente vienen de `issue_comment` e `issues`.

---

## Qué dispara una tarea

| Evento | Condición |
|--------|-----------|
| `issue_comment` (created) | Body contiene `@qaap` (case-insensitive), **o** el issue tiene label `QAAP_GITHUB_TRIGGER_LABEL` |
| `issues` (opened / labeled) | Body o título menciona `@qaap`, **o** label trigger |
| Comentarios de ack de Qaap | Ignorados (evita bucles) |
| PR sin mention/label | Solo inbox; **no** crea tarea |

El prompt enviado al agente es el texto del comment/issue **sin** la mención `@qaap`.

---

## Prerrequisitos en Qaap

1. Iniciar sesión con GitHub en la instancia VPS (al menos una sesión OAuth activa en el servidor).
2. Añadir el repositorio en Work Hub (**Add repository**) **antes** del primer trigger, o dejar que Qaap clone en `QAAP_REPOS_ROOT` si la API lo permite.
3. Si el repo no está vinculado, Qaap responde en GitHub con un mensaje explicativo (no crash).

---

## Verificación manual

```bash
# Health + agentes (Issue 0)
./scripts/qaap-vps-verify.sh

# Simular firma (sustituye SECRET y PUBLIC_URL)
PAYLOAD='{"action":"created","comment":{"id":1,"body":"@qaap echo hello"},"issue":{"number":9},"repository":{"owner":{"login":"ORG"},"name":"REPO"}}'
SIG="sha256=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$QAAP_GITHUB_WEBHOOK_SECRET" | awk '{print $2}')"
curl -sS -X POST "$QAAP_OAUTH_PUBLIC_URL/qaap/api/github/webhook" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: issue_comment" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$PAYLOAD"
```

Esperado: HTTP **202**, comentario ack en el issue, conversación visible en Work Hub.

Sin `QAAP_GITHUB_WEBHOOK_SECRET`, el endpoint acepta POST sin firma (útil en dev local; **no** en producción).

Con secret configurado, un POST sin header `X-Hub-Signature-256` válido → **401**.

---

## Idempotencia y evidencia

- **Dedupe de comment:** reintentos del mismo `commentId` dentro de 1 h reutilizan la conversación existente.
- **Evidencia al terminar:** un comentario Markdown por `task.id` (o uno resumen si hay goal loop activo).
- **Web Push:** notificación en background con deep link al transcript (`Issue 6`).

---

## Troubleshooting

| Síntoma | Causa probable |
|---------|----------------|
| 401 en webhook | Secret distinto entre GitHub y `QAAP_GITHUB_WEBHOOK_SECRET`, o body alterado respecto al firmado |
| 503 Agent trigger bridge unavailable | `@theia/qaap-cloud-workspace` no cargado en el backend |
| Comentario "not linked to Qaap" | Repo no añadido y clone falló — abrir Qaap y **Add repository** |
| No hay ack en GitHub | Sin sesión OAuth en el VPS — iniciar sesión una vez en el navegador |
| Tarea duplicada | Mismo comment reenviado tras 1 h — comportamiento esperado; dedupe es best-effort 1 h |

---

## Tests

```bash
npx lerna run test --scope @theia/qaap-mobile-shell -- --grep qaap-github
npx lerna run test --scope @theia/qaap-cloud-workspace -- --grep github-pr-evidence
```

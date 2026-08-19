# Checklist ensayo demo (evento ~48 h)

Objetivo: ganar head-to-head vs Devin / Codex / Claude Code Desktop.
VPS: `https://178.105.136.93.sslip.io`

## Antes de ensayar (VPS)

- [ ] `curl -fsS https://178.105.136.93.sslip.io/qaap/api/auth/config` → `build` = tip de `master`
- [ ] Chrome o Edge (no Firefox/Safari para mic)
- [ ] Incógnito: login **GitHub** frío funciona en la red del venue (no hay botón GitLab)
- [ ] Capacidad evento (SSH VPS, en `/opt/qaap/.env`):
  ```bash
  QAAP_MAX_CONCURRENT_AGENTS=4
  QAAP_MAX_CONCURRENT_AGENTS_PER_USER=3
  QAAP_MAX_PARALLEL_VARIANTS=3
  ```
  Luego `docker compose up -d` (o redeploy Actions).
- [ ] Precalentar Vite del repo demo (evitar >30 s frío):
  ```bash
  # En el workspace demo del VPS / contenedor theia
  cd <appRoot> && npm run dev -- --host 127.0.0.1 --port 5173
  ```
- [ ] Rollback listo: último digest GHCR bueno + comando de redeploy pegado

## Script de escena (orden)

1. **Móvil / Work Hub** — abrir sesión, composer sticky visible
2. **Prompt corto** (QAIQ) → tools en timeline / Agent Trace
3. **Preview** — Open preview / tab Preview con iframe del proyecto actual
4. **Segundo proyecto** — abrir otro proyecto desde el Hub; debe aparecer **otra pestaña** Preview (iframe propio). Cerrar una no vacía la otra
5. **2º mensaje mientras corre** → cola durable en servidor (badge Queued en transcript); NO peer en el mismo árbol
6. **Varias tareas en la misma sesión** — Enter mientras trabaja = queue; Alt+Enter = parallel (worktree); Cmd/Ctrl+Enter = interrupt
7. **Parallel (2 variantes)** — mismo prompt vía menú / Alt+Enter, comparar, quedarse con una
8. **Mic (Chrome)** — dictar 1 frase; el texto no debe parpadear/desaparecer

### Atajos composer (multitarea)

| Tecla | Comportamiento |
|-------|----------------|
| Enter | Enviar (si el agente trabaja → cola en servidor, como Cursor) |
| Shift+Enter | Nueva línea |
| Alt+Enter | Parallel en worktree aislado (otra conversación) |
| Cmd/Ctrl+Enter | Interrumpir el turno actual y enviar |

## No hacer en vivo

- Depender de mic en Safari/Firefox (el botón sale deshabilitado; dictado solo Chrome/Edge)
- Inventar features no ensayadas
- Mergear features a `master` tras freeze (solo P0)
- Invitar a un segundo usuario real (aislamiento multi-tenant aún no verificado en el VPS)

## Si algo falla

| Síntoma | Acción |
|--------|--------|
| Login cuelga | Incógnito + hard refresh; si no, rollback |
| Preview vacío | Abrir Run & Preview / Vite precalentado; el 2º proyecto debe usar **otra** pestaña, no el mismo iframe |
| Mic mudo | Permiso origin + Chrome; mirar `title` del botón tras error |
| Agente “failed” tras UI ok | Visual-repair exhaustion — narrar y follow-up |
| 3er agente no arranca | Límite concurrencia — narrar cola o subir env |

## Dry-runs

- [ ] Dry-run #1 cronometrado (casa)
- [ ] Top 3 fixes del #1
- [ ] Dry-run #2 (red venue o throttled) + vídeo backup
- [ ] Freeze duro últimas ~6 h

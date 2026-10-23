# Handoff

Estado para continuar el trabajo desde otra cuenta o sesión. Actualízalo al cerrar cada tarea: qué queda pendiente, cómo se validó y qué limitaciones conviene conocer. La política de modelos está en la sección «Selección de modelos y orquestación» de `CLAUDE.md`.

## 2026-10-23 — Política de selección de modelos

**Hecho**
- `CLAUDE.md`: la sección de orquestación sustituye el esquema Fable/Sonnet por Opus (pensar, revisar, decidir) + Haiku (ejecución rutinaria), con reglas de escalado y ejecución.
- `.claude/agents/fast-worker.md`: `model: haiku` (antes `sonnet`) y regla de escalado a `deep-reasoner`. `.claude/agents/deep-reasoner.md` sigue en `model: opus`.
- `scripts/qaap-drift-check.js`: `docs/HANDOFF.md` añadido al `ALLOWED`.

**Validación**
- `node scripts/qaap-drift-check.js` en verde. Sin cambios de código: no aplica compile ni build.

**Limitaciones**
- `.claude/agents/` está en `.gitignore` (`.claude/*`): los cambios de agentes no viajan con el repo. En otra cuenta o máquina, replica el frontmatter `model:` a mano.
- El modelo por defecto de la sesión principal lo fija `~/.claude/settings.json` (`"model"`) o el selector de la app; en la cuenta original se cambió de `fable[1m]` a `opus` el 2026-10-23. En otra cuenta, ajústalo igual.

**Pendiente**
- Nada.

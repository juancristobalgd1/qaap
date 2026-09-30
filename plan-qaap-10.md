# Plan para llevar Qaap a 10/10

*Dos ejes independientes: **producto** (6.5 → 10) e **ingeniería de fork** (8 → 10).*
*Fecha: 2026-09-29 · Anclado en inspección directa del repositorio.*

---

## Hallazgo que ordena todo el plan

Conteo en `packages/**` (excluyendo `lib/` y specs):

| Métrica | Valor |
| --- | --- |
| Definiciones de ruta HTTP (`app/router.get/post/...`) | **160** |
| Archivos que las definen | **24** |
| Archivos que además mencionan ownership/`requireAuth` en el mismo archivo | **12** |
| Archivos con aserciones `ownsWorkspacePath`/`assertWorkspacePathOwned` | **20** (en total, en todo el repo) |

No es una alarma automática: parte de los 12 archivos restantes puede delegar en un middleware común. **Pero la asimetría es la evidencia de que hoy el aislamiento multi-tenant descansa en disciplina humana, no en una barrera mecánica.** Ese único hecho explica la diferencia entre 6.5 y 10.

---

# EJE A — Producto: de 6.5 a 10

## A0. Sweep de ownership por endpoint (palanca #1, hacer primero)

**Objetivo:** que sea imposible añadir un endpoint sin check de aislamiento, sin que CI falle.

**Cómo:**
1. `scripts/qaap-endpoint-ownership-check.js`: extrae del AST/source de cada `packages/qaap-*/src/node/**` toda definición de ruta; clasifica cada una como `guarded` si el handler (o un middleware de la cadena) referencia ownership, si no `unguarded`.
2. Snapshot inicial en `scripts/qaap-endpoint-ownership-baseline.txt` (lista explícita de los `unguarded` actuales, cada uno con comentario de *por qué* está abierto — p.ej. health, oauth callback pre-login, endpoint público con rate-limit).
3. Política ratchet idéntica a la que ya usan para `ts-nocheck` y drift: **la lista solo puede encoger**. Un endpoint nuevo sin guard falla CI.
4. Registrar el script en `.github/workflows/qaap-guards.yml`.

**Hecho cuando:** el baseline está poblado y revisado; un PR que añade un endpoint sin guard falla con un mensaje que dice exactamente qué handler y qué ruta.

**Esfuerzo:** 3–5 días. **Ratio impacto/coste: altísimo.** Es la única medida que convierte el aislamiento en garantía estructural.

## A1. Cerrar los 5 bloqueos operativos abiertos

De `doc/qaap-production-readiness.md` (items 4–8), en este orden:
1. **Ejercicio real de proveedor end-to-end**: repo → task → diff → git, incluyendo cancel, reconexión y restart del servidor. El mock de CI no lo sustituye.
2. **`verify_image` ejecutándose de verdad en CI Linux** antes de cualquier invitado externo.
3. **Restore de backup en instancia limpia** + ensayo de rollback. `qaap-backup-restore-check.sh` hoy verifica extracción, hashes y ownership, **no arranca la aplicación restaurada**.
4. **Límites de gasto y de recurso/concurrencia bajo carga beta.**
5. **Validación de billing, UX móvil y alertas operativas.**

**Hecho cuando:** cada item tiene evidencia reproducible en el VPS Linux real, con fecha y salida cruda guardada en `docs/qa/`, no solo una casilla marcada.

## A2. Endurecer el operador como vector de fallo

El paso a producción depende de `QAAP_BACKEND_PER_TENANT=1` + secreto maestro + dominio de preview. Un error de `.env` es hoy el vector más probable.
- **Empujar el launch gate dentro del propio workflow de deploy**, no como script previo que alguien puede olvidar.
- **Backup desechable del `.env`** previo a cualquier deploy y diff visible del mismo.
- **Post-deploy canary:** un login sintético de dos cuentas y una comprobación de denegación cruzada, ejecutada automáticamente tras cada deploy. Si falla, rollback automático.

**Esfuerzo:** 1 semana. **Hecho cuando:** un `.env` roto no puede llegar a producción sin rollback.

## A3. DR drills programados

Convertir "tenemos scripts de backup" en "hemos restaurado de verdad este mes".
- Cron mensual que restaura el último backup off-site en una instancia desechable, arranca la app, hace un login sintético y publica métricas.
- Objetivo operativo explícito: **RTO y RPO medidos**, no declarados.

**Esfuerzo:** 1–1.5 semanas. **Hecho cuando:** existe un historial de drills con duración real de restore.

## A4. Observabilidad de coste y concurrencia

- Cuotas por tenant *aplicadas* (no solo configuradas), con test que verifica que un tenant no puede exceder su presupuesto de tokens/CPU/contenedores.
- Alertas de fuga de recursos: contenedores huérfanos, workspaces sin dueño activo, jobs zombis.

**Esfuerzo:** 1–2 semanas.

**Criterio de salida del Eje A:** 10 = ningún bloqueo abierto + ownership mecanizado + gates de deploy automáticos + drills de recuperación con historial. Cuando eso esté, la frase "no admitiría terceros" desaparece sola.

---

# EJE B — Ingeniería de fork: de 8 a 10

El 8 es alto. El 10 no se consigue añadiendo más gates, sino **eliminando trabajo manual repetido y deuda de proceso**. Cuatro movimientos:

## B0. Automatizar la re-adopción de upstream (palanca #1)

Hoy el proceso está bien documentado y es **manual**: blob-identity para el fast-forward mecánico + `git merge-file` 3-way para los seams + avanzar a mano `qaap-upstream-base.txt`. Es costoso y por eso se pospone, y posponerlo lo encarece — un bucle que se retroalimenta.

**Cómo:** `scripts/qaap-adopt-upstream.js <new-sha>` que:
1. Calcule el conjunto blob-idéntico (HEAD blob == blob del upstream antiguo) y lo fast-forwardee en **un commit mecánico único**.
2. Liste los ficheros de seam que necesitan 3-way merge y ejecute `git merge-file` dejando los conflictos marcados y un informe por fichero.
3. Proponga el nuevo SHA para `qaap-upstream-base.txt` **solo** cuando todos los conflictos estén resueltos.
4. Emita un informe de triage (cuántos ficheros: mecánicos / seam / conflicto real).

**Hecho cuando:** adoptar un upstream nuevo pasa de días de trabajo a una revisión de horas, y el ciclo puede ser **trimestral y rutinario**.

## B1. Burn-down del baseline de drift

`scripts/qaap-drift-baseline.txt` tiene **84 líneas**. Hoy es "deuda aceptada sin fecha". Convertirlo en objetivo con métrica:
- Añadir la cuenta de baseline a `qaap:drift-report` para que se publique en cada PR.
- Meta: reducir a solo `examples/*` y `dev-packages/cli`, con fecha objetivo. Cada extracción baja el número.
- Cuando llegue a su mínimo justificable, **el reporte lo demuestra**, no una afirmación en un doc.

**Nota positiva que ya está resuelta:** `qaap-ts-nocheck-baseline.txt` está en **0 ficheros**. Ese ratchet ya ganó — es el patrón a repetir con el drift.

## B2. Invariantes de CI como tests, no como prosa

`doc/qaap-ci-invariants.md` es excelente, pero es **conocimiento tribal escrito**: cada regla existe porque un workflow se puso rojo. Riesgo real: alguien "arregla" un fallo raro revirtiendo el invariante sin saber por qué estaba.

**Cómo:** por cada invariante crítico (el `shift 2` del rlimit, el wrapper de spawn, las reglas de terminal), un test ejecutable que **falle si se viola**, referenciando la regla en su nombre. El documento pasa a explicar *por qué*, y el test a garantizar *que*.

**Hecho cuando:** violar un invariante rompe un test local, no un workflow en CI a las 3 de la mañana.

## B3. Higiene de repositorio y determinismo de build

Datos actuales: **68 ramas locales, 148 remotas, 10 worktrees**. Además `lerna-debug.log`, `test-results/` y `.env` en el árbol.
- **Poda gobernada:** script que lista ramas ya mergeadas o cuyo PR está cerrado, con `--dry-run` antes de borrar. Worktrees huérfanos de `worktree-agent-*` igual.
- **Política de retención:** trabajo → PR → delete. Ramas de agente no viven más de N días tras merge.
- **Determinismo:** verificar que el build produce el mismo output ante el mismo lockfile (SBOM y license-check ya existen y son un buen cimiento). Añadir comprobación de reproducibilidad del bundle.

**Hecho cuando:** el número de ramas y worktrees es estable en el tiempo, no monótonamente creciente.

**Criterio de salida del Eje B:** 10 = adoptar upstream es rutinario y barato, el baseline de drift tiende a su mínimo medido, los invariantes los garantizan tests, y el repo no acumula ramas ni artefactos. Un fork que se puede mantener durante años sin equipo creciente.

---

# Secuencia recomendada

| Orden | Movimiento | Eje | Esfuerzo | Por qué en esta posición |
| --- | --- | --- | --- | --- |
| 1 | **A0** sweep de ownership | Producto | 3–5 d | Mayor reducción de riesgo por día invertido en todo el plan |
| 2 | **B0** adopción de upstream automatizada | Fork | 1 sem | Rompe el bucle "posponer lo encarece"; habilita el resto |
| 3 | **A1** cerrar los 5 bloqueos | Producto | 2–3 sem | Es la condición literal para admitir terceros |
| 4 | **B2** invariantes como tests | Fork | 1 sem | Protege todo lo demás de revertirse por accidente |
| 5 | **A2** gate de deploy + canary | Producto | 1 sem | Elimina el vector de fallo más probable |
| 6 | **B1** burn-down de baseline | Fork | continuo | Métrica visible, trabajo incremental |
| 7 | **A3** DR drills | Producto | 1–1.5 sem | Convierte "tenemos backup" en "hemos restaurado" |
| 8 | **A4** cuotas y observabilidad | Producto | 1–2 sem | Cierra el círculo de coste |
| 9 | **B3** higiene y determinismo | Fork | 3–5 d | Limpieza, no bloquea nada |

**Total estimado: 8–11 semanas-persona de un ingeniero senior** para un 10 en ambos ejes. Las tres primeras filas (≈4 semanas) ya mueven el producto por encima de 8.5 y el fork por encima de 9.

---

# La regla que gobierna el plan

El 8 → 10 no se logra escribiendo más documentación ni más gates manuales: se logra **convirtiendo cada garantía que hoy descansa en que alguien se acuerde de hacerlo bien en algo que falla automáticamente cuando no se hace.** Qaap ya demostró que sabe hacer esto (ratchet de `ts-nocheck` a cero, gate de drift, grafo de paquetes verificado). Le falta aplicar el mismo patrón a las tres cosas que aún dependen de disciplina: el ownership por endpoint, la adopción de upstream y los invariantes de CI.

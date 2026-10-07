# Tests en cuarentena (flaky conocidos)

Regla: un test en cuarentena no bloquea PRs, pero no se olvida. Cada uno tiene dueño, causa sospechada y fecha límite.
Para ejecutarlos: `QAAP_RUN_QUARANTINED=1` en local (mocha) o la variable de repo `QAAP_RUN_QUARANTINED=1` (CI, Electron).
Mientras un test de flujo crítico esté aquí, ese flujo se verifica a mano en E3/E4 en cada deploy.

| Test | Fichero | Síntoma | Causa sospechada | Mientras tanto | Salir antes de |
|---|---|---|---|---|---|
| Punto de no leído: "opening A and then B clears the dot on A once the open settles" | packages/qaap-work-hub/src/browser/mobile-work-hub-sessions-sidebar-live-sync.spec.ts | `expected true to equal false` en ubuntu node-22/24 (PR #208, #222, #227) | carrera de temporizadores en el settle del open | Flujo crítico 3: probar a mano A→B→recarga en E3/E4 | 2026-10-12 |
| Electron: basic-example "after all" hook timeout 60 s | examples/electron/test/basic-example.espec.ts (paso "Test (electron)" de ci-cd.yml) | timeout del hook al cerrar Electron (zygote/network service crash) en ubuntu | ruido del runner, qaap no se distribuye en Electron | el paso corre y deja log, no bloquea | 2026-10-16 |
| Shell: "quotes project cwd correctly for POSIX shells" | packages/qaap-shared-core/src/browser/qaap-project-bootstrap-shell.spec.ts | timeout 2000 ms al lanzar la shell (ubuntu node-24, #223) | arranque lento de shell en runner cargado | cubierto por el resto de specs del fichero | 2026-10-12 |

Ya arreglado, fuera de cuarentena: QaapTenantRuntimeStore "flushes a throttled touch with a trailing timer" (#221).

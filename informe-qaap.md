# Informe de evaluación del proyecto Qaap

*Perspectiva: ingeniería senior · Fecha: 2026-09-29 · Basado en inspección directa del repositorio*

## 1. Qué es

Qaap es un fork productivo de **Eclipse Theia** (monorepo Lerna, ~96 paquetes) convertido en un IDE/agente AI multi-tenant desplegable en VPS: Work Hub + IDE, sesiones de agente con aprobaciones, preview de apps, terminales, cloud workspace por tenant y persistencia SQLite. El fork añade **19 paquetes `qaap-*` con ~317.000 LOC y 609 archivos spec** sobre la base upstream, más ~1.000 archivos de spec en total en el repo.

## 2. Lo que está genuinamente bien (por encima del promedio)

1. **Política de drift upstream de primer nivel.** `scripts/qaap-drift-check.js` + baseline + `qaap-upstream-base.txt` fijan la revisión upstream y fallan en CI ante drift nuevo no justificado. La campaña de extracción terminó (julio 2026): todo lo de fuera de `packages/qaap-*` es byte-idéntico a upstream, un seam documentado o un baseline. Esto es la decisión más difícil de un fork largo y la tienen resuelta y mecanizada. Pocos forks llegan a este estado.
2. **Gestión de riesgo multi-tenant seria.** `MULTI_TENANCY_AUDIT.md` (v5) no es marketing: es una matriz por recurso con evidencia reproducible, reconoce abiertamente que Theia es single-tenant por diseño y que la capa multi-tenant va **encima** de esa base (backend-per-tenant detrás de `QAAP_BACKEND_PER_TENANT=1`, contenedores no-root, rootfs read-only, `CapDrop=ALL`, redes dedicadas, gate que bloquea arranques incompletos). La honestidad sobre lo que NO cubre (singleton interno de `ProcessManager`, logs centralizados como datos de operador) es señal de madurez.
3. **Ingeniería de procesos madura.** 20 workflows de GitHub (drift, guards, license-check, SBOM, smoke, playwright móvil, deploy con `verify_image` obligatorio por digest), ratchets anti-regresión (`ts-nocheck`, ESLint), check de grafo de paquetes (`qaap-package-graph-check.js`), scripts de backup/restore verificados, launch gate que falla si falta configuración. `doc/qaap-ci-invariants.md` documenta cada invariante con el incidente que lo originó — conocimiento institucional real.
4. **Arquitectura de producto limpia.** El split del antiguo monolito `qaap-mobile-shell` en capas (`mobile-shell < shared-core < diff-review < agents-ui < transcript < composer < work-hub`) con imports solo hacia abajo y contratos estructurales en vez de dependencias circulares es un refactor correctamente ejecutado y *verificado mecánicamente*.
5. **Documentación honesta.** `doc/qaap-production-readiness.md` distingue explícitamente "compila" de "es evidencia de aislamiento/fiabilidad", y marca qué items del bloqueo de lanzamiento están hechos con fecha y cuáles no. Los scripts tienen tests propios.

## 3. Riesgos y debilidades que yo vigilaría

1. **Deuda estructural de fondo: Theia single-tenant.** El aislamiento por contenedor es sólido, pero descansa en que *todo* acceso pase por las fronteras implementadas. El audit lo admite: el `ProcessManager` sigue siendo singleton de proceso; la seguridad depende de que cada endpoint nuevo aplique `assertWorkspacePathOwned`. **Cada PR futuro que toque un endpoint es una oportunidad de fuga.** No veo un test de propiedad/sweep que liste endpoints sin check de ownership; lo añadiría.
2. **Dependencia extrema del gate.** La seguridad por defecto ("privada/híbrida") está bien, pero el paso a producción activa `QAAP_BACKEND_PER_TENANT=1` + secreto maestro + dominio de preview separado. Un error de operador en el `.env` del VPS es el vector más probable; el launch gate mitiga, pero conviene automatizar el gate *dentro* del flujo de deploy, no solo como script previo.
3. **Items abiertos del launch blocker (a 2026-09-27):** ejercicio real de proveedor end-to-end (repo → task → diff → git con cancel/reconnect/restart), `verify_image` aún sin ejecutarse en CI Linux real, ensayo de restore de backup en instancia limpia, y validación de límites de gasto/concurrencia bajo carga beta. Son exactamente los tests que los mocks no cubren. **No admitirían terceros hasta cerrarlos.**
4. **~317k LOC de producto con capas nuevas todavía asentándose.** `qaap-cloud-workspace` (70k LOC, 151 specs) y `qaap-shared-core` (59k LOC, 135 specs) son grandes; la ratio de specs (~19%) es decente para Theia pero los specs tienden a cubrir lifecycle más que adversarial (isolation cross-user sí está testeado — bien). El archivo `MULTI_TENANCY_AUDIT.md` en la raíz del repo es señal de que conviene moverlo a `doc/` antes de que quede huérfano.
5. **Higiene del repositorio.** ~60 ramas locales `claude/*`/`worktree-agent-*` y ~150 ramas remotas acumuladas sin podar; `lerna-debug.log`, `test-results/` y `.env` en el directorio de trabajo. Riesgo bajo pero real de confusión operativa y de commitear artefactos. Una política de poda (trabajo→PR→delete) mantendría el grafo legible.
6. **Versionado del fork frente a upstream.** El proceso de re-adopción está documentado (blob-identity + merge-file 3-way) pero es manual y costoso; cada mes de retraso encarece la siguiente adopción. Recomendaría un ciclo programado (trimestral) aunque sea pequeño, en lugar de adopciones monolíticas.

## 4. Veredicto

**Nota: 8/10 como ingeniería de fork, 6.5/10 como producto listo para beta pública.**

Es un fork de Theia *excepcionalmente bien gobernado*: la política de drift, los gates de CI y la auditoría multi-tenant están al nivel de un equipo de plataforma experimentado, y la documentación no miente. La debilidad no está en lo construido, sino en lo que falta **validar operativamente** (items 4-8 del readiness) y en el mantenimiento perpetuo que exige un fork: el sistema está diseñado asumiendo que cada endpoint y cada PR son una superficie de ataque, y solo la disciplina continua — mecanizada en CI, no en buena voluntad — sostiene esa asunción.

Prioridades si yo tomara el mando mañana:
1. Cerrar los 5 items abiertos de production-readiness en el VPS real (especialmente el ejercicio de proveedor end-to-end y el restore de backup).
2. Añadir un test de barrido que falle ante cualquier endpoint sin check de ownership.
3. Programar el ciclo de re-adopción de upstream y podar ramas muertas.
4. Ejecutar `verify_image` en CI Linux real antes de cualquier invitado externo.

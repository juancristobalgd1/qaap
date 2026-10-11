# Plan de port: fast load v2

## Base y objetivo

- Rama de trabajo: `fo/fast-load-v2`, basada en `origin/master` (`2dc3a92db`, 11 oct 2026).
- Origen revisado: `origin/fo/mobile-fast-load`; rango completo `origin/master..origin/fo/mobile-fast-load` (nueve commits, diff total 14 archivos).
- Meta del port: conservar el arranque actual de Qaap y hacer que las entradas de frontend que realmente cambian de contenido tengan URL con hash, caché immutable y compresión Brotli con fallback gzip. `index.html`, el service worker y toda entrada sin hash deben revalidarse.
- Límites de esta máquina: no ejecutar build, webpack, Docker ni Playwright. Tras cada commit portado ejecutar solo los tests afectados y el `tsc` de cada paquete TypeScript afectado; confirmar los scripts Node de forma dirigida. Publicar cada paso verde antes de continuar.

## Qué contiene cada commit del origen

| Orden | Commit | Contenido y decisión preliminar |
| --- | --- | --- |
| 1 | `333b85420` `fix(mobile): preserve desktop preload and isolate phone assets` | Extrae la política HTML a `qaap-product/resources`, evita descargar la hoja/entrada IDE desde el documento móvil sin sesión y conserva el preload de escritorio. Master #205 ya implementó la política compartida y la protección móvil; #216 hizo idempotente el parcheo del índice. Tratar el cherry-pick como posiblemente redundante y verificarlo, sin volver al helper anterior ni quitar el preload de escritorio. |
| 2 | `383ebc1a0` `fix(auth): keep sign-in available on config probe failure` | Replica el contrato en el login gate TS y sus pruebas: si falla el probe de capacidades OAuth, el botón GitHub sigue habilitado y no se informa que el servidor está caído. Master #205 ya contiene este comportamiento tanto en el gate como en la prueba de accesibilidad; confirmar si no queda delta. |
| 3 | `4ab630733` `test(product): legal static-sync spec follows cache-busting into the shared asset policy` | Ajusta el test de páginas legales cuando la reescritura de assets se movió al helper compartido. La política compartida ya existe en master; conservar el test actual y aplicar solo una diferencia real. |
| 4 | `d437fd2aa` `test(auth): login gate contract normalizes CRLF so the catch-body slice holds on Windows` | Normaliza CRLF antes de inspeccionar texto fuente en el test de accesibilidad. Mantenerlo si master aún no lo hace; no es un cambio runtime. |
| 5 | `cc5ecedb1` `perf(mobile): source inventory of the Work Hub frontend graph` | Añade un inventario estático de imports/paquetes/CSS, sin cambiar el bundle. Es diagnóstico, no una separación de bundles ni prueba de que la app móvil no descargue el grafo compartido. Revisar sus rutas y mediciones contra el master modular actual; eliminar cifras estáticas obsoletas o descartar el commit si el inventario no representa el grafo actual. |
| 6 | `90e94d339` `perf(frontend): content-hashed entry, immutable caching and Brotli` | Copia `bundle.js/css` a nombres SHA-256, mantiene la generación anterior, reescribe los meta del índice, comprime entradas/chunks en `.br` y `.gz` y negocia encoding en middleware temprano; amplía tests de cabeceras y gate. Es el cambio runtime principal. Portar con adaptación y tests, preservando los imports/chunks esbuild y los límites de `QaapFrontendStaticServer`. |

## Revisión de los tres WIP sin verificar

- `2f7e35aac`: mezcla defer de CSS móvil, cambios al gate y un botón Retry. El gate móvil, el estilo diferido y la disponibilidad del botón ya se integraron/revisaron en #205/#216. No copiarlo entero; comparar solo si queda una regresión demostrable.
- `4ae3cfa4a`: mueve el helper y sus tests, pero elimina todos los `modulepreload` del bundle. Esto contradice `333b85420` y la política actual que conserva el preload en escritorio; descartar esa eliminación. La política de hashes del commit 90 reemplaza ese helper.
- `b37e5c625`: altera el manejo de Retry y recupera el flujo auth-first del escritorio. #216 ya contiene la división móvil/escritorio y los tests de puerta móvil; no reintroducir su estado intermedio ni duplicar arranques. Mantener los cambios actuales de `dismissLoginGate`, prefetch y session probe.

## Choques con master que guían la resolución

1. **#216, doble arranque y service worker:** el segundo pase de `copy-frontend-static` debe seguir siendo idempotente. El registro del SW no puede recargar al primer `controllerchange` de `clients.claim()`; la recarga única solo corresponde al reemplazo de un worker que ya controlaba la página. No cambiar ese ciclo ni volver a iniciar módulos dos veces.
2. **#226/#229, IDE desde Work Hub y Explorer:** el salto al IDE ocurre en la misma pestaña y el Explorer debe aparecer expandido. El port no debe añadir navegación/reload, cambiar la composición del frontend o adelantar lecturas de Work Hub cuando la pestaña prefiera IDE. Los assets hashed deben conservar las rutas relativas a chunks compartidos.
3. **#208, preview cerrada:** el estado de descarte por usuario vive en `sessionStorage` y sobrevive al bootstrap. No introducir recargas de índice/service worker que reabran preview o borren el estado.
4. **Login/OAuth:** #205 y #216 conservan sign-in ante un probe de config fallido, gate inmediato en móvil y el arranque/preload normal en escritorio. Mantener `qaap_oauth`/callback y la confirmación de sesión. `bundle.js` aún es el grafo común del frontend; el inventario no crea por sí solo una variante Work Hub-only. La garantía a probar en este port es que el documento móvil no inicia las referencias IDE antes de confirmar sesión.
5. **Service worker y caché:** `index.html`, `secondary-window.html`, `service-worker.js`, manifest y assets sin huella nunca serán immutable. Solo `bundle-<hash>`, `chunk-<hash>` (y sus representaciones comprimidas) pueden tener `max-age=31536000, immutable`. El index/gate debe apuntar a un único hash coherente.
6. **Servidor y Caddy:** `QaapFrontendStaticServer` es el seam que sirve `lib/frontend`; Caddy solo termina TLS/reverse-proxy y configura gzip/zstd. La negociación de `.br` debe ocurrir antes del handler gzip de Theia, respetar `Accept-Encoding`/q-values, indicar `Vary: Accept-Encoding`, mantener el MIME del asset original y servir `.gz` si `.br` no existe o no se acepta. Todo lo que no sea el asset hashed permitido sigue por los handlers existentes.
7. **`ops/qaap-guards.yml`:** es el check requerido y no tiene filtros de paths; incluye drift, package graph, compilación y smoke móvil. No modificar nombres, exclusiones, orden de despliegue ni añadir filtros. Se leyó `doc/qaap-ci-invariants.md`; no se tocarán tenant spawn, workflows ni reglas de preview.

## Orden de port y validación por paso

1. Portar/verificar `333b85420` como cambio ya cubierto por #205/#216; si no queda delta, registrarlo como superseded y no crear un commit vacío.
2. Portar/verificar `383ebc1a0`; mantener contrato de sign-in y tests. Correr test mocha de `qaap-cloud-workspace` y `tsc` de ese paquete si queda delta.
3. Portar `4ab630733` y `d437fd2aa` solo si el diff efectivo añade cobertura; validar tests mocha de los paquetes afectados y `tsc` de los paquetes TS.
4. Revisar/portar `cc5ecedb1` en una operación separada; ejecutar el script con Node y contrastar las rutas contra los módulos actuales. Excluir/actualizar la métrica de bundle histórica si no es verificable sin build.
5. Portar `90e94d339` y resolver sus conflictos contra master conservando #216. Añadir pruebas de: cabeceras por clase de asset; reescritura del entry a nombre con hash; y ausencia de solicitud de assets IDE en la carga móvil previa a sesión. Verificar middleware de Brotli/gzip y fallback con tests dirigidos; ejecutar mocha del paquete `qaap-product`, test(s) Node del helper y `tsc` de `qaap-product` y `examples/browser` solo si hay TypeScript afectado. No hacer build completo.
6. Publicar cada paso que esté verde antes de pasar al siguiente; usar commits convencionales y autor `Fo (Wajo) <fo@wajo.ai>`. Al final, escribir el resumen de port, descartes, verificaciones, riesgos y plan de medición en staging.

## Criterio de medición en staging

Comparar navegador limpio y recarga en escritorio 1280×800 y móvil 375×812, con `PerformanceNavigationTiming`, `PerformanceResourceTiming` y DevTools Network. Medir hasta que Work Hub sea interactivo, no solo hasta `DOMContentLoaded`; registrar bytes transferidos por encoding, cantidad de recursos, tiempos de sesión/API, caché y superficie activa. En recarga confirmar `index.html` revalidado (304 o equivalente), entrada/chunks hashed desde caché immutable y ausencia de solicitudes IDE previas a sesión en móvil. Objetivos: primera carga ≤4 s, recarga ≤2 s. Anotar backend caliente/frío, navegador, red y versión del deploy para que la comparación sea repetible.

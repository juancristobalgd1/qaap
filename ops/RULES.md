# Reglas operativas de qaap (vigentes hasta el 16 oct)

Fuente: Juan, 2026-10-07. Estas reglas mandan sobre cualquier prompt de turno.

- Objetivo unico: los flujos criticos de ops/state.json funcionan en prod con los datos reales de Juan el 16 oct. Lo que no desbloquee un flujo critico queda fuera. Desde el 13 oct solo bugs de esos flujos.
- Movil solo Work Hub, nunca codigo del IDE. Cada cambio se prueba en IDE y Work Hub sin efectos cruzados.
- Max 2 agentes de codigo a la vez. Sin maquinas nuevas. Max 2 PRs abiertos.
- Ningun agente recibe permisos de merge ni secretos de produccion.
- Un check en rojo nunca se ignora: se arregla o se elimina del workflow.
- Estados: E1 mergeado (SHA) -> E2 desplegado (health = SHA) -> E3 probado con cuenta de prueba -> E4 probado con datos de Juan. Prohibido decir "arreglado" o "hecho" por debajo de E4. Evidencia E3/E4: pasos, segunda accion, recarga y consulta SQLite.
- Estado: ops/state.json (rama fo/ops). Log de solo anadir: plan6-findings.md. Prompt de traspaso: "lee ops/state.json y sigue la cola".
- Ciclo ~40 min: leer state.json + ultimas 20 lineas del log; comprobar agentes, CI, deploy, health; ejecutar la primera accion desbloqueada; actualizar state.json, log y programar el siguiente.
- Programador: Claude Code (Opus) en runner de Actions por workflow_dispatch; plan B sandbox con limite 25 min y push cada 5 min. Prompt: causa raiz, spec que falla con datos reales, arreglo, specs en verde, tsc, build del paquete, informe .md. Cambios con riesgo detras de flag apagado.
- Revisor: Codex (solo revisa diff + informe): causa raiz, que rompe en el otro modo, rutas Windows, datos antiguos/otras claves. Desacuerdo sin resolver = no PR.
- CI en PR: Linux + Windows node 22; matriz completa en master y nocturna. Flaky: relanzar ese job una vez; segundo fallo = real.
- Staging en el mismo VPS con copia de la SQLite de Juan. Ningun PR se mergea sin E3 y E4 en staging.
- Merge squash de uno en uno, max 2 PRs por deploy. Deploy bueno = Deploy over SSH + Verify deployed build + smoke post-deploy verde + health. Prod caida >10 min: rollback a digest_sano y email a Juan. Tras cada deploy bueno, actualizar digest_sano.
- En prod repetir E3 y E4 (1280 y 375x812). Movil con sesion no verificable = decirlo y pedir a Juan esa comprobacion con pasos exactos.
- Email a Juan solo en E4, si prod cae o si hace falta algo suyo (una peticion, paso exacto). Fin de turno: una linea con PR, estado E0-E4 y siguiente accion.

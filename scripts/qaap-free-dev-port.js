#!/usr/bin/env node
/**
 * Frees the default Qaap browser dev port when a stale Node/Theia process is still listening.
 * Safe to run before `npm run start:browser` — no-op when the port is already free.
 */
const { execSync, spawnSync } = require('child_process');

const HOST = process.env.QAAP_DEV_HOST ?? '127.0.0.1';
const PORT = Number(process.env.QAAP_DEV_PORT ?? 3000);

function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // busy-wait — script is tiny and exits immediately after
    }
}

function listListenerPids() {
    const probe = spawnSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    if (probe.status !== 0 || !probe.stdout.trim()) {
        return [];
    }
    return [...new Set(
        probe.stdout
            .trim()
            .split('\n')
            .map(value => Number(value.trim()))
            .filter(pid => Number.isFinite(pid) && pid > 0),
    )];
}

function resolveCommand(pid) {
    try {
        return execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8' }).trim() || 'unknown';
    } catch {
        return 'unknown';
    }
}

function terminate(pid) {
    try {
        process.kill(pid, 'SIGTERM');
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
            return;
        }
        throw error;
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            process.kill(pid, 0);
            sleep(100);
        } catch {
            return;
        }
    }
    try {
        process.kill(pid, 'SIGKILL');
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
            return;
        }
        throw error;
    }
}

function isStaleDevListener(command) {
    const base = command.split('/').pop() ?? command;
    return base === 'node' || base === 'electron';
}

function main() {
    const pids = listListenerPids();
    if (pids.length === 0) {
        return;
    }
    const stale = [];
    const foreign = [];
    for (const pid of pids) {
        const command = resolveCommand(pid);
        if (isStaleDevListener(command)) {
            stale.push({ pid, command });
        } else {
            foreign.push({ pid, command });
        }
    }
    if (foreign.length > 0) {
        const summary = foreign.map(entry => `${entry.command}:${entry.pid}`).join(', ');
        console.error(
            `[qaap] Puerto ${HOST}:${PORT} ocupado por ${summary}. `
            + 'Cierra ese proceso manualmente o usa QAAP_DEV_PORT=3001 npm run start:browser',
        );
        process.exit(1);
    }
    for (const entry of stale) {
        console.warn(`[qaap] Liberando puerto ${PORT}: terminando ${entry.command} (pid ${entry.pid})`);
        terminate(entry.pid);
    }
    if (listListenerPids().length > 0) {
        console.error(`[qaap] No se pudo liberar ${HOST}:${PORT}`);
        process.exit(1);
    }
    console.warn(`[qaap] Puerto ${PORT} libre — arrancando servidor de desarrollo`);
}

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[qaap] No se pudo comprobar el puerto ${PORT}: ${message}`);
    process.exit(1);
}

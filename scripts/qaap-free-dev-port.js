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
    if (process.platform === 'win32') {
        const probe = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
        if (probe.status !== 0 || !probe.stdout.trim()) {
            return [];
        }
        return [...new Set(
            probe.stdout
                .split(/\r?\n/)
                .map(line => line.trim().split(/\s+/))
                .filter(parts => parts[0] === 'TCP' && parts[3] === 'LISTENING' && parts[1]?.endsWith(`:${PORT}`))
                .map(parts => Number(parts[4]))
                .filter(pid => Number.isFinite(pid) && pid > 0),
        )];
    }

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
        if (process.platform === 'win32') {
            const probe = spawnSync('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\").Name`,
            ], { encoding: 'utf8' });
            return probe.stdout?.trim() || 'unknown';
        }
        return execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8' }).trim() || 'unknown';
    } catch {
        return 'unknown';
    }
}

function terminate(pid) {
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        return;
    }
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
    const base = command.split(/[\\/]/).pop()?.toLowerCase() ?? command.toLowerCase();
    return base === 'node' || base === 'node.exe' || base === 'electron' || base === 'electron.exe';
}

/**
 * Kills orphaned Theia plugin-hosts and their LSP children left by previous backend runs.
 *
 * When the Theia backend is killed (SIGKILL, OOM, Ctrl-C without graceful shutdown), its
 * plugin-host processes and their LSP children (eslint, json-language-features, tsserver)
 * are reparented to PID 1 (launchd) and never cleaned up. Over many restarts they accumulate
 * unboundedly (observed: 65 plugin-hosts, ~195 processes, 16 GB swap). This function finds
 * node processes whose PPID is 1 and whose command line matches a Theia plugin pattern, and
 * terminates them before starting a fresh backend.
 */
function killOrphanedPluginHosts() {
    const patterns = [
        'plugin-host',
        'eslintServer.js',
        'jsonServerMain',
        'tsserver.js',
        'typingsInstaller.js',
    ];
    // List node processes with PPID=1 (orphaned) and full command line
    const probe = spawnSync('ps', ['-eo', 'pid,ppid,args'], { encoding: 'utf8' });
    if (probe.status !== 0 || !probe.stdout.trim()) {
        return 0;
    }
    const lines = probe.stdout.trim().split('\n').slice(1); // skip header
    let killed = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        const pidMatch = trimmed.match(/^(\d+)\s+1\s+/); // pid, ppid=1
        if (!pidMatch) {
            continue;
        }
        const pid = Number(pidMatch[1]);
        if (!Number.isFinite(pid) || pid <= 1) {
            continue;
        }
        const matchesPattern = patterns.some(pattern => trimmed.includes(pattern));
        if (!matchesPattern) {
            continue;
        }
        try {
            process.kill(pid, 'SIGTERM');
            killed += 1;
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
                continue; // already gone
            }
            // best-effort — don't let a single failure block startup
        }
    }
    return killed;
}

function main() {
    const orphans = killOrphanedPluginHosts();
    if (orphans > 0) {
        console.warn(`[qaap] Limpiando ${orphans} proceso(s) plugin-host/LSP huérfanos de backends anteriores`);
    }
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

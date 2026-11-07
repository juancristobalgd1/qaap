#!/usr/bin/env node
// Allowlist proxy in front of the gVisor tenant dockerd (/run/docker-tenants/docker.sock).
//
// The control plane talks to this proxy, never to the raw daemon socket. Only the Docker
// Engine API endpoints listed in ROUTES are forwarded; everything else gets 403. Container
// creation is inspected and rejected when it asks for anything that would weaken the gVisor
// sandbox (privileged mode, host namespaces, a non-runsc runtime, devices, unlisted bind
// sources, unconfined security options, or a missing tenant label).
//
// Interactive attach and exec start use HTTP connection upgrade (hijack). Those requests are
// forwarded as a bidirectional byte stream after the upstream answers.
//
// No npm dependencies: Node >= 22 only. Configuration is by environment variable (see loadConfig).
// Logs contain method, path and the denial reason, never request bodies.

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BODY_BYTES = 1024 * 1024;
const ALLOWED_CAPS = new Set(['SETUID', 'SETGID']);
const TENANT_LABELS = ['com.qaap.tenant-container', 'com.qaap.tenant-backend'];
const DEFAULT_LISTEN = '/run/docker-tenants/proxy.sock';
const DEFAULT_UPSTREAM = '/run/docker-tenants/docker.sock';
const DEFAULT_DATA_ROOT = '/opt/qaap-runtime';
const DEFAULT_REGISTRIES = ['ghcr.io'];

/**
 * Route allowlist. `check` names a body or query inspection. `upgrade` marks endpoints that
 * may be hijacked (HTTP Upgrade); they are the only ones allowed to upgrade.
 * @type {ReadonlyArray<{ method: string, pattern: RegExp, check?: string, upgrade?: boolean }>}
 */
const ROUTES = [
    { method: 'GET', pattern: /^\/_ping$/ },
    { method: 'HEAD', pattern: /^\/_ping$/ },
    { method: 'GET', pattern: /^\/version$/ },
    { method: 'GET', pattern: /^\/info$/ },
    // Read-only listing: the control plane's discovery reads container labels from it.
    { method: 'GET', pattern: /^\/containers\/json$/ },
    { method: 'POST', pattern: /^\/containers\/create$/, check: 'create' },
    { method: 'POST', pattern: /^\/containers\/[^/]+\/(start|stop|kill|wait)$/ },
    { method: 'GET', pattern: /^\/containers\/[^/]+\/json$/ },
    { method: 'GET', pattern: /^\/containers\/[^/]+\/logs$/ },
    { method: 'DELETE', pattern: /^\/containers\/[^/]+$/ },
    { method: 'POST', pattern: /^\/containers\/[^/]+\/attach$/, upgrade: true },
    { method: 'POST', pattern: /^\/containers\/[^/]+\/exec$/, check: 'execCreate' },
    { method: 'GET', pattern: /^\/exec\/[^/]+\/json$/ },
    { method: 'POST', pattern: /^\/exec\/[^/]+\/start$/, upgrade: true },
    { method: 'POST', pattern: /^\/networks\/create$/, check: 'networkCreate' },
    { method: 'POST', pattern: /^\/networks\/[^/]+\/(connect|disconnect)$/ },
    { method: 'GET', pattern: /^\/networks$/ },
    { method: 'GET', pattern: /^\/networks\/[^/]+$/ },
    { method: 'DELETE', pattern: /^\/networks\/[^/]+$/ },
    { method: 'GET', pattern: /^\/images\/.+\/json$/ },
    { method: 'POST', pattern: /^\/images\/create$/, check: 'imagePull' },
    { method: 'POST', pattern: /^\/volumes\/create$/ },
    { method: 'GET', pattern: /^\/volumes\/[^/]+$/ },
    { method: 'DELETE', pattern: /^\/volumes\/[^/]+$/ }
];

/**
 * @typedef {{
 *   listenPath: string,
 *   upstreamPath: string,
 *   socketMode: number,
 *   dataRoot: string,
 *   allowedVolumes: string[],
 *   allowedRegistries: string[]
 * }} ProxyConfig
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {ProxyConfig}
 */
export function loadConfig(env = process.env) {
    return {
        listenPath: env.QAAP_TENANT_PROXY_LISTEN || DEFAULT_LISTEN,
        upstreamPath: env.QAAP_TENANT_PROXY_UPSTREAM || DEFAULT_UPSTREAM,
        socketMode: parseInt(env.QAAP_TENANT_PROXY_SOCKET_MODE || '660', 8),
        dataRoot: path.posix.resolve(env.QAAP_TENANT_DATA_ROOT || DEFAULT_DATA_ROOT),
        allowedVolumes: splitList(env.QAAP_TENANT_ALLOWED_VOLUMES),
        allowedRegistries: env.QAAP_TENANT_ALLOWED_REGISTRIES === undefined
            ? [...DEFAULT_REGISTRIES]
            : splitList(env.QAAP_TENANT_ALLOWED_REGISTRIES)
    };
}

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
function splitList(value) {
    return (value ?? '').split(',').map(entry => entry.trim()).filter(entry => entry.length > 0);
}

/**
 * Strips the optional API version prefix (`/v1.47/...`) and any trailing slash. Query string excluded.
 * @param {string} url
 * @returns {string}
 */
export function apiPathOf(url) {
    const queryIndex = url.indexOf('?');
    const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
    const unversioned = pathname.replace(/^\/v\d+(?:\.\d+)*(?=\/)/, '');
    return unversioned.replace(/\/+$/, '') || '/';
}

/**
 * Rejects paths whose decoded form contains dot segments or empty segments, so that the
 * daemon's router cannot normalise them into a different endpoint than the one checked.
 * @param {string} url
 * @returns {boolean}
 */
function isAmbiguousPath(url) {
    const queryIndex = url.indexOf('?');
    const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        return true;
    }
    if (decoded.includes('//')) {
        return true;
    }
    return decoded.split('/').some(segment => segment === '.' || segment === '..');
}

/**
 * @param {string} image
 * @returns {string} the registry host, `docker.io` when the reference has none
 */
export function registryOf(image) {
    const first = image.split('/')[0];
    if (image.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost')) {
        return first;
    }
    return 'docker.io';
}

/**
 * @param {URLSearchParams} query
 * @param {ProxyConfig} cfg
 * @returns {string | undefined} denial reason, or undefined when allowed
 */
export function checkImagePull(query, cfg) {
    if (query.has('fromSrc')) {
        return 'image import (fromSrc) is not allowed';
    }
    const image = query.get('fromImage') ?? '';
    if (image.length === 0) {
        return 'fromImage is required';
    }
    const registry = registryOf(image);
    if (!cfg.allowedRegistries.includes(registry)) {
        return `registry ${registry} is not in QAAP_TENANT_ALLOWED_REGISTRIES`;
    }
    return undefined;
}

/**
 * @param {string} source
 * @param {ProxyConfig} cfg
 * @returns {string | undefined}
 */
function checkBindSource(source, cfg) {
    if (!source.startsWith('/')) {
        return checkVolumeName(source, cfg);
    }
    const resolved = path.posix.resolve(source);
    if (resolved === cfg.dataRoot || resolved.startsWith(`${cfg.dataRoot}/`)) {
        return undefined;
    }
    return `bind source ${source} is outside ${cfg.dataRoot}`;
}

/**
 * @param {string} name
 * @param {ProxyConfig} cfg
 * @returns {string | undefined}
 */
function checkVolumeName(name, cfg) {
    return cfg.allowedVolumes.includes(name) ? undefined : `volume ${name} is not allowed`;
}

/**
 * Inspects a container create body. Returns the denial reason, or undefined when it is safe.
 * @param {any} spec parsed JSON body
 * @param {ProxyConfig} cfg
 * @returns {string | undefined}
 */
export function checkContainerCreate(spec, cfg) {
    const labels = spec.Labels ?? {};
    if (!TENANT_LABELS.some(label => labels[label] === 'true')) {
        return `container is missing the ${TENANT_LABELS.join(' or ')} label`;
    }
    const host = spec.HostConfig ?? {};
    if (host.Privileged) {
        return 'privileged containers are not allowed';
    }
    if (host.Runtime !== undefined && host.Runtime !== '' && host.Runtime !== 'runsc') {
        return `runtime ${host.Runtime} is not allowed (only runsc)`;
    }
    for (const cap of host.CapAdd ?? []) {
        const normalised = String(cap).toUpperCase().replace(/^CAP_/, '');
        if (!ALLOWED_CAPS.has(normalised)) {
            return `capability ${cap} is not allowed`;
        }
    }
    if ((host.Devices ?? []).length > 0) {
        return 'device mappings are not allowed';
    }
    if ((host.DeviceRequests ?? []).length > 0) {
        return 'device requests (GPUs) are not allowed';
    }
    if ((host.VolumesFrom ?? []).length > 0) {
        return 'volumes-from is not allowed';
    }
    for (const field of ['PidMode', 'IpcMode', 'UTSMode', 'UsernsMode', 'CgroupnsMode']) {
        if (host[field] === 'host') {
            return `${field}=host is not allowed`;
        }
    }
    const networkMode = String(host.NetworkMode ?? '');
    if (networkMode === 'host' || networkMode.startsWith('container:')) {
        return `NetworkMode ${networkMode} is not allowed`;
    }
    if ((host.SecurityOpt ?? []).some(option => String(option).includes('unconfined'))) {
        return 'unconfined security options are not allowed';
    }
    for (const bind of host.Binds ?? []) {
        const source = String(bind).split(':')[0];
        const reason = checkBindSource(source, cfg);
        if (reason) {
            return reason;
        }
    }
    for (const mount of host.Mounts ?? []) {
        if (mount.Type === 'bind') {
            const reason = checkBindSource(String(mount.Source ?? ''), cfg);
            if (reason) {
                return reason;
            }
        } else if (mount.Type === 'volume') {
            const reason = checkVolumeName(String(mount.Source ?? ''), cfg);
            if (reason) {
                return reason;
            }
        } else if (mount.Type !== 'tmpfs') {
            return `mount type ${mount.Type} is not allowed`;
        }
    }
    return undefined;
}

/**
 * @param {any} spec
 * @returns {string | undefined}
 */
function checkExecCreate(spec) {
    return spec.Privileged ? 'privileged exec is not allowed' : undefined;
}

/**
 * Only the default bridge driver: macvlan, ipvlan and overlay attach to host interfaces.
 * @param {any} spec
 * @returns {string | undefined}
 */
function checkNetworkCreate(spec) {
    const driver = spec.Driver ?? 'bridge';
    return driver === 'bridge' ? undefined : `network driver ${driver} is not allowed`;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
function readBody(req, limit) {
    // An oversize body is drained, not abandoned: answering while the client is still sending
    // makes the kernel reset the connection and the client loses the response. The drain is
    // capped at 64x the limit, after which the request is aborted.
    const drainCap = limit * 64;
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let overflow = false;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > drainCap) {
                req.destroy();
                return;
            }
            if (size > limit) {
                overflow = true;
                chunks.length = 0;
                return;
            }
            if (!overflow) {
                chunks.push(chunk);
            }
        });
        req.on('end', () => {
            if (overflow) {
                reject(Object.assign(new Error(`request body exceeds ${limit} bytes`), { status: 413 }));
            } else {
                resolve(Buffer.concat(chunks));
            }
        });
        req.on('error', reject);
        req.on('close', () => reject(Object.assign(new Error('request aborted'), { status: 400 })));
    });
}

/**
 * Decides whether a request may be forwarded.
 * @param {import('node:http').IncomingMessage} req
 * @param {ProxyConfig} cfg
 * @param {{ isUpgrade: boolean, readRequestBody?: () => Promise<Buffer> }} options
 * @returns {Promise<{ ok: true, body?: Buffer } | { ok: false, status: number, reason: string }>}
 */
export async function evaluateRequest(req, cfg, options) {
    const deny = (status, reason) => ({ ok: false, status, reason });
    if (isAmbiguousPath(req.url ?? '')) {
        return deny(400, 'ambiguous request path');
    }
    const apiPath = apiPathOf(req.url ?? '/');
    const route = ROUTES.find(candidate => candidate.method === req.method && candidate.pattern.test(apiPath));
    if (!route) {
        return deny(403, `${req.method} ${apiPath} is not allowed`);
    }
    if (options.isUpgrade && !route.upgrade) {
        return deny(403, `connection upgrade on ${apiPath} is not allowed`);
    }
    try {
        if (route.check === 'create' || route.check === 'execCreate' || route.check === 'networkCreate') {
            const body = await options.readRequestBody();
            let spec;
            try {
                spec = JSON.parse(body.toString('utf8') || 'null');
            } catch {
                return deny(400, 'request body is not valid JSON');
            }
            if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
                return deny(400, 'request body must be a JSON object');
            }
            const reason = route.check === 'create'
                ? checkContainerCreate(spec, cfg)
                : route.check === 'execCreate' ? checkExecCreate(spec) : checkNetworkCreate(spec);
            return reason ? deny(403, reason) : { ok: true, body };
        }
        if (route.check === 'imagePull') {
            const reason = checkImagePull(new URL(req.url ?? '/', 'http://proxy.local').searchParams, cfg);
            return reason ? deny(403, reason) : { ok: true };
        }
        return { ok: true };
    } catch (error) {
        return deny(error.status ?? 400, error.message);
    }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} reason
 */
function sendDenied(res, status, reason) {
    res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
    res.end(JSON.stringify({ message: `qaap tenant proxy: ${reason}` }));
}

/**
 * @param {import('node:net').Socket} socket
 * @param {number} status
 * @param {string} reason
 */
function sendDeniedUpgrade(socket, status, reason) {
    const body = JSON.stringify({ message: `qaap tenant proxy: ${reason}` });
    const statusText = status === 400 ? 'Bad Request' : status === 413 ? 'Payload Too Large' : 'Forbidden';
    socket.end(`HTTP/1.1 ${status} ${statusText}\r\nContent-Type: application/json\r\n`
        + `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Buffer | undefined} body
 * @param {ProxyConfig} cfg
 * @param {(line: string) => void} log
 */
function forwardHttp(req, res, body, cfg, log) {
    const headers = { ...req.headers };
    if (body !== undefined) {
        delete headers['transfer-encoding'];
        headers['content-length'] = String(body.length);
    }
    const upstream = http.request({
        socketPath: cfg.upstreamPath,
        method: req.method,
        path: req.url,
        headers
    }, upstreamResponse => {
        res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(res);
    });
    upstream.on('error', error => {
        log(`upstream error for ${req.method} ${apiPathOf(req.url ?? '/')}: ${error.message}`);
        if (res.headersSent) {
            res.destroy();
        } else {
            sendDenied(res, 502, 'docker daemon is unavailable');
        }
    });
    if (body !== undefined) {
        upstream.end(body);
    } else {
        req.pipe(upstream);
    }
}

/**
 * Forwards an upgraded (hijacked) connection as a raw byte stream.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:net').Socket} socket
 * @param {Buffer} head
 * @param {ProxyConfig} cfg
 * @param {(line: string) => void} log
 */
function forwardUpgrade(req, socket, head, cfg, log) {
    const upstream = net.connect({ path: cfg.upstreamPath });
    socket.on('error', () => upstream.destroy());
    upstream.on('error', error => {
        log(`upstream error for upgrade ${apiPathOf(req.url ?? '/')}: ${error.message}`);
        socket.destroy();
    });
    upstream.on('connect', () => {
        let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
        for (let index = 0; index < req.rawHeaders.length; index += 2) {
            raw += `${req.rawHeaders[index]}: ${req.rawHeaders[index + 1]}\r\n`;
        }
        upstream.write(`${raw}\r\n`);
        if (head && head.length > 0) {
            upstream.write(head);
        }
        upstream.pipe(socket);
        socket.pipe(upstream);
    });
}

/**
 * Builds the proxy server. Listening is left to the caller so tests can use temporary sockets.
 * @param {ProxyConfig} cfg
 * @param {{ log?: (line: string) => void }} [options]
 * @returns {import('node:http').Server}
 */
export function createProxy(cfg, options = {}) {
    const log = options.log ?? (line => process.stderr.write(`[docker-tenants-socket-proxy] ${line}\n`));
    const server = http.createServer((req, res) => {
        evaluateRequest(req, cfg, { isUpgrade: false, readRequestBody: () => readBody(req, MAX_BODY_BYTES) })
            .then(verdict => {
                if (!verdict.ok) {
                    log(`DENY ${req.method} ${apiPathOf(req.url ?? '/')} -> ${verdict.reason}`);
                    req.resume();
                    sendDenied(res, verdict.status, verdict.reason);
                    return;
                }
                forwardHttp(req, res, verdict.body, cfg, log);
            })
            .catch(error => {
                log(`proxy error: ${error.message}`);
                sendDenied(res, 500, 'internal proxy error');
            });
    });
    server.on('upgrade', (req, socket, head) => {
        socket.on('error', () => {});
        evaluateRequest(req, cfg, { isUpgrade: true })
            .then(verdict => {
                if (!verdict.ok) {
                    log(`DENY upgrade ${req.method} ${apiPathOf(req.url ?? '/')} -> ${verdict.reason}`);
                    sendDeniedUpgrade(socket, verdict.status, verdict.reason);
                    return;
                }
                forwardUpgrade(req, socket, head, cfg, log);
            })
            .catch(() => sendDeniedUpgrade(socket, 500, 'internal proxy error'));
    });
    server.on('clientError', (error, socket) => {
        log(`client error: ${error.message}`);
        if (socket.writable) {
            socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        }
    });
    return server;
}

function main() {
    const cfg = loadConfig(process.env);
    if (!fs.existsSync(cfg.upstreamPath)) {
        throw new Error(`upstream daemon socket ${cfg.upstreamPath} does not exist`);
    }
    try {
        const stat = fs.lstatSync(cfg.listenPath);
        if (!stat.isSocket()) {
            throw new Error(`${cfg.listenPath} exists and is not a socket`);
        }
        fs.unlinkSync(cfg.listenPath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    // Sockets are created with 0777 & ~umask: 0117 yields 0660 before the chmod below.
    process.umask(0o117);
    const server = createProxy(cfg);
    server.listen(cfg.listenPath, () => {
        fs.chmodSync(cfg.listenPath, cfg.socketMode);
        process.stderr.write(`[docker-tenants-socket-proxy] listening on ${cfg.listenPath} -> ${cfg.upstreamPath}, data root ${cfg.dataRoot}\n`);
    });
    const stop = () => {
        server.close(() => {
            try {
                fs.unlinkSync(cfg.listenPath);
            } catch {
                // already gone
            }
            process.exit(0);
        });
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main();
}

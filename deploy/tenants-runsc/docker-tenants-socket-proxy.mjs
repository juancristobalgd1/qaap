#!/usr/bin/env node
// Allowlist proxy in front of the gVisor tenant dockerd (/run/docker-tenants/docker.sock).
//
// The raw daemon socket is root on the host. This proxy is the barrier between the control plane
// (or anything that compromises it) and that socket, so it is written as a canonical allowlist:
//
// - Request bodies are parsed by a strict JSON parser that rejects duplicate keys and keys that differ
//   only in case (Go's encoding/json matches field names case-insensitively, and the last duplicate
//   wins), then rebuilt into a canonical object that holds only the fields listed below with
//   type-checked values. The daemon only ever receives `JSON.stringify(canonical)`. A listed field
//   with an unexpected value, or an unlisted field with a non-empty value, is refused (403). Unlisted
//   fields whose value is empty (null, "", 0, false, [] or {}) are dropped, which leaves Docker's
//   default, so the docker CLI's zero-valued defaults still work.
// - Every created container gets HostConfig.Runtime=runsc, CapDrop=[ALL], SecurityOpt
//   [no-new-privileges:true], a positive PidsLimit and NetworkMode none unless a Qaap network is named.
// - Host bind sources must be exactly one of the per-tenant directories under the data root
//   (QAAP_TENANT_BIND_TEMPLATES), and fs.realpathSync(source) must equal the source, which rejects a
//   symlink in any component. Mounts (the long syntax) are refused.
// - Container, exec and network operations only reach resources labelled com.qaap.managed=true
//   (checked with an upstream inspect, cached briefly).
// - Hijacked endpoints (attach, exec start) never send client bytes upstream before the daemon
//   answers 101. Any other status is relayed with Connection: close and both sockets are closed.
//   Every other request is sent upstream on its own connection with Connection: close.
// - Every response carries X-Qaap-Tenant-Proxy: 1, so the control plane can tell the proxy from the
//   raw socket.
//
// No npm dependencies: Node >= 22 only. Configuration is by environment variable (see loadConfig).
// Logs contain method, path and the denial reason, never request bodies.

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROXY_HEADER = 'X-Qaap-Tenant-Proxy';
const MAX_CREATE_BODY_BYTES = 4 * 1024 * 1024;
const MAX_SMALL_BODY_BYTES = 64 * 1024;
const MAX_INSPECT_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_HEAD_BYTES = 32 * 1024;
const MAX_JSON_DEPTH = 16;
const ALLOWED_CAPS = new Set(['SETUID', 'SETGID']);
const MANAGED_LABEL = 'com.qaap.managed';
const NAMESPACE_LABEL = 'com.qaap.namespace';
const DEFAULT_LISTEN = '/run/docker-tenants-proxy/proxy.sock';
const DEFAULT_UPSTREAM = '/run/docker-tenants/docker.sock';
const DEFAULT_DATA_ROOT = '/opt/qaap-runtime';
const DEFAULT_REGISTRIES = ['ghcr.io'];
const DEFAULT_PUBLISH_HOST_IPS = ['127.0.0.1'];
const DEFAULT_PIDS_LIMIT = 4096;
const OWNERSHIP_CACHE_MS = 2000;
// Per-tenant host directories the orchestrator and the task-sandbox broker bind-mount, relative to
// the data root. They mirror QAAP_DOCKER_REMOTE_{REPOS,WORKTREES,PARALLEL,TENANT_CONFIG}_ROOT in
// deploy/rootless/compose.override.yml (repos root + users/<segment>, worktrees/<segment>,
// parallel/<segment>, tenant data root and its theia-home).
const DEFAULT_BIND_TEMPLATES = [
    'workspace/repos/users/{tenant}',
    'worktrees/{tenant}',
    'parallel/{tenant}',
    'auth/users/{tenant}',
    'auth/users/{tenant}/theia-home'
];
const NAMESPACE_PATTERN = /^[a-z][a-z0-9]{0,15}$/;
const TENANT_SEGMENT = /^[A-Za-z0-9_.-]{1,128}$/;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const IMAGE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._\-/:@]{0,511}$/;
const USER_SPEC = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,63})?$/;
const ENV_ENTRY = /^[A-Za-z_][A-Za-z0-9_.-]{0,255}=/;
const PORT_KEY = /^\d{1,5}\/(?:tcp|udp)$/;
const TMPFS_OPTION = /^(?:rw|ro|exec|noexec|nosuid|nodev|size=\d{1,12}[kmg]?|mode=[0-7]{3,4}|uid=\d{1,10}|gid=\d{1,10})$/;
const LOG_MAX_SIZE = /^\d{1,6}[kmg]$/;
const LOG_MAX_FILE = /^\d{1,3}$/;
const DETACH_KEYS = /^[A-Za-z0-9,@^\[\]\\_-]{0,64}$/;
const ICC_OPTION = 'com.docker.network.bridge.enable_icc';

/**
 * @typedef {{
 *   listenPath: string,
 *   upstreamPath: string,
 *   socketMode: number,
 *   dataRoot: string,
 *   bindTemplates: string[][],
 *   namespace: string,
 *   allowedRegistries: string[],
 *   publishHostIps: string[],
 *   defaultPidsLimit: number,
 *   ownershipCacheMs: number,
 *   realpath: (source: string) => string,
 *   isDirectory: (source: string) => boolean
 * }} ProxyConfig
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {ProxyConfig}
 */
export function loadConfig(env = process.env) {
    const namespace = (env.QAAP_DOCKER_NAMESPACE ?? '').trim().toLowerCase();
    if (namespace && !NAMESPACE_PATTERN.test(namespace)) {
        throw new Error(`QAAP_DOCKER_NAMESPACE "${namespace}" must be 1-16 lowercase letters or digits, starting with a letter`);
    }
    const dataRoot = path.posix.normalize(env.QAAP_TENANT_DATA_ROOT || DEFAULT_DATA_ROOT).replace(/\/+$/, '');
    if (!dataRoot.startsWith('/') || dataRoot === '') {
        throw new Error('QAAP_TENANT_DATA_ROOT must be an absolute path other than /');
    }
    const templates = env.QAAP_TENANT_BIND_TEMPLATES === undefined ? DEFAULT_BIND_TEMPLATES : splitList(env.QAAP_TENANT_BIND_TEMPLATES);
    const pids = Number(env.QAAP_TENANT_DEFAULT_PIDS_LIMIT ?? DEFAULT_PIDS_LIMIT);
    return {
        listenPath: env.QAAP_TENANT_PROXY_LISTEN || DEFAULT_LISTEN,
        upstreamPath: env.QAAP_TENANT_PROXY_UPSTREAM || DEFAULT_UPSTREAM,
        socketMode: parseInt(env.QAAP_TENANT_PROXY_SOCKET_MODE || '660', 8),
        dataRoot,
        bindTemplates: templates.map(parseBindTemplate),
        namespace,
        allowedRegistries: env.QAAP_TENANT_ALLOWED_REGISTRIES === undefined
            ? [...DEFAULT_REGISTRIES]
            : splitList(env.QAAP_TENANT_ALLOWED_REGISTRIES),
        publishHostIps: env.QAAP_TENANT_PUBLISH_HOST_IPS === undefined
            ? [...DEFAULT_PUBLISH_HOST_IPS]
            : splitList(env.QAAP_TENANT_PUBLISH_HOST_IPS),
        defaultPidsLimit: Number.isSafeInteger(pids) && pids > 0 ? pids : DEFAULT_PIDS_LIMIT,
        ownershipCacheMs: OWNERSHIP_CACHE_MS,
        realpath: source => fs.realpathSync(source),
        isDirectory: source => fs.statSync(source).isDirectory()
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
 * @param {string} template relative path with exactly one `{tenant}` segment
 * @returns {string[]}
 */
function parseBindTemplate(template) {
    const segments = template.split('/');
    const placeholders = segments.filter(segment => segment === '{tenant}').length;
    const valid = !template.startsWith('/') && placeholders === 1
        && segments.every(segment => segment === '{tenant}' || (TENANT_SEGMENT.test(segment) && segment !== '.' && segment !== '..'));
    if (!valid) {
        throw new Error(`invalid bind template ${template}: relative path with exactly one {tenant} segment`);
    }
    return segments;
}

// ─── Errors ───────────────────────────────────────────────────────────────────────────────────

class ProxyDenied extends Error {
    /**
     * @param {number} status
     * @param {string} message
     */
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/** @param {string} message */
const deny = message => new ProxyDenied(403, message);
/** @param {string} message */
const bad = message => new ProxyDenied(400, message);

// ─── Strict JSON ──────────────────────────────────────────────────────────────────────────────

/**
 * Key comparison used by Go's encoding/json: ASCII case folding plus the two non-ASCII letters that
 * fold onto ASCII (U+017F long s -> s, U+212A Kelvin sign -> k).
 * @param {string} key
 * @returns {string}
 */
export function foldKey(key) {
    return key.replace(/ſ/g, 's').replace(/K/g, 'k').toLowerCase();
}

/**
 * Parses JSON and rejects duplicate keys, keys equal under {@link foldKey}, and nesting deeper than
 * MAX_JSON_DEPTH. Objects are created without a prototype so `__proto__` is an ordinary key.
 * @param {string} text
 * @returns {unknown}
 */
export function parseStrictJson(text) {
    let index = 0;
    const fail = reason => {
        throw bad(`request body is not valid JSON (${reason})`);
    };
    const skipWhitespace = () => {
        while (index < text.length && (text[index] === ' ' || text[index] === '\t' || text[index] === '\n' || text[index] === '\r')) {
            index++;
        }
    };
    const parseString = () => {
        const start = index;
        index++;
        while (index < text.length && text[index] !== '"') {
            index += text[index] === '\\' ? 2 : 1;
        }
        if (index >= text.length) {
            fail('unterminated string');
        }
        index++;
        try {
            return JSON.parse(text.slice(start, index));
        } catch {
            return fail('invalid string');
        }
    };
    const parseValue = depth => {
        if (depth > MAX_JSON_DEPTH) {
            fail('nesting too deep');
        }
        skipWhitespace();
        const char = text[index];
        if (char === '{') {
            index++;
            const result = Object.create(null);
            const folded = new Set();
            skipWhitespace();
            if (text[index] === '}') {
                index++;
                return result;
            }
            for (;;) {
                skipWhitespace();
                if (text[index] !== '"') {
                    fail('expected a key');
                }
                const key = parseString();
                const fold = foldKey(key);
                if (folded.has(fold)) {
                    throw bad(`duplicate or case-variant JSON key "${key}"`);
                }
                folded.add(fold);
                skipWhitespace();
                if (text[index] !== ':') {
                    fail('expected a colon');
                }
                index++;
                result[key] = parseValue(depth + 1);
                skipWhitespace();
                if (text[index] === ',') {
                    index++;
                    continue;
                }
                if (text[index] === '}') {
                    index++;
                    return result;
                }
                fail('expected , or }');
            }
        }
        if (char === '[') {
            index++;
            const result = [];
            skipWhitespace();
            if (text[index] === ']') {
                index++;
                return result;
            }
            for (;;) {
                result.push(parseValue(depth + 1));
                skipWhitespace();
                if (text[index] === ',') {
                    index++;
                    continue;
                }
                if (text[index] === ']') {
                    index++;
                    return result;
                }
                fail('expected , or ]');
            }
        }
        if (char === '"') {
            return parseString();
        }
        for (const [literal, value] of [['true', true], ['false', false], ['null', null]]) {
            if (text.startsWith(literal, index)) {
                index += literal.length;
                return value;
            }
        }
        const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
        number.lastIndex = index;
        const match = number.exec(text);
        if (!match) {
            fail('unexpected token');
        }
        index += match[0].length;
        return Number(match[0]);
    };
    const value = parseValue(0);
    skipWhitespace();
    if (index !== text.length) {
        fail('trailing data');
    }
    return value;
}

// ─── Canonicalisation helpers ─────────────────────────────────────────────────────────────────

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Go zero value, recursively: dropping such a field leaves Docker's own default.
 * @param {unknown} value
 * @returns {boolean}
 */
function isEmpty(value) {
    if (value === null || value === '' || value === 0 || value === false) {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every(isEmpty);
    }
    if (isObject(value)) {
        return Object.values(value).every(isEmpty);
    }
    return false;
}

/**
 * @typedef {(value: unknown, where: string) => unknown} Validator returns the canonical value, or
 * undefined to drop the field; throws ProxyDenied otherwise.
 */

/**
 * Builds the canonical object: listed keys go through their validator, unlisted empty keys are
 * dropped, anything else is refused. Null always means "absent".
 * @param {unknown} input
 * @param {Record<string, Validator>} schema
 * @param {string} where
 * @returns {Record<string, unknown>}
 */
function canonicalObject(input, schema, where) {
    if (input === null || input === undefined) {
        return {};
    }
    if (!isObject(input)) {
        throw deny(`${where} must be an object`);
    }
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        const field = `${where}.${key}`;
        if (Object.prototype.hasOwnProperty.call(schema, key)) {
            if (value === null) {
                continue;
            }
            const canonical = schema[key](value, field);
            if (canonical !== undefined) {
                out[key] = canonical;
            }
        } else if (!isEmpty(value)) {
            throw deny(`${field} is not allowed`);
        }
    }
    return out;
}

/** @type {Validator} */
const bool = (value, where) => {
    if (typeof value !== 'boolean') {
        throw deny(`${where} must be a boolean`);
    }
    return value;
};

/**
 * @param {number} min
 * @param {number} max
 * @returns {Validator}
 */
const int = (min, max) => (value, where) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw deny(`${where} must be an integer in [${min}, ${max}]`);
    }
    return value;
};

/**
 * @param {RegExp} pattern
 * @returns {Validator}
 */
const str = pattern => (value, where) => {
    if (typeof value !== 'string' || !pattern.test(value)) {
        throw deny(`${where} has an unexpected value`);
    }
    return value;
};

/**
 * @param {(entry: string) => boolean} accept
 * @param {number} maxEntries
 * @returns {Validator}
 */
const strArray = (accept, maxEntries) => (value, where) => {
    if (!Array.isArray(value) || value.length > maxEntries || !value.every(entry => typeof entry === 'string' && accept(entry))) {
        throw deny(`${where} must be an array of allowed strings`);
    }
    return [...value];
};

/**
 * @param {string} value
 * @returns {boolean}
 */
function isCleanAbsolutePath(value) {
    return value.startsWith('/') && value.length <= 4096 && !value.includes('\0') && !value.includes(':')
        && (value === '/' || (path.posix.normalize(value) === value && !value.endsWith('/')));
}

/** @type {Validator} */
const absolutePath = (value, where) => {
    if (typeof value !== 'string' || !isCleanAbsolutePath(value)) {
        throw deny(`${where} must be a normalised absolute path`);
    }
    return value;
};

/**
 * @param {ProxyConfig} cfg
 * @returns {RegExp} names this control plane gives to containers, networks and volumes
 */
function qaapNamePattern(cfg) {
    return cfg.namespace
        ? new RegExp(`^${cfg.namespace}-qaap-[a-z0-9][a-z0-9.-]{0,120}$`)
        : /^(?:[a-z][a-z0-9]{0,15}-)?qaap-[a-z0-9][a-z0-9.-]{0,120}$/;
}

/**
 * @param {ProxyConfig} cfg
 * @returns {RegExp} the task-sandbox broker's toolchain volume (qaap-agent-toolchain-<12 hex>)
 */
function toolchainVolumePattern(cfg) {
    return cfg.namespace
        ? new RegExp(`^${cfg.namespace}-qaap-agent-toolchain-[0-9a-f]{12}$`)
        : /^(?:[a-z][a-z0-9]{0,15}-)?qaap-agent-toolchain-[0-9a-f]{12}$/;
}

/**
 * Labels: only com.qaap.* keys with string values. Callers then require com.qaap.managed=true (plus
 * the namespace label when QAAP_DOCKER_NAMESPACE is set) with hasQaapLabels.
 * @returns {Validator}
 */
const labels = () => (value, where) => {
    if (!isObject(value)) {
        throw deny(`${where} must be an object`);
    }
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!/^com\.qaap\.[a-z0-9.-]{1,128}$/.test(key) || typeof entry !== 'string' || entry.length > 4096) {
            throw deny(`${where}.${key} is not an allowed label`);
        }
        out[key] = entry;
    }
    return out;
};

/**
 * @param {Record<string, unknown> | undefined} labelSet
 * @param {ProxyConfig} cfg
 * @returns {boolean}
 */
function hasQaapLabels(labelSet, cfg) {
    if (!isObject(labelSet) || labelSet[MANAGED_LABEL] !== 'true') {
        return false;
    }
    return !cfg.namespace || labelSet[NAMESPACE_LABEL] === cfg.namespace;
}

// ─── Binds ────────────────────────────────────────────────────────────────────────────────────

/**
 * Matches a host path against the per-tenant templates. Returns the tenant segment, or undefined.
 * @param {string} source
 * @param {ProxyConfig} cfg
 * @returns {string | undefined}
 */
function tenantOfBindSource(source, cfg) {
    if (!source.startsWith(`${cfg.dataRoot}/`)) {
        return undefined;
    }
    const segments = source.slice(cfg.dataRoot.length + 1).split('/');
    for (const template of cfg.bindTemplates) {
        if (template.length !== segments.length) {
            continue;
        }
        let tenant;
        const matches = template.every((part, position) => {
            const segment = segments[position];
            if (part === '{tenant}') {
                tenant = segment;
                return TENANT_SEGMENT.test(segment) && segment !== '.' && segment !== '..';
            }
            return part === segment;
        });
        if (matches) {
            return tenant;
        }
    }
    return undefined;
}

/**
 * @param {ProxyConfig} cfg
 * @returns {Validator}
 */
const binds = cfg => (value, where) => {
    if (!Array.isArray(value) || value.length > 16) {
        throw deny(`${where} must be an array of at most 16 binds`);
    }
    const tenants = new Set();
    const result = value.map(entry => {
        if (typeof entry !== 'string') {
            throw deny(`${where} entries must be strings`);
        }
        const parts = entry.split(':');
        if (parts.length < 2 || parts.length > 3) {
            throw deny(`bind ${entry} must be source:destination[:rw|ro]`);
        }
        const [source, destination, mode] = parts;
        if (!isCleanAbsolutePath(destination) || destination === '/') {
            throw deny(`bind destination ${destination} must be a normalised absolute path`);
        }
        if (mode !== undefined && mode !== 'rw' && mode !== 'ro') {
            throw deny(`bind option ${mode} is not allowed (only rw or ro)`);
        }
        if (!source.startsWith('/')) {
            if (!toolchainVolumePattern(cfg).test(source)) {
                throw deny(`volume ${source} is not allowed`);
            }
            return entry;
        }
        if (!isCleanAbsolutePath(source)) {
            throw deny(`bind source ${source} is not a normalised absolute path`);
        }
        const tenant = tenantOfBindSource(source, cfg);
        if (tenant === undefined) {
            throw deny(`bind source ${source} is not a per-tenant directory under ${cfg.dataRoot}`);
        }
        let real;
        try {
            real = cfg.realpath(source);
            if (!cfg.isDirectory(source)) {
                throw new Error('not a directory');
            }
        } catch (error) {
            throw deny(`bind source ${source} is not an existing directory (${error.code ?? error.message})`);
        }
        if (real !== source) {
            throw deny(`bind source ${source} resolves through a symlink`);
        }
        tenants.add(tenant.toLowerCase());
        return entry;
    });
    if (tenants.size > 1) {
        throw deny('binds mix directories of different tenants');
    }
    return result;
};

// ─── Schemas ──────────────────────────────────────────────────────────────────────────────────

/** @type {Validator} */
const consoleSize = (value, where) => {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(size => Number.isSafeInteger(size) && size >= 0 && size <= 10000)) {
        throw deny(`${where} must be [height, width]`);
    }
    return [...value];
};

/** @type {Validator} */
const tmpfs = (value, where) => {
    if (!isObject(value) || Object.keys(value).length > 8) {
        throw deny(`${where} must be an object with at most 8 entries`);
    }
    const out = {};
    for (const [target, options] of Object.entries(value)) {
        if (!isCleanAbsolutePath(target) || target === '/' || typeof options !== 'string'
            || !(options === '' || options.split(',').every(option => TMPFS_OPTION.test(option)))) {
            throw deny(`${where}.${target} is not an allowed tmpfs`);
        }
        out[target] = options;
    }
    return out;
};

/** @type {Validator} */
const logConfig = (value, where) => {
    const out = canonicalObject(value, {
        Type: str(/^(?:json-file|)$/),
        Config: (config, field) => canonicalObject(config, {
            'max-size': str(LOG_MAX_SIZE),
            'max-file': str(LOG_MAX_FILE),
            compress: str(/^(?:true|false)$/)
        }, field)
    }, where);
    return Object.keys(out).length ? out : undefined;
};

/** @type {Validator} */
const restartPolicy = (value, where) => canonicalObject(value, {
    Name: str(/^(?:|no|on-failure)$/),
    MaximumRetryCount: int(0, 10)
}, where);

/** @type {Validator} */
const exposedPorts = (value, where) => {
    if (!isObject(value)) {
        throw deny(`${where} must be an object`);
    }
    const out = {};
    for (const [port, entry] of Object.entries(value)) {
        if (!PORT_KEY.test(port) || !isObject(entry) || Object.keys(entry).length > 0) {
            throw deny(`${where}.${port} is not allowed`);
        }
        out[port] = {};
    }
    return out;
};

/**
 * Only the tenant ingress relay publishes a port: on a QAAP_TENANT_PUBLISH_HOST_IPS address (default
 * 127.0.0.1, the orchestrator's publishHostIp), with an ephemeral or unprivileged host port.
 * @param {ProxyConfig} cfg
 * @returns {Validator}
 */
const portBindings = cfg => (value, where) => {
    if (!isObject(value)) {
        throw deny(`${where} must be an object`);
    }
    const out = {};
    for (const [port, bindings] of Object.entries(value)) {
        if (!PORT_KEY.test(port) || !Array.isArray(bindings) || bindings.length > 2) {
            throw deny(`${where}.${port} is not allowed`);
        }
        out[port] = bindings.map(binding => {
            const canonical = canonicalObject(binding, {
                HostIp: (ip, field) => {
                    if (typeof ip !== 'string' || !cfg.publishHostIps.includes(ip)) {
                        throw deny(`${field} ${String(ip)} is not in QAAP_TENANT_PUBLISH_HOST_IPS`);
                    }
                    return ip;
                },
                HostPort: (hostPort, field) => {
                    if (hostPort === '' || (typeof hostPort === 'string' && /^\d{4,5}$/.test(hostPort) && Number(hostPort) >= 1024 && Number(hostPort) <= 65535)) {
                        return hostPort;
                    }
                    throw deny(`${field} must be empty or an unprivileged port`);
                }
            }, `${where}.${port}`);
            if (canonical.HostIp === undefined) {
                throw deny(`${where}.${port} must name a HostIp (an empty HostIp publishes on every interface)`);
            }
            return { HostIp: canonical.HostIp, HostPort: canonical.HostPort ?? '' };
        });
    }
    return out;
};

/**
 * @param {ProxyConfig} cfg
 * @returns {Validator}
 */
const networkMode = cfg => (value, where) => {
    if (value === 'none' || (typeof value === 'string' && qaapNamePattern(cfg).test(value))) {
        return value;
    }
    throw deny(`${where} ${String(value)} is not none or a Qaap network`);
};

/**
 * @param {ProxyConfig} cfg
 * @returns {Record<string, Validator>}
 */
function hostConfigSchema(cfg) {
    return {
        Init: bool,
        Binds: binds(cfg),
        Memory: int(0, 2 ** 46),
        NanoCpus: int(0, 256e9),
        PidsLimit: int(1, 1_000_000),
        SecurityOpt: (value, where) => {
            if (!Array.isArray(value) || value.length !== 1 || value[0] !== 'no-new-privileges:true') {
                throw deny(`${where} must be exactly ["no-new-privileges:true"]`);
            }
            return undefined;
        },
        CapDrop: (value, where) => {
            if (!Array.isArray(value) || value.length !== 1 || value[0] !== 'ALL') {
                throw deny(`${where} must be exactly ["ALL"]`);
            }
            return undefined;
        },
        CapAdd: (value, where) => {
            if (!Array.isArray(value) || value.length > ALLOWED_CAPS.size || new Set(value).size !== value.length
                || !value.every(cap => typeof cap === 'string' && ALLOWED_CAPS.has(cap))) {
                throw deny(`${where} may only contain SETUID and SETGID`);
            }
            return [...value];
        },
        ReadonlyRootfs: bool,
        Tmpfs: tmpfs,
        NetworkMode: networkMode(cfg),
        RestartPolicy: restartPolicy,
        AutoRemove: bool,
        LogConfig: logConfig,
        PortBindings: portBindings(cfg),
        PublishAllPorts: (value, where) => {
            if (value !== false) {
                throw deny(`${where} is not allowed`);
            }
            return undefined;
        },
        ConsoleSize: consoleSize,
        Runtime: (value, where) => {
            if (value !== 'runsc') {
                throw deny(`${where} ${String(value)} is not allowed (only runsc)`);
            }
            return undefined;
        }
    };
}

/** @type {Validator} */
const healthcheck = (value, where) => canonicalObject(value, {
    Test: strArray(() => true, 64),
    Interval: int(0, 2 ** 53 - 1),
    Timeout: int(0, 2 ** 53 - 1),
    StartPeriod: int(0, 2 ** 53 - 1),
    StartInterval: int(0, 2 ** 53 - 1),
    Retries: int(0, 1000)
}, where);

/**
 * Canonical body for POST /containers/create.
 * @param {unknown} spec parsed body
 * @param {ProxyConfig} cfg
 * @returns {Record<string, unknown>}
 */
export function canonicalContainerCreate(spec, cfg) {
    if (!isObject(spec)) {
        throw bad('request body must be a JSON object');
    }
    const canonical = canonicalObject(spec, {
        Image: str(IMAGE_REFERENCE),
        User: str(USER_SPEC),
        Cmd: strArray(() => true, 4096),
        Entrypoint: strArray(() => true, 64),
        Env: strArray(entry => ENV_ENTRY.test(entry), 1024),
        WorkingDir: absolutePath,
        Labels: labels(),
        ExposedPorts: exposedPorts,
        Tty: bool,
        OpenStdin: bool,
        StdinOnce: bool,
        AttachStdin: bool,
        AttachStdout: bool,
        AttachStderr: bool,
        Healthcheck: healthcheck,
        HostConfig: (value, where) => canonicalObject(value, hostConfigSchema(cfg), where),
        NetworkingConfig: (value, where) => canonicalObject(value, {
            EndpointsConfig: (endpoints, field) => {
                if (!isObject(endpoints)) {
                    throw deny(`${field} must be an object`);
                }
                const out = {};
                for (const [network, endpoint] of Object.entries(endpoints)) {
                    networkMode(cfg)(network, `${field} network`);
                    out[network] = canonicalObject(endpoint, { Aliases: strArray(alias => RESOURCE_ID.test(alias), 8) }, `${field}.${network}`);
                }
                return out;
            }
        }, where)
    }, 'body');
    if (typeof canonical.Image !== 'string') {
        throw deny('body.Image is required');
    }
    if (!hasQaapLabels(canonical.Labels, cfg)) {
        throw deny(`container is missing the ${MANAGED_LABEL}=true label${cfg.namespace ? ` and ${NAMESPACE_LABEL}=${cfg.namespace}` : ''}`);
    }
    const host = /** @type {Record<string, unknown>} */ (canonical.HostConfig ?? {});
    const mode = host.NetworkMode ?? 'none';
    const endpoints = /** @type {Record<string, unknown>} */ (/** @type {any} */ (canonical.NetworkingConfig)?.EndpointsConfig ?? {});
    if (Object.keys(endpoints).some(network => network !== mode)) {
        throw deny('NetworkingConfig may only describe the NetworkMode network');
    }
    canonical.HostConfig = {
        ...host,
        NetworkMode: mode,
        PidsLimit: host.PidsLimit ?? cfg.defaultPidsLimit,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        Runtime: 'runsc'
    };
    return canonical;
}

/**
 * Canonical body for POST /containers/{id}/exec. User 0:0 stays allowed: hosted tenant containers run
 * as uid 0 (resolveQaapHostedTenantContainerUser) and the orchestrator execs shells with that user;
 * under runsc it is root inside the gVisor sandbox. Privileged exec is refused.
 * @param {unknown} spec
 * @returns {Record<string, unknown>}
 */
export function canonicalExecCreate(spec) {
    if (!isObject(spec)) {
        throw bad('request body must be a JSON object');
    }
    const canonical = canonicalObject(spec, {
        Cmd: strArray(() => true, 4096),
        Env: strArray(entry => ENV_ENTRY.test(entry), 1024),
        User: str(USER_SPEC),
        WorkingDir: absolutePath,
        Tty: bool,
        AttachStdin: bool,
        AttachStdout: bool,
        AttachStderr: bool,
        Detach: bool,
        DetachKeys: str(DETACH_KEYS),
        ConsoleSize: consoleSize,
        Privileged: (value, where) => {
            if (value !== false) {
                throw deny('privileged exec is not allowed');
            }
            return undefined;
        }
    }, 'body');
    if (!Array.isArray(canonical.Cmd) || canonical.Cmd.length === 0) {
        throw deny('body.Cmd is required');
    }
    return canonical;
}

/**
 * Canonical body for POST /exec/{id}/start.
 * @param {unknown} spec
 * @returns {Record<string, unknown>}
 */
export function canonicalExecStart(spec) {
    if (spec === null) {
        return {};
    }
    return canonicalObject(spec, {
        Detach: bool,
        Tty: bool,
        ConsoleSize: consoleSize
    }, 'body');
}

/**
 * Canonical body for POST /networks/create: Qaap-named bridge networks only. enable_icc may be
 * false, or true on an internal network (the orchestrator's per-tenant internal bridge).
 * @param {unknown} spec
 * @param {ProxyConfig} cfg
 * @returns {Record<string, unknown>}
 */
export function canonicalNetworkCreate(spec, cfg) {
    if (!isObject(spec)) {
        throw bad('request body must be a JSON object');
    }
    const canonical = canonicalObject(spec, {
        Name: str(qaapNamePattern(cfg)),
        Driver: str(/^bridge$/),
        Internal: bool,
        CheckDuplicate: bool,
        Labels: labels(),
        Options: (value, where) => canonicalObject(value, { [ICC_OPTION]: str(/^(?:true|false)$/) }, where),
        // Only the docker CLI's default IPAM block (Driver "default", no Config) is accepted, then dropped.
        IPAM: (value, where) => {
            canonicalObject(value, { Driver: str(/^default$/) }, where);
            return undefined;
        }
    }, 'body');
    if (typeof canonical.Name !== 'string') {
        throw deny('body.Name must be a Qaap network name');
    }
    if (!hasQaapLabels(canonical.Labels, cfg)) {
        throw deny(`network is missing the ${MANAGED_LABEL}=true label`);
    }
    const options = /** @type {Record<string, string>} */ (canonical.Options ?? {});
    if (options[ICC_OPTION] === 'true' && canonical.Internal !== true) {
        throw deny('enable_icc=true is only allowed on an internal network');
    }
    canonical.Driver = 'bridge';
    return canonical;
}

/**
 * @param {unknown} spec
 * @param {ProxyConfig} cfg
 * @returns {Record<string, unknown>}
 */
export function canonicalVolumeCreate(spec, cfg) {
    if (!isObject(spec)) {
        throw bad('request body must be a JSON object');
    }
    const canonical = canonicalObject(spec, {
        Name: str(toolchainVolumePattern(cfg)),
        Driver: str(/^local$/),
        Labels: labels()
    }, 'body');
    if (typeof canonical.Name !== 'string') {
        throw deny('body.Name must be the task-sandbox toolchain volume');
    }
    if (!hasQaapLabels(canonical.Labels, cfg)) {
        throw deny(`volume is missing the ${MANAGED_LABEL}=true label`);
    }
    canonical.Driver = 'local';
    return canonical;
}

/**
 * @param {unknown} spec
 * @param {boolean} connect
 * @returns {Record<string, unknown>}
 */
function canonicalNetworkMembership(spec, connect) {
    if (!isObject(spec)) {
        throw bad('request body must be a JSON object');
    }
    const canonical = canonicalObject(spec, connect
        ? { Container: str(RESOURCE_ID), EndpointConfig: (value, where) => canonicalObject(value, { Aliases: strArray(alias => RESOURCE_ID.test(alias), 8) }, where) }
        : { Container: str(RESOURCE_ID), Force: bool }, 'body');
    if (typeof canonical.Container !== 'string') {
        throw deny('body.Container is required');
    }
    return canonical;
}

// ─── Images ───────────────────────────────────────────────────────────────────────────────────

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
 */
function checkImagePull(query, cfg) {
    const image = query.get('fromImage') ?? '';
    if (!IMAGE_REFERENCE.test(image)) {
        throw deny('fromImage is required');
    }
    const registry = registryOf(image);
    if (!cfg.allowedRegistries.includes(registry)) {
        throw deny(`registry ${registry} is not in QAAP_TENANT_ALLOWED_REGISTRIES`);
    }
    const tag = query.get('tag') ?? '';
    if (tag !== '' && !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/.test(tag)) {
        throw deny('tag has an unexpected value');
    }
}

// ─── Routing ──────────────────────────────────────────────────────────────────────────────────

/**
 * Route allowlist. `owner` names the ownership check run against the upstream before forwarding,
 * `body` the canonical body builder, `query` the allowed query parameters (undefined: any, the
 * values only reach read or lifecycle endpoints), `upgrade` the hijackable endpoints.
 * @typedef {{
 *   method: string,
 *   pattern: RegExp,
 *   owner?: 'container' | 'exec' | 'network',
 *   body?: 'create' | 'execCreate' | 'execStart' | 'networkCreate' | 'connect' | 'disconnect' | 'volumeCreate',
 *   query?: string[],
 *   upgrade?: boolean,
 *   filter?: 'containerInspect',
 *   check?: 'imagePull' | 'rename' | 'volumeName'
 * }} Route
 */
/** @type {ReadonlyArray<Route>} */
const ROUTES = [
    { method: 'GET', pattern: /^\/_ping$/ },
    { method: 'HEAD', pattern: /^\/_ping$/ },
    { method: 'GET', pattern: /^\/version$/ },
    { method: 'GET', pattern: /^\/info$/ },
    // Read-only listing: the control plane's discovery reads container labels from it.
    { method: 'GET', pattern: /^\/containers\/json$/ },
    { method: 'POST', pattern: /^\/containers\/create$/, body: 'create', query: ['name', 'platform'] },
    { method: 'POST', pattern: /^\/containers\/[^/]+\/(?:start|stop|kill|wait|pause|unpause)$/, owner: 'container' },
    { method: 'POST', pattern: /^\/containers\/[^/]+\/rename$/, owner: 'container', check: 'rename', query: ['name'] },
    { method: 'GET', pattern: /^\/containers\/[^/]+\/json$/, owner: 'container', filter: 'containerInspect' },
    { method: 'GET', pattern: /^\/containers\/[^/]+\/logs$/, owner: 'container' },
    { method: 'DELETE', pattern: /^\/containers\/[^/]+$/, owner: 'container', query: ['force', 'v'] },
    { method: 'POST', pattern: /^\/containers\/[^/]+\/attach$/, owner: 'container', upgrade: true,
        query: ['stream', 'stdin', 'stdout', 'stderr', 'logs', 'detachKeys'] },
    { method: 'POST', pattern: /^\/containers\/[^/]+\/exec$/, owner: 'container', body: 'execCreate' },
    { method: 'GET', pattern: /^\/exec\/[^/]+\/json$/, owner: 'exec' },
    { method: 'POST', pattern: /^\/exec\/[^/]+\/resize$/, owner: 'exec', query: ['h', 'w'] },
    { method: 'POST', pattern: /^\/exec\/[^/]+\/start$/, owner: 'exec', body: 'execStart', upgrade: true },
    { method: 'POST', pattern: /^\/networks\/create$/, body: 'networkCreate' },
    { method: 'POST', pattern: /^\/networks\/[^/]+\/connect$/, owner: 'network', body: 'connect' },
    { method: 'POST', pattern: /^\/networks\/[^/]+\/disconnect$/, owner: 'network', body: 'disconnect' },
    { method: 'GET', pattern: /^\/networks$/ },
    { method: 'GET', pattern: /^\/networks\/[^/]+$/ },
    { method: 'DELETE', pattern: /^\/networks\/[^/]+$/, owner: 'network' },
    { method: 'GET', pattern: /^\/images\/.+\/json$/ },
    { method: 'POST', pattern: /^\/images\/create$/, check: 'imagePull', query: ['fromImage', 'tag', 'platform'] },
    { method: 'POST', pattern: /^\/volumes\/create$/, body: 'volumeCreate' },
    { method: 'GET', pattern: /^\/volumes\/[^/]+$/, check: 'volumeName' }
];

/**
 * Splits and normalises the request target. Rejects anything the daemon's router could read
 * differently from this proxy: percent-encoding, dot or empty segments, semicolons and duplicate
 * query parameters (Go and URLSearchParams disagree on both).
 * @param {string} url
 * @returns {{ apiPath: string, query: URLSearchParams, rawPath: string }}
 */
export function parseTarget(url) {
    const queryIndex = url.indexOf('?');
    const rawPath = queryIndex === -1 ? url : url.slice(0, queryIndex);
    const rawQuery = queryIndex === -1 ? '' : url.slice(queryIndex + 1);
    if (!/^\/[A-Za-z0-9_.\-/:@]*$/.test(rawPath) || rawPath.length > 2048) {
        throw bad('request path contains disallowed characters');
    }
    if (rawPath.includes('//') || rawPath.split('/').some(segment => segment === '.' || segment === '..')) {
        throw bad('ambiguous request path');
    }
    if (rawQuery.includes(';') || rawQuery.includes('#') || rawQuery.length > 8192) {
        throw bad('ambiguous query string');
    }
    const query = new URLSearchParams(rawQuery);
    const keys = [...query.keys()];
    if (new Set(keys).size !== keys.length) {
        throw bad('duplicate query parameter');
    }
    const unversioned = rawPath.replace(/^\/v\d+\.\d+(?=\/)/, '');
    return { apiPath: unversioned.replace(/\/$/, '') || '/', query, rawPath };
}

/**
 * @param {string} apiPath
 * @returns {string} the resource id in the third segment (`/containers/<id>/...`)
 */
function resourceIdOf(apiPath) {
    const id = apiPath.split('/')[2] ?? '';
    if (!RESOURCE_ID.test(id)) {
        throw bad('invalid resource id');
    }
    return id;
}

// ─── Upstream access ──────────────────────────────────────────────────────────────────────────

/**
 * One request to the daemon on a fresh connection, response buffered.
 * @param {ProxyConfig} cfg
 * @param {string} method
 * @param {string} target
 * @param {number} [limit]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: Buffer }>}
 */
function upstreamFetch(cfg, method, target, limit = MAX_INSPECT_BYTES) {
    return new Promise((resolve, reject) => {
        const request = http.request({
            socketPath: cfg.upstreamPath,
            method,
            path: target,
            agent: false,
            headers: { Host: 'docker', Connection: 'close' }
        }, response => {
            const chunks = [];
            let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                if (size > limit) {
                    request.destroy(new Error('upstream response too large'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => resolve({ status: response.statusCode ?? 502, headers: response.headers, body: Buffer.concat(chunks) }));
            response.on('error', reject);
        });
        request.on('error', reject);
        request.end();
    });
}

/**
 * Ownership checks: the target must exist and carry the Qaap labels. A missing target is relayed as
 * the daemon's 404, so callers that probe for a container still see "not found".
 */
class OwnershipChecker {
    /** @param {ProxyConfig} cfg */
    constructor(cfg) {
        this.cfg = cfg;
        /** @type {Map<string, { at: number, verdict: { status: number, body?: Buffer } }>} */
        this.cache = new Map();
    }

    /**
     * @param {'container' | 'exec' | 'network'} kind
     * @param {string} id
     * @returns {Promise<{ status: number, body?: Buffer }>} status 200 when owned
     */
    async check(kind, id) {
        const key = `${kind}:${id}`;
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.at < this.cfg.ownershipCacheMs) {
            return cached.verdict;
        }
        const verdict = await this.lookup(kind, id);
        if (this.cache.size > 4096) {
            this.cache.clear();
        }
        this.cache.set(key, { at: Date.now(), verdict });
        return verdict;
    }

    /** @param {string} id */
    forget(id) {
        for (const key of [...this.cache.keys()]) {
            if (key.endsWith(`:${id}`)) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * @param {'container' | 'exec' | 'network'} kind
     * @param {string} id
     * @returns {Promise<{ status: number, body?: Buffer }>}
     */
    async lookup(kind, id) {
        if (kind === 'exec') {
            const exec = await upstreamFetch(this.cfg, 'GET', `/exec/${id}/json`);
            if (exec.status !== 200) {
                return { status: exec.status, body: exec.body };
            }
            const containerId = String(JSON.parse(exec.body.toString('utf8')).ContainerID ?? '');
            if (!RESOURCE_ID.test(containerId)) {
                return { status: 403 };
            }
            return this.check('container', containerId);
        }
        const target = kind === 'container' ? `/containers/${id}/json` : `/networks/${id}`;
        const inspect = await upstreamFetch(this.cfg, 'GET', target);
        if (inspect.status !== 200) {
            return { status: inspect.status, body: inspect.body };
        }
        const parsed = JSON.parse(inspect.body.toString('utf8'));
        const labelSet = kind === 'container' ? parsed?.Config?.Labels : parsed?.Labels;
        return hasQaapLabels(labelSet, this.cfg) ? { status: 200 } : { status: 403 };
    }
}

// ─── Request evaluation ───────────────────────────────────────────────────────────────────────

/**
 * Decides whether a request may be forwarded and builds what is sent upstream.
 * @param {{ method?: string, url?: string }} req
 * @param {ProxyConfig} cfg
 * @param {{ isUpgrade: boolean, readRequestBody: (limit: number) => Promise<Buffer>, ownership: OwnershipChecker }} options
 * @returns {Promise<{ ok: true, route: Route, body?: Buffer } | { ok: false, status: number, reason: string, body?: Buffer }>}
 */
export async function evaluateRequest(req, cfg, options) {
    try {
        const { apiPath, query } = parseTarget(req.url ?? '/');
        const route = ROUTES.find(candidate => candidate.method === req.method && candidate.pattern.test(apiPath));
        if (!route) {
            throw deny(`${req.method} ${apiPath} is not allowed`);
        }
        if (options.isUpgrade && !route.upgrade) {
            throw deny(`connection upgrade on ${apiPath} is not allowed`);
        }
        if (route.query) {
            for (const key of query.keys()) {
                if (!route.query.includes(key)) {
                    throw deny(`query parameter ${key} is not allowed on ${apiPath}`);
                }
            }
        }
        if (route.check === 'imagePull') {
            checkImagePull(query, cfg);
        }
        if (route.check === 'volumeName' && !toolchainVolumePattern(cfg).test(apiPath.split('/')[2] ?? '')) {
            throw deny('only the task-sandbox toolchain volume may be inspected');
        }
        if (route.check === 'rename' || route.body === 'create') {
            const name = query.get('name');
            if (name !== null && !qaapNamePattern(cfg).test(name.replace(/^\//, ''))) {
                throw deny(`container name ${name} is not a Qaap name`);
            }
            if (route.check === 'rename' && name === null) {
                throw deny('rename needs a name');
            }
        }
        // The body is read before any upstream lookup so an oversize or malformed body fails fast.
        const raw = await options.readRequestBody(route.body === 'create' ? MAX_CREATE_BODY_BYTES : MAX_SMALL_BODY_BYTES);
        let canonical;
        if (route.body) {
            const text = raw.toString('utf8').trim();
            const spec = text === '' ? null : parseStrictJson(text);
            if (route.body === 'create') {
                canonical = canonicalContainerCreate(spec, cfg);
            } else if (route.body === 'execCreate') {
                canonical = canonicalExecCreate(spec);
            } else if (route.body === 'execStart') {
                canonical = canonicalExecStart(spec);
            } else if (route.body === 'networkCreate') {
                canonical = canonicalNetworkCreate(spec, cfg);
            } else if (route.body === 'volumeCreate') {
                canonical = canonicalVolumeCreate(spec, cfg);
            } else {
                canonical = canonicalNetworkMembership(spec, route.body === 'connect');
            }
        }
        if (route.owner) {
            const verdict = await options.ownership.check(route.owner, resourceIdOf(apiPath));
            if (verdict.status !== 200) {
                return verdict.status === 403
                    ? { ok: false, status: 403, reason: `${route.owner} ${resourceIdOf(apiPath)} is not managed by Qaap` }
                    : { ok: false, status: verdict.status, reason: `${route.owner} lookup returned ${verdict.status}`, body: verdict.body };
            }
        }
        if (route.body === 'connect' || route.body === 'disconnect') {
            const container = await options.ownership.check('container', String(canonical.Container));
            if (container.status !== 200) {
                throw deny(`container ${String(canonical.Container)} is not managed by Qaap`);
            }
        }
        if (req.method === 'DELETE' && route.owner) {
            options.ownership.forget(resourceIdOf(apiPath));
        }
        return { ok: true, route, body: canonical === undefined ? undefined : Buffer.from(JSON.stringify(canonical), 'utf8') };
    } catch (error) {
        if (error instanceof ProxyDenied) {
            return { ok: false, status: error.status, reason: error.message };
        }
        if (error instanceof SyntaxError) {
            return { ok: false, status: 502, reason: 'unexpected upstream answer' };
        }
        throw error;
    }
}

// ─── HTTP plumbing ────────────────────────────────────────────────────────────────────────────

/**
 * Reads a request body up to `limit`. An oversize body is drained (capped at 16x the limit) so the
 * client still receives the 413 instead of a connection reset.
 * @param {import('node:stream').Readable} stream
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
function readBody(stream, limit) {
    const drainCap = limit * 16;
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        stream.on('data', chunk => {
            size += chunk.length;
            if (size > drainCap) {
                stream.destroy();
                return;
            }
            if (size <= limit) {
                chunks.push(chunk);
            }
        });
        stream.on('end', () => size > limit
            ? reject(new ProxyDenied(413, `request body exceeds ${limit} bytes`))
            : resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
        stream.on('close', () => reject(new ProxyDenied(400, 'request aborted')));
    });
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string} reason
 * @param {Buffer} [body] upstream body to relay instead of the proxy's message (404 from a lookup)
 */
function sendDenied(res, status, reason, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close', [PROXY_HEADER]: '1' });
    res.end(body ?? JSON.stringify({ message: `qaap tenant proxy: ${reason}` }));
}

/**
 * @param {number} status
 * @returns {string}
 */
function statusText(status) {
    return http.STATUS_CODES[status] ?? 'Error';
}

/**
 * @param {net.Socket} socket
 * @param {number} status
 * @param {string} reason
 * @param {Buffer} [upstreamBody]
 */
function sendDeniedRaw(socket, status, reason, upstreamBody) {
    const body = upstreamBody ?? Buffer.from(JSON.stringify({ message: `qaap tenant proxy: ${reason}` }));
    socket.end(`HTTP/1.1 ${status} ${statusText(status)}\r\nContent-Type: application/json\r\n${PROXY_HEADER}: 1\r\n`
        + `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body.toString('utf8')}`);
}

/** Request headers relayed to the daemon; everything else (hop-by-hop, Expect, Upgrade...) is dropped. */
const FORWARDED_REQUEST_HEADERS = ['host', 'user-agent', 'accept', 'content-type', 'x-registry-auth'];
/** Response headers never relayed from the daemon. */
const DROPPED_RESPONSE_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'upgrade', 'proxy-connection']);

/**
 * @param {http.IncomingHttpHeaders} incoming
 * @returns {Record<string, string>}
 */
function forwardedHeaders(incoming) {
    const headers = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
        const value = incoming[name];
        if (typeof value === 'string') {
            headers[name] = value;
        }
    }
    return headers;
}

/**
 * Removes host paths of the daemon's data root from a container inspect. Config.Env and HostConfig
 * stay: the orchestrator's reuse matchers compare them (backend secret, egress env, build SHA, every
 * hardening field), so stripping them would make it recreate every container.
 * @param {Buffer} body
 * @returns {Buffer}
 */
export function filterContainerInspect(body) {
    const parsed = JSON.parse(body.toString('utf8'));
    for (const field of ['GraphDriver', 'ResolvConfPath', 'HostnamePath', 'HostsPath', 'LogPath']) {
        delete parsed[field];
    }
    return Buffer.from(JSON.stringify(parsed), 'utf8');
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {{ route: Route, body?: Buffer }} verdict
 * @param {ProxyConfig} cfg
 * @param {(line: string) => void} log
 */
function forwardHttp(req, res, verdict, cfg, log) {
    const body = verdict.body ?? Buffer.alloc(0);
    const headers = { ...forwardedHeaders(req.headers), connection: 'close', 'content-length': String(body.length) };
    if (verdict.body !== undefined) {
        headers['content-type'] = 'application/json';
    }
    const upstream = http.request({ socketPath: cfg.upstreamPath, method: req.method, path: req.url, headers, agent: false }, response => {
        const responseHeaders = { [PROXY_HEADER]: '1', Connection: 'close' };
        for (const [name, value] of Object.entries(response.headers)) {
            if (!DROPPED_RESPONSE_HEADERS.has(name) && value !== undefined) {
                responseHeaders[name] = value;
            }
        }
        if (verdict.route.filter === 'containerInspect' && response.statusCode === 200) {
            readBody(response, MAX_INSPECT_BYTES).then(raw => {
                const filtered = filterContainerInspect(raw);
                res.writeHead(200, { ...responseHeaders, 'Content-Length': String(filtered.length) });
                res.end(filtered);
            }).catch(error => {
                log(`inspect filter failed: ${error.message}`);
                if (!res.headersSent) {
                    sendDenied(res, 502, 'unexpected upstream answer');
                }
            });
            return;
        }
        res.writeHead(response.statusCode ?? 502, responseHeaders);
        response.pipe(res);
    });
    upstream.on('error', error => {
        log(`upstream error for ${req.method} ${req.url}: ${error.message}`);
        if (res.headersSent) {
            res.destroy();
        } else {
            sendDenied(res, 502, 'docker daemon is unavailable');
        }
    });
    res.on('close', () => upstream.destroy());
    upstream.end(body);
}

/**
 * Reads the declared request body of an upgrade request from `head` plus the socket. Bytes past the
 * body are returned separately and are only ever sent upstream after the daemon answers 101.
 * @param {net.Socket} socket
 * @param {Buffer} head
 * @param {number} length
 * @returns {Promise<{ body: Buffer, rest: Buffer }>}
 */
function readUpgradeBody(socket, head, length) {
    return new Promise((resolve, reject) => {
        let buffered = head;
        const finish = () => {
            socket.off('data', onData);
            socket.off('end', onEnd);
            clearTimeout(timer);
            socket.pause();
            resolve({ body: buffered.subarray(0, length), rest: buffered.subarray(length) });
        };
        const onData = chunk => {
            buffered = Buffer.concat([buffered, chunk]);
            if (buffered.length >= length) {
                finish();
            }
        };
        const onEnd = () => {
            clearTimeout(timer);
            reject(new ProxyDenied(400, 'request aborted'));
        };
        const timer = setTimeout(() => {
            socket.off('data', onData);
            reject(new ProxyDenied(400, 'request body timed out'));
        }, 10_000);
        if (buffered.length >= length) {
            finish();
            return;
        }
        socket.on('data', onData);
        socket.on('end', onEnd);
        socket.resume();
    });
}

/**
 * Hijacked endpoints. The canonical request goes upstream first; client bytes follow only after the
 * daemon's 101. Any other answer is relayed with Connection: close and both connections are closed,
 * so nothing the client sends can reach the daemon as a second, uninspected HTTP request.
 * @param {http.IncomingMessage} req
 * @param {net.Socket} socket
 * @param {Buffer} head
 * @param {ProxyConfig} cfg
 * @param {OwnershipChecker} ownership
 * @param {(line: string) => void} log
 */
async function handleUpgrade(req, socket, head, cfg, ownership, log) {
    socket.on('error', () => {});
    socket.pause();
    const fail = (status, reason, body) => {
        log(`DENY upgrade ${req.method} ${req.url} -> ${reason}`);
        sendDeniedRaw(socket, status, reason, body);
    };
    if (req.headers['transfer-encoding'] !== undefined) {
        fail(400, 'chunked upgrade requests are not allowed');
        return;
    }
    const declared = req.headers['content-length'] ?? '0';
    const length = /^\d{1,6}$/.test(declared) ? Number(declared) : NaN;
    if (!Number.isFinite(length) || length > MAX_SMALL_BODY_BYTES) {
        fail(400, 'invalid Content-Length on upgrade request');
        return;
    }
    if (String(req.headers.upgrade ?? '').toLowerCase() !== 'tcp') {
        fail(400, 'only Upgrade: tcp is supported');
        return;
    }
    let pending;
    let verdict;
    try {
        pending = await readUpgradeBody(socket, head ?? Buffer.alloc(0), length);
        verdict = await evaluateRequest(req, cfg, { isUpgrade: true, readRequestBody: async () => pending.body, ownership });
    } catch (error) {
        fail(error.status ?? 500, error instanceof ProxyDenied ? error.message : 'internal proxy error');
        return;
    }
    if (!verdict.ok) {
        fail(verdict.status, verdict.reason, verdict.body);
        return;
    }
    const body = verdict.body ?? (verdict.route.body ? Buffer.from('{}') : Buffer.alloc(0));
    if (!verdict.route.body && pending.body.toString('utf8').trim() !== '' && pending.body.toString('utf8').trim() !== '{}') {
        fail(403, 'attach requests take no body');
        return;
    }
    const headers = forwardedHeaders(req.headers);
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [name, value] of Object.entries(headers)) {
        raw += `${name}: ${value}\r\n`;
    }
    if (verdict.route.body) {
        raw += 'content-type: application/json\r\n';
    }
    raw += `connection: Upgrade\r\nupgrade: tcp\r\ncontent-length: ${body.length}\r\n\r\n`;

    const upstream = net.connect({ path: cfg.upstreamPath });
    upstream.on('error', error => {
        log(`upstream error for upgrade ${req.url}: ${error.message}`);
        socket.destroy();
    });
    socket.on('close', () => upstream.destroy());
    upstream.on('connect', () => {
        upstream.write(raw);
        upstream.write(body);
    });
    let responseHead = Buffer.alloc(0);
    const onUpstreamData = chunk => {
        responseHead = Buffer.concat([responseHead, chunk]);
        const end = responseHead.indexOf('\r\n\r\n');
        if (end === -1) {
            if (responseHead.length > MAX_RESPONSE_HEAD_BYTES) {
                upstream.destroy();
                socket.destroy();
            }
            return;
        }
        upstream.off('data', onUpstreamData);
        const headerText = responseHead.subarray(0, end).toString('latin1');
        const afterHead = responseHead.subarray(end + 4);
        const [statusLine, ...headerLines] = headerText.split('\r\n');
        const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(statusLine)?.[1] ?? 0);
        if (status === 101) {
            socket.write(`${statusLine}\r\n${headerLines.map(line => `${line}\r\n`).join('')}${PROXY_HEADER}: 1\r\n\r\n`);
            if (afterHead.length > 0) {
                socket.write(afterHead);
            }
            if (pending.rest.length > 0) {
                upstream.write(pending.rest);
            }
            upstream.pipe(socket);
            socket.pipe(upstream);
            socket.resume();
            return;
        }
        // Not upgraded: relay the answer, never forward another client byte, close both sides.
        const kept = headerLines.filter(line => !/^(connection|keep-alive|transfer-encoding|upgrade)\s*:/i.test(line));
        const contentLength = Number(/^content-length\s*:\s*(\d+)/im.exec(headerLines.join('\n'))?.[1] ?? NaN);
        log(`upgrade ${req.method} ${req.url} answered ${status}; closing`);
        socket.write(`${statusLine || 'HTTP/1.1 502 Bad Gateway'}\r\n${kept.map(line => `${line}\r\n`).join('')}${PROXY_HEADER}: 1\r\nConnection: close\r\n\r\n`);
        let remaining = Number.isFinite(contentLength) ? contentLength : MAX_SMALL_BODY_BYTES;
        const relay = data => {
            const slice = data.subarray(0, remaining);
            remaining -= slice.length;
            socket.write(slice);
            if (remaining <= 0) {
                close();
            }
        };
        const close = () => {
            clearTimeout(timer);
            upstream.off('data', relay);
            upstream.destroy();
            socket.end();
            setTimeout(() => socket.destroy(), 1000).unref();
        };
        const timer = setTimeout(close, Number.isFinite(contentLength) ? 5000 : 1000);
        if (afterHead.length > 0) {
            relay(afterHead);
        }
        if (remaining > 0) {
            upstream.on('data', relay);
            upstream.on('end', close);
        }
    };
    upstream.on('data', onUpstreamData);
}

/**
 * Builds the proxy server. Listening is left to the caller so tests can use temporary sockets.
 * @param {ProxyConfig} cfg
 * @param {{ log?: (line: string) => void }} [options]
 * @returns {http.Server}
 */
export function createProxy(cfg, options = {}) {
    const log = options.log ?? (line => process.stderr.write(`[docker-tenants-socket-proxy] ${line}\n`));
    const ownership = new OwnershipChecker(cfg);
    const server = http.createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 60_000 }, (req, res) => {
        evaluateRequest(req, cfg, { isUpgrade: false, readRequestBody: limit => readBody(req, limit), ownership })
            .then(verdict => {
                if (!verdict.ok) {
                    log(`DENY ${req.method} ${req.url} -> ${verdict.reason}`);
                    req.resume();
                    sendDenied(res, verdict.status, verdict.reason, verdict.body);
                    return;
                }
                forwardHttp(req, res, verdict, cfg, log);
            })
            .catch(error => {
                log(`proxy error: ${error.message}`);
                if (!res.headersSent) {
                    sendDenied(res, 502, 'internal proxy error');
                }
            });
    });
    server.on('upgrade', (req, socket, head) => {
        handleUpgrade(req, socket, head, cfg, ownership, log).catch(error => {
            log(`proxy error on upgrade: ${error.message}`);
            socket.destroy();
        });
    });
    server.on('clientError', (error, socket) => {
        log(`client error: ${error.message}`);
        if (socket.writable) {
            socket.end(`HTTP/1.1 400 Bad Request\r\n${PROXY_HEADER}: 1\r\nConnection: close\r\n\r\n`);
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

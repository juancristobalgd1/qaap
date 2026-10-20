// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import { injectable } from '@theia/core/shared/inversify';

interface QaapSecurityLogWindow {
    readonly startedAt: number;
    suppressed: number;
}

const LOG_WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 10_000;
const MAX_FORWARDED_HOPS = 10;

/**
 * Loopback peers (Caddy on the host) are always trusted when no `QAAP_TRUSTED_PROXY_CIDRS` is set.
 * The subnets of the process's own non-internal network interfaces are added at runtime (see
 * `ownInterfaceCidrs`), so Caddy on the compose network is trusted whatever address pool Docker
 * uses (e.g. `default-address-pools` 10.200.0.0/16), while other LAN/VPN ranges stay untrusted.
 */
export const QAAP_DEFAULT_TRUSTED_PROXY_CIDRS: readonly string[] = ['127.0.0.0/8', '::1/128'];

/**
 * Per-client sampling for high-volume security events (refused Socket.IO handshakes). A browser
 * with an expired session, or a scanner, retries every few seconds; logging each attempt floods
 * `docker logs`. The first event of a client per minute is logged; the next logged one carries the
 * number suppressed in between.
 */
@injectable()
export class QaapSecurityLogRateLimiter {

    protected readonly windows = new Map<string, QaapSecurityLogWindow>();

    /**
     * Returns `undefined` when the event must be dropped, otherwise the extra fields to log
     * (`client`, and `suppressed` when earlier events of this client were dropped).
     */
    admit(event: string, request: http.IncomingMessage, now: number = Date.now()): { client: string; suppressed?: number } | undefined {
        const client = this.clientAddress(request);
        const key = `${event}\u0000${client}`;
        const window = this.windows.get(key);
        if (window && now - window.startedAt < LOG_WINDOW_MS) {
            window.suppressed += 1;
            return undefined;
        }
        this.windows.delete(key);
        if (this.windows.size >= MAX_TRACKED_KEYS) {
            // Map iteration order is insertion order: drop the oldest window.
            const oldest = this.windows.keys().next().value;
            if (oldest !== undefined) {
                this.windows.delete(oldest);
            }
        }
        this.windows.set(key, { startedAt: now, suppressed: 0 });
        return window?.suppressed ? { client, suppressed: window.suppressed } : { client };
    }

    protected trustedProxies: net.BlockList | undefined;

    /**
     * The client address used ONLY to key log sampling and fill the logged `client` field; it never
     * feeds an authorization decision (the callers decide before calling `admit`). When the peer is
     * a trusted proxy (`QAAP_TRUSTED_PROXY_CIDRS`), the right-most `X-Forwarded-For` hop that is not
     * itself a trusted proxy is the client; hops to its left are client-controlled and ignored.
     */
    protected clientAddress(request: http.IncomingMessage): string {
        const peer = normalizeAddress(request.socket?.remoteAddress ?? '');
        if (!peer) {
            return 'unknown';
        }
        if (!this.isTrustedProxy(peer)) {
            return peer;
        }
        const header = request.headers['x-forwarded-for'];
        const hops = (Array.isArray(header) ? header.join(',') : header ?? '')
            .split(',')
            .slice(-MAX_FORWARDED_HOPS)
            .map(hop => normalizeAddress(hop.trim()))
            .filter(hop => net.isIP(hop) !== 0);
        for (let i = hops.length - 1; i >= 0; i--) {
            if (!this.isTrustedProxy(hops[i])) {
                return hops[i];
            }
        }
        return hops[0] ?? peer;
    }

    protected isTrustedProxy(address: string): boolean {
        const family = net.isIP(address);
        if (family === 0) {
            return false;
        }
        this.trustedProxies ??= this.createTrustedProxyList(process.env.QAAP_TRUSTED_PROXY_CIDRS, this.ownInterfaceCidrs());
        return this.trustedProxies.check(address, family === 4 ? 'ipv4' : 'ipv6');
    }

    /**
     * CIDRs of this process's own non-internal, non-link-local interfaces. In the theia container
     * these are the compose network(s) shared with Caddy. If the control plane is ever attached to
     * a tenant bridge, its tenants become trusted for log keying only (the orchestrator does not
     * do this today). On a bare-metal, non-Docker install the host's LAN subnet becomes trusted.
     */
    protected networkInterfaces(): NodeJS.Dict<os.NetworkInterfaceInfo[]> {
        return os.networkInterfaces();
    }

    protected ownInterfaceCidrs(): string[] {
        const cidrs: string[] = [];
        for (const entries of Object.values(this.networkInterfaces())) {
            for (const entry of entries ?? []) {
                if (!entry.internal && entry.cidr && !entry.address.toLowerCase().startsWith('fe80:') && !entry.scopeid) {
                    cidrs.push(entry.cidr);
                }
            }
        }
        return cidrs;
    }

    /**
     * Comma-separated CIDRs or bare addresses; unset or blank keeps the defaults plus
     * `ownCidrs`, bad entries are skipped. A configured list replaces both.
     */
    protected createTrustedProxyList(configured: string | undefined, ownCidrs: readonly string[] = []): net.BlockList {
        const entries = configured?.trim()
            ? configured.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0)
            : [...QAAP_DEFAULT_TRUSTED_PROXY_CIDRS, ...ownCidrs];
        const list = new net.BlockList();
        for (const entry of entries) {
            const [address, prefixText] = entry.split('/', 2);
            const family = net.isIP(address);
            const prefix = prefixText === undefined ? (family === 4 ? 32 : 128) : Number(prefixText);
            if (family === 0 || !Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) {
                console.warn(`[qaap] Ignoring invalid QAAP_TRUSTED_PROXY_CIDRS entry: ${entry}`);
                continue;
            }
            list.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
        }
        return list;
    }
}

/** Unwraps IPv4-mapped IPv6 peers (`::ffff:172.18.0.2`) so IPv4 ranges match them. */
function normalizeAddress(address: string): string {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    return mapped ? mapped[1] : address;
}

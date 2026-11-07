// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import * as https from 'https';

/** Header the tenant socket proxy sets to `1` on `GET /_ping`. A raw daemon never sends it. */
export const QAAP_TENANT_PROXY_HEADER = 'x-qaap-tenant-proxy';

/** The connection details dockerode keeps on its Modem: a socket path, or a host, port and TLS material. */
export interface QaapDockerEndpoint {
    readonly socketPath?: string;
    readonly host?: string;
    readonly port?: number | string;
    readonly protocol?: string;
    readonly ca?: string | Buffer | Array<string | Buffer>;
    readonly cert?: string | Buffer | Array<string | Buffer>;
    readonly key?: string | Buffer | Array<string | Buffer>;
}

/** True only when the response carries the proxy identity header with the value `1`. */
export function isQaapTenantProxyPing(headers: http.IncomingHttpHeaders): boolean {
    return headers[QAAP_TENANT_PROXY_HEADER] === '1';
}

/**
 * `GET /_ping` on a Docker endpoint, resolving with the response headers. Plain Node http is used
 * because dockerode does not expose response headers.
 * @param endpoint the socket path, or the host, port and TLS material of the Docker endpoint.
 * @param timeoutMs how long to wait before failing the probe.
 */
export function requestDockerPingHeaders(endpoint: QaapDockerEndpoint, timeoutMs: number = 5000): Promise<http.IncomingHttpHeaders> {
    return new Promise((resolve, reject) => {
        if (!endpoint.socketPath && !endpoint.host) {
            reject(new Error('Docker endpoint has neither a socket path nor a host.'));
            return;
        }
        const options = { method: 'GET', path: '/_ping' };
        let request: http.ClientRequest;
        if (endpoint.socketPath) {
            request = http.request({ ...options, socketPath: endpoint.socketPath });
        } else if (endpoint.protocol === 'https' || endpoint.protocol === 'https:') {
            request = https.request({ ...options, host: endpoint.host, port: endpoint.port, ca: endpoint.ca, cert: endpoint.cert, key: endpoint.key });
        } else {
            request = http.request({ ...options, host: endpoint.host, port: endpoint.port });
        }
        request.setTimeout(timeoutMs, () => request.destroy(new Error(`Docker /_ping timed out after ${timeoutMs} ms`)));
        request.once('error', reject);
        request.once('response', response => {
            response.resume();
            resolve(response.headers);
        });
        request.end();
    });
}

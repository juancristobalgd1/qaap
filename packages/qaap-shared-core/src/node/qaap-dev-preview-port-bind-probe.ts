// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as net from 'net';

/**
 * Hosts a dev server may bind. Loopback catches servers bound to 127.0.0.1; the wildcard catches
 * `--hostname 0.0.0.0` servers and, on Linux, any IPv4 listener on the port.
 */
export const QAAP_DEV_PREVIEW_BIND_PROBE_HOSTS: readonly string[] = ['127.0.0.1', '0.0.0.0'];

function canBind(port: number, host: string): Promise<boolean> {
    return new Promise(resolve => {
        const server = net.createServer();
        server.unref();
        server.once('error', (error: NodeJS.ErrnoException) => {
            // Only "someone holds it" / "we may not hold it" mean unusable. A host this runtime
            // has no address for (EADDRNOTAVAIL, EAFNOSUPPORT) says nothing about the port.
            resolve(error.code !== 'EADDRINUSE' && error.code !== 'EACCES');
        });
        server.listen({ port, host, exclusive: true }, () => {
            server.close(() => resolve(true));
        });
    });
}

/**
 * True when nothing listens on `port` on any of `hosts`: an HTTP probe misses a listener that does
 * not answer HTTP yet (a Theia backend still booting, a raw TCP service), and a dev server started
 * on such a port exits with EADDRINUSE — or quietly with code 0 — and the preview never opens.
 */
export async function isQaapDevPreviewPortBindable(port: number, hosts: readonly string[] = QAAP_DEV_PREVIEW_BIND_PROBE_HOSTS): Promise<boolean> {
    for (const host of hosts) {
        if (!await canBind(port, host)) {
            return false;
        }
    }
    return true;
}

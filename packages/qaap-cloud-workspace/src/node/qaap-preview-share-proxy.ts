// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { Application, Request, Response } from '@theia/core/shared/express';
import * as http from 'http';
import * as net from 'net';
import {
    isAllowedDevPreviewPort,
    parseQaapDevPreviewPort,
} from '@theia/qaap-mobile-shell/lib/common/qaap-dev-preview';
import { QaapDevPreviewTargetHostResolver } from '@theia/qaap-mobile-shell/lib/node/qaap-dev-preview-target-host';
import { QaapDevPreviewPortRegistry } from '@theia/qaap-mobile-shell/lib/node/qaap-dev-preview-port-registry';
import { FileUri } from '@theia/core/lib/node';
import { QAAP_DEV_PREVIEW_PUBLIC_PREFIX, parseQaapPublicPreviewSharePath } from '../common/qaap-preview-share';
import { buildQaapPreviewFailureHtml } from '../common/qaap-preview-supervisor-types';
import { QaapPreviewShareStore, type QaapPreviewShareEntry } from './qaap-preview-share-store';
import { QaapPreviewSupervisor } from './qaap-preview-supervisor';
import { QaapCloudWorkspaceStore } from './qaap-cloud-workspace-store';

@injectable()
export class QaapPreviewShareProxyContribution implements BackendApplicationContribution {

    @inject(QaapPreviewShareStore)
    protected readonly shares: QaapPreviewShareStore;

    @inject(QaapPreviewSupervisor)
    protected readonly supervisor: QaapPreviewSupervisor;

    @inject(QaapCloudWorkspaceStore)
    protected readonly workspaces: QaapCloudWorkspaceStore;

    @inject(QaapDevPreviewPortRegistry)
    protected readonly portRegistry: QaapDevPreviewPortRegistry;

    protected readonly targetHostResolver = new QaapDevPreviewTargetHostResolver();

    /**
     * A public share pins a loopback port at creation time, but ports on the shared backend can be
     * reassigned to another tenant later. If the port is now CLAIMED by a DIFFERENT owner, the share
     * would leak that tenant's dev server — refuse and revoke it. Undefined/matching ownership is
     * allowed (a reassignment can't be proven; unclaimed raw servers stay reachable). (SEC-6)
     */
    protected portReassignedToAnotherTenant(entry: QaapPreviewShareEntry, port: number): boolean {
        if (entry.ownerLogin === undefined) {
            return false;
        }
        const currentOwner = this.portRegistry.ownerOf(port);
        return currentOwner !== undefined && currentOwner !== entry.ownerLogin;
    }

    configure(app: Application): void {
        app.use(`${QAAP_DEV_PREVIEW_PUBLIC_PREFIX}/:token`, (req, res) => {
            void this.handleProxy(req, res);
        });
    }

    onStart(server: http.Server): void {
        server.on('upgrade', (req, socket, head) => {
            void this.handleWebSocketUpgrade(req, socket as net.Socket, head);
        });
    }

    protected async handleProxy(req: Request, res: Response): Promise<void> {
        const token = typeof req.params.token === 'string' ? req.params.token : '';
        const entry = await this.shares.resolve(token);
        if (!entry) {
            res.status(404).type('text/plain').send('Preview share link expired or unknown.');
            return;
        }
        const port = parseQaapDevPreviewPort(entry.port);
        if (port === undefined || !isAllowedDevPreviewPort(port)) {
            res.status(400).send('Invalid preview port');
            return;
        }
        if (this.portReassignedToAnotherTenant(entry, port)) {
            await this.shares.revoke(token);
            res.status(404).type('text/plain').send('Preview share link expired or unknown.');
            return;
        }
        await this.forwardHttp(req, res, port, req.url || '/', entry);
    }

    /** Serves the self-contained failure page describing why the dev server is down + a Restart action. */
    protected async sendFailurePage(res: Response, port: number, entry: QaapPreviewShareEntry): Promise<void> {
        if (res.headersSent) {
            res.end();
            return;
        }
        const cwd = await this.resolveWorkspaceCwd(entry);
        const snapshot = this.supervisor.describe(port);
        res.status(503).type('text/html').send(buildQaapPreviewFailureHtml({
            port,
            cwd: snapshot?.cwd ?? cwd,
            exitCode: snapshot?.exitCode,
            signal: snapshot?.signal,
            stderrTail: snapshot?.stderrTail,
            everStarted: snapshot !== undefined,
        }));
    }

    /** Resolves the workspace directory backing a share so the Restart button can target it. */
    protected async resolveWorkspaceCwd(entry: QaapPreviewShareEntry): Promise<string | undefined> {
        if (!entry.repoKey) {
            return undefined;
        }
        try {
            const rows = await this.workspaces.list(entry.ownerLogin);
            const workspaceUri = rows.find(row => row.repoKey === entry.repoKey)?.workspaceUri;
            return workspaceUri ? FileUri.fsPath(workspaceUri) : undefined;
        } catch {
            return undefined;
        }
    }

    protected async handleWebSocketUpgrade(
        req: http.IncomingMessage,
        socket: net.Socket,
        head: Buffer,
    ): Promise<void> {
        const pathname = (req.url ?? '').split('?')[0];
        const parsed = parseQaapPublicPreviewSharePath(pathname);
        if (!parsed) {
            return;
        }
        const entry = await this.shares.resolve(parsed.token);
        if (!entry) {
            socket.destroy();
            return;
        }
        const port = parseQaapDevPreviewPort(entry.port);
        if (port === undefined) {
            socket.destroy();
            return;
        }
        if (this.portReassignedToAnotherTenant(entry, port)) {
            await this.shares.revoke(parsed.token);
            socket.destroy();
            return;
        }
        const query = (req.url ?? '').includes('?') ? (req.url ?? '').slice((req.url ?? '').indexOf('?')) : '';
        const path = `${parsed.targetPath}${query}`;
        const targetHost = await this.targetHostResolver.resolve(port);
        if (!targetHost) {
            socket.destroy();
            return;
        }
        // `localhost` keeps dev-server host checks happy regardless of loopback family.
        const headers = { ...req.headers, host: `localhost:${port}` };
        const proxyReq = http.request({
            hostname: targetHost,
            port,
            path,
            method: req.method,
            headers,
        });
        proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
            const headerLines = Object.entries(proxyRes.headers)
                .filter(([, value]) => value !== undefined)
                .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
            socket.write(
                `HTTP/1.1 ${proxyRes.statusCode ?? 101} ${proxyRes.statusMessage ?? 'Switching Protocols'}\r\n`
                + `${headerLines.join('\r\n')}\r\n\r\n`,
            );
            if (head.length > 0) {
                proxySocket.write(head);
            }
            if (proxyHead.length > 0) {
                proxySocket.write(proxyHead);
            }
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);
        });
        proxyReq.on('error', () => socket.destroy());
        proxyReq.end();
    }

    protected async forwardHttp(incoming: Request, outgoing: Response, targetPort: number, targetPath: string, entry: QaapPreviewShareEntry): Promise<void> {
        const targetHost = await this.targetHostResolver.resolve(targetPort);
        if (!targetHost) {
            await this.sendFailurePage(outgoing, targetPort, entry);
            return;
        }
        const headers: http.OutgoingHttpHeaders = { ...incoming.headers };
        headers.host = `localhost:${targetPort}`;
        delete headers.connection;
        const proxyReq = http.request({
            hostname: targetHost,
            port: targetPort,
            path: targetPath,
            method: incoming.method,
            headers,
        }, proxyRes => {
            outgoing.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(outgoing);
        });
        proxyReq.on('error', () => {
            void this.sendFailurePage(outgoing, targetPort, entry);
        });
        incoming.pipe(proxyReq);
    }
}

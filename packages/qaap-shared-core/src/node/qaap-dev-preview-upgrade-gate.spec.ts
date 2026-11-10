// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import type * as net from 'net';
import { installPreviewUpgradeGateExtracted } from './qaap-dev-preview-endpoint-streaming';
import type { QaapDevPreviewEndpointContext } from './qaap-dev-preview-endpoint-context';
import { QaapDevPreviewPortRegistry } from './qaap-dev-preview-port-registry';
import { buildQaapPreviewHostLabel, parseQaapPreviewHostLabel, resolveQaapPreviewBaseDomainForRequest } from './qaap-preview-host';

describe('qaap-dev-preview upgrade gate', () => {
    const record = { previewId: 'p1', ownerLogin: 'local', port: 3001 };

    function setup(): { server: http.Server; proxied: string[]; product: string[] } {
        const proxied: string[] = [];
        const product: string[] = [];
        const ctx = {
            previewHostLabel: (req: http.IncomingMessage) => req.headers.host?.startsWith('label.') ? 'label' : undefined,
            portRegistry: {
                getByHostLabel: (label: string) => label === 'label' ? record : undefined,
                get: (previewId: string) => previewId === record.previewId ? record : undefined,
            },
            handleWebSocketUpgrade: (req: http.IncomingMessage) => { proxied.push(`${req.headers.host}${req.url}`); },
        } as unknown as QaapDevPreviewEndpointContext;
        const server = http.createServer();
        // Registered before and after the gate: order must not matter.
        server.on('upgrade', (req: http.IncomingMessage) => { product.push(`${req.headers.host}${req.url}`); });
        installPreviewUpgradeGateExtracted(ctx, server);
        server.on('upgrade', (req: http.IncomingMessage) => { product.push(`late:${req.headers.host}${req.url}`); });
        return { server, proxied, product };
    }

    const upgrade = (server: http.Server, host: string, url: string): void => {
        server.emit('upgrade', { headers: { host }, url } as unknown as http.IncomingMessage, {} as net.Socket, Buffer.alloc(0));
    };

    it('sends a preview-origin agent socket only to the preview proxy', () => {
        const { server, proxied, product } = setup();
        upgrade(server, 'label.localhost:3107', '/qaap/api/agent-conversations/ws');
        upgrade(server, 'label.localhost:3107', '/socket.io/?EIO=4&transport=websocket');
        expect(proxied).to.deep.equal(['label.localhost:3107/qaap/api/agent-conversations/ws', 'label.localhost:3107/socket.io/?EIO=4&transport=websocket']);
        expect(product).to.deep.equal([]);
    });

    it('claims the real `<hostLabel>.localhost:<port>` form of a registered preview', () => {
        const registry = new QaapDevPreviewPortRegistry();
        const registered = registry.register({
            previewId: 'p-project-c-conv-r-run-abc1234', projectId: 'project', conversationId: 'conv', runId: 'run',
            ownerLogin: 'local', root: '/Users/jc/qaap', port: 3001,
        })!;
        const label = buildQaapPreviewHostLabel(registered.previewId, registered.accessToken);
        expect(label).to.match(/^[0-9a-f]{32}$/);
        const proxied: string[] = [];
        const product: string[] = [];
        const ctx = {
            previewHostLabel: (req: http.IncomingMessage) => parseQaapPreviewHostLabel(req.headers.host, resolveQaapPreviewBaseDomainForRequest(req.headers.host)),
            portRegistry: registry,
            handleWebSocketUpgrade: (req: http.IncomingMessage) => { proxied.push(String(req.url)); },
        } as unknown as QaapDevPreviewEndpointContext;
        const server = http.createServer();
        server.on('upgrade', (req: http.IncomingMessage) => { product.push(String(req.url)); });
        installPreviewUpgradeGateExtracted(ctx, server);
        upgrade(server, `${label}.localhost:3107`, '/qaap/api/agent-conversations/ws');
        upgrade(server, 'localhost:3107', '/qaap/api/agent-conversations/ws');
        expect(proxied).to.deep.equal(['/qaap/api/agent-conversations/ws']);
        expect(product).to.deep.equal(['/qaap/api/agent-conversations/ws']);
    });

    it('claims a known /qaap-preview/<id>/ socket exclusively', () => {
        const { server, proxied, product } = setup();
        upgrade(server, 'localhost:3107', '/qaap-preview/p1/socket.io/?EIO=4');
        expect(proxied).to.have.length(1);
        expect(product).to.deep.equal([]);
    });

    it('leaves the IDE\'s own sockets and unknown preview hosts to the listeners', () => {
        const { server, proxied, product } = setup();
        upgrade(server, 'localhost:3107', '/qaap/api/agent-conversations/ws');
        upgrade(server, 'other.localhost:3107', '/qaap/api/agent-tasks/ws');
        upgrade(server, 'localhost:3107', '/qaap-preview/unknown/ws');
        expect(proxied).to.deep.equal([]);
        expect(product).to.have.length(6);
    });
});

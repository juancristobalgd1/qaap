// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createPluginHostProxyAgentParams } from './plugin-host-proxy';

describe('plugin-host-proxy', () => {
    it('reads the current proxy and certificate preferences dynamically', async () => {
        const settings = new Map<string, unknown>([
            ['proxy', 'http://proxy.example:8080'],
            ['proxySupport', 'fallback'],
            ['noProxy', ['localhost', '*.internal.example']],
            ['systemCertificates', true],
        ]);
        const configProvider = {
            getConfiguration: (section: string) => {
                expect(section).to.equal('http');
                return { get: <T>(key: string): T | undefined => settings.get(key) as T | undefined };
            },
        };
        const workspaceExt = {
            resolveProxy: async (url: string) => url.includes('direct') ? 'DIRECT' : 'PROXY proxy.example:8080',
        };

        const params = createPluginHostProxyAgentParams(workspaceExt as never, configProvider as never);
        expect(params.getProxyURL()).to.equal('http://proxy.example:8080');
        expect(params.getProxySupport()).to.equal('fallback');
        expect(params.getNoProxyConfig?.()).to.deep.equal(['localhost', '*.internal.example']);
        expect(params.addCertificatesV1()).to.equal(true);
        expect(await params.resolveProxy('https://service.example')).to.equal('PROXY proxy.example:8080');

        settings.set('proxySupport', 'off');
        settings.set('systemCertificates', false);
        expect(params.getProxySupport()).to.equal('off');
        expect(params.addCertificatesV1()).to.equal(false);
    });
});

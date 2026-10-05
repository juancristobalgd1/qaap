// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Container } from '@theia/core/shared/inversify';
import { DebugService } from '@theia/debug/lib/common/debug-service';
import { QaapPhoneDebugServer, QaapPhoneDebugService } from './qaap-phone-debug-service';

/** Records every method called on it, like an RPC proxy that turns any property into a remote call. */
function recordingServer(calls: string[]): DebugService {
    return new Proxy({}, {
        // Like RpcProxyFactory, not thenable, so the container does not await it.
        get: (_target, property) => property === 'then' ? undefined : (...args: unknown[]) => {
            calls.push(String(property));
            return Promise.resolve(property === 'debugTypes' ? ['node'] : args);
        }
    }) as DebugService;
}

describe('QaapPhoneDebugService', () => {

    function create(calls: string[]): DebugService {
        const container = new Container();
        container.bind(QaapPhoneDebugServer).toConstantValue(recordingServer(calls));
        container.bind(QaapPhoneDebugService).toSelf().inSingletonScope();
        container.bind(DebugService).toService(QaapPhoneDebugService);
        return container.get<DebugService>(DebugService);
    }

    it('keeps onDidChangeDebugConfigurationProviders local instead of notifying the backend', () => {
        const calls: string[] = [];
        const subscription = create(calls).onDidChangeDebugConfigurationProviders(() => undefined);
        expect(calls).to.deep.equal([]);
        expect(subscription.dispose).to.be.a('function');
        subscription.dispose();
    });

    it('does not expose the optional plugin-only members', () => {
        const service = create([]);
        expect(service.onDidChangeDebuggers).to.equal(undefined);
        expect(service.getDynamicDebugConfigurationProviderTypes).to.equal(undefined);
    });

    it('sends requests to the backend', async () => {
        const calls: string[] = [];
        expect(await create(calls).debugTypes()).to.deep.equal(['node']);
        expect(calls).to.deep.equal(['debugTypes']);
    });
});

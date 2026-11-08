// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createPiProviderErrorWatcher } from './qaap-pi-provider-error-watcher';

const PROVIDER_ERROR = '{"message":"Provider returned error","code":503,"metadata":{"raw":"{\\"error\\":\\"no upstreams available\\"}","provider_name":"Recursive"}}';

function assistantMessageEnd(stopReason: string, errorMessage?: string): string {
    return JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', content: [], stopReason, errorMessage },
    });
}

describe('qaap-pi-provider-error-watcher', () => {
    it('reports the provider error of a failed assistant message', () => {
        const watcher = createPiProviderErrorWatcher();
        watcher.push(`${JSON.stringify({ type: 'session', id: 'x' })}\n`);
        watcher.push(`${assistantMessageEnd('error', PROVIDER_ERROR)}\n`);
        expect(watcher.finalError()).to.equal(PROVIDER_ERROR);
    });

    it('reports nothing for a successful turn', () => {
        const watcher = createPiProviderErrorWatcher();
        watcher.push(`${assistantMessageEnd('stop')}\n`);
        expect(watcher.finalError()).to.equal(undefined);
    });

    it('lets a later successful answer clear an earlier error (Pi retried)', () => {
        const watcher = createPiProviderErrorWatcher();
        watcher.push(`${assistantMessageEnd('error', PROVIDER_ERROR)}\n${assistantMessageEnd('stop')}\n`);
        expect(watcher.finalError()).to.equal(undefined);
    });

    it('joins a record split across stdout chunks', () => {
        const watcher = createPiProviderErrorWatcher();
        const line = `${assistantMessageEnd('error', PROVIDER_ERROR)}\n`;
        watcher.push(line.slice(0, 40));
        expect(watcher.finalError()).to.equal(undefined);
        watcher.push(line.slice(40));
        expect(watcher.finalError()).to.equal(PROVIDER_ERROR);
    });

    it('ignores user messages, non-JSON lines and records that only mention the word', () => {
        const watcher = createPiProviderErrorWatcher();
        watcher.push('[qaap] starting pi\n');
        watcher.push(`${JSON.stringify({ type: 'message_end', message: { role: 'user', stopReason: 'error', errorMessage: 'x' } })}\n`);
        watcher.push(`${JSON.stringify({ type: 'message_update', text: 'message_end' })}\n`);
        expect(watcher.finalError()).to.equal(undefined);
    });

    it('uses a generic text when Pi gives no error message', () => {
        const watcher = createPiProviderErrorWatcher();
        watcher.push(`${assistantMessageEnd('error')}\n`);
        expect(watcher.finalError()).to.equal('The model provider returned an error.');
    });
});

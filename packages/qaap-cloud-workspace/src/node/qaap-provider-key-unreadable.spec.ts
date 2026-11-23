// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { assertProviderKeyReadableExtracted } from './qaap-agent-task-runner-streaming2';
import { QaapQaiqProviderKeyMissingError } from './qaap-qaiq-provider-preflight';

const OPENROUTER_PREF = 'ai-features.openrouter.openrouterApiKey';
const PI_MODEL = { provider: 'openai', vendor: 'openrouter', modelId: 'openrouter/cohere/north-mini-code:free' } as const;

function contextWith(unreadable: readonly string[], env: NodeJS.ProcessEnv = {}): QaapAgentTaskRunnerContext {
    return {
        listUnreadableSealedSettings: () => unreadable,
        previewProviderEnv: () => env,
        resolveQaapQaiqBinding: () => ({ vendor: 'openrouter' }),
    } as unknown as QaapAgentTaskRunnerContext;
}

describe('assertProviderKeyReadableExtracted', () => {
    let warn: typeof console.warn;

    beforeEach(() => {
        warn = console.warn;
        console.warn = () => undefined;
    });

    afterEach(() => {
        console.warn = warn;
    });

    it('refuses a Pi turn whose saved OpenRouter key this server cannot open, naming the provider', () => {
        expect(() => assertProviderKeyReadableExtracted(contextWith([OPENROUTER_PREF]), 'pi', 'alice', PI_MODEL))
            .to.throw(QaapQaiqProviderKeyMissingError, /^Your saved OpenRouter key cannot be read on this server\./);
    });

    it('lets the turn run when the key opens, or when another provider key is the unreadable one', () => {
        expect(() => assertProviderKeyReadableExtracted(contextWith([]), 'pi', 'alice', PI_MODEL)).not.to.throw();
        expect(() => assertProviderKeyReadableExtracted(contextWith(['ai-features.google.apiKey']), 'pi', 'alice', PI_MODEL)).not.to.throw();
    });

    it('lets the turn run when the provider env still carries a key (local operator runs)', () => {
        expect(() => assertProviderKeyReadableExtracted(contextWith([OPENROUTER_PREF], { OPENROUTER_API_KEY: 'sk-or-operator' }), 'pi', 'alice', PI_MODEL))
            .not.to.throw();
    });

    it('uses the Settings binding for QAIQ without a model pick, and ignores native agents without one', () => {
        expect(() => assertProviderKeyReadableExtracted(contextWith([OPENROUTER_PREF]), 'qaiq', 'alice', undefined)).to.throw(QaapQaiqProviderKeyMissingError);
        expect(() => assertProviderKeyReadableExtracted(contextWith([OPENROUTER_PREF]), 'claude', 'alice', undefined)).not.to.throw();
    });
});

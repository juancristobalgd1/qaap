// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapOpenAiLanguageModelsManagerImpl } from './qaap-openai-language-models-manager';
import { QaapSecretPlaceholderResolver } from './qaap-secret-placeholder-resolver';

describe('QaapOpenAiLanguageModelsManagerImpl placeholder resolution', () => {

    const placeholder = 'qaap-sealed-secret:ai-features.openrouter.openrouterApiKey';
    const resolver = (resolved: Record<string, string>): QaapSecretPlaceholderResolver => ({
        resolve: (value: string | undefined) => (value && value.startsWith('qaap-sealed-secret:') ? resolved[value] : value),
    }) as unknown as QaapSecretPlaceholderResolver;

    const manager = (secretResolver: QaapSecretPlaceholderResolver): QaapOpenAiLanguageModelsManagerImpl => {
        const instance = Object.create(QaapOpenAiLanguageModelsManagerImpl.prototype) as QaapOpenAiLanguageModelsManagerImpl;
        Object.assign(instance, { secretResolver });
        return instance;
    };

    it('uses the resolved key for setApiKey when a placeholder is sent', () => {
        const instance = manager(resolver({ [placeholder]: 'test-key-old' }));
        instance.setApiKey(placeholder);
        expect(instance.apiKey).to.equal('test-key-old');
    });

    it('keeps a plain key unchanged', () => {
        const instance = manager(resolver({}));
        instance.setApiKey('sk-plain');
        expect(instance.apiKey).to.equal('sk-plain');
    });

    it('resolves per-model placeholders and leaves other descriptions alone', () => {
        const instance = manager(resolver({ [placeholder]: 'test-key-old' }));
        const resolved = (instance as unknown as { resolveModelDescription(d: object): { apiKey?: unknown } });
        expect(resolved.resolveModelDescription({ id: 'a', apiKey: placeholder }).apiKey).to.equal('test-key-old');
        expect(resolved.resolveModelDescription({ id: 'b', apiKey: 'sk-plain' }).apiKey).to.equal('sk-plain');
        expect(resolved.resolveModelDescription({ id: 'c', apiKey: true }).apiKey).to.equal(true);
    });

    it('yields no key when the placeholder cannot be resolved', () => {
        const instance = manager(resolver({}));
        const resolved = (instance as unknown as { resolveModelDescription(d: object): { apiKey?: unknown } });
        expect(resolved.resolveModelDescription({ id: 'a', apiKey: placeholder }).apiKey).to.equal(undefined);
    });
});

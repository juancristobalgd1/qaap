// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// The preference renderer modules touch the DOM at import time; keep jsdom only while they load.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Preference } from '@theia/preferences/lib/browser/util/preference-types';
import {
    isQaapSecretPreferenceId,
    QaapSecretPreferenceInputRenderer,
    QaapSecretPreferenceInputRendererContribution,
} from './qaap-secret-preference-input-renderer';

disableImportJSDOM();

describe('isQaapSecretPreferenceId', () => {
    it('flags credential preference ids', () => {
        const secretIds = [
            'ai-features.openrouter.openrouterApiKey',
            'ai-features.anthropic.AnthropicApiKey',
            'ai-features.google.apiKey',
            'ai-features.openAiOfficial.openAiApiKey',
            'ai-features.nvidia.nvidiaApiKey',
            'ai-features.huggingFace.apiKey',
            'ai-features.claudeCode.apiKey',
            'ai-features.codex.apiKey',
            'ai-features.example.api_key',
            'ai-features.example.api-key',
            'ai-features.example.accessToken',
            'ai-features.example.clientSecret',
        ];
        for (const id of secretIds) {
            expect(isQaapSecretPreferenceId(id), id).to.equal(true);
        }
    });

    it('does not flag ordinary preference ids', () => {
        const plainIds = [
            'ai-features.openrouter.openrouterBaseUrl',
            'editor.fontSize',
            'ai-features.openrouter.openrouterModels',
        ];
        for (const id of plainIds) {
            expect(isQaapSecretPreferenceId(id), id).to.equal(false);
        }
    });
});

describe('QaapSecretPreferenceInputRendererContribution.canHandle', () => {
    const leaf = (id: string, type: string | string[]): Preference.LeafNode => ({
        id,
        depth: 1,
        preference: { data: { type } },
    }) as unknown as Preference.LeafNode;

    it('takes priority over the upstream string renderer (2) for string credentials', () => {
        const contribution = new QaapSecretPreferenceInputRendererContribution();
        expect(contribution.canHandle(leaf('ai-features@ai-features.openrouter.openrouterApiKey', 'string'))).to.equal(3);
    });

    it('does not handle non-secret strings, non-string secrets or group nodes', () => {
        const contribution = new QaapSecretPreferenceInputRendererContribution();
        expect(contribution.canHandle(leaf('ai-features@ai-features.openrouter.openrouterBaseUrl', 'string'))).to.equal(0);
        expect(contribution.canHandle(leaf('editor@editor.fontSize', 'number'))).to.equal(0);
        expect(contribution.canHandle(leaf('ai-features@ai-features.example.apiKey', 'boolean'))).to.equal(0);
        expect(contribution.canHandle({ id: 'ai-features', depth: 0 } as unknown as Preference.TreeNode)).to.equal(0);
    });
});

describe('QaapSecretPreferenceInputRenderer', () => {
    /** Bare instance with the stored value stubbed; upstream value resolution is not under test here. */
    const createRenderer = (value: string): { renderer: any; parent: HTMLElement } => {
        const renderer: any = Object.create(QaapSecretPreferenceInputRenderer.prototype);
        renderer.getValue = (): string => value;
        const parent = document.createElement('div');
        renderer.createInteractable(parent);
        return { renderer, parent };
    };

    it('masks the value by default and keeps it in the input', () => {
        const { renderer, parent } = createRenderer('sk-test-123');
        const input = renderer.interactable as HTMLInputElement;
        expect(input.type).to.equal('password');
        expect(input.autocomplete).to.equal('off');
        expect(input.value).to.equal('sk-test-123');
        expect(parent.querySelector('.qaap-secret-preference-input')).to.not.equal(null);
    });

    it('toggles visibility with the show/hide button', () => {
        const { renderer, parent } = createRenderer('sk-test-123');
        const input = renderer.interactable as HTMLInputElement;
        const toggle = parent.querySelector<HTMLButtonElement>('button.qaap-secret-preference-toggle')!;
        expect(toggle.getAttribute('aria-pressed')).to.equal('false');
        expect(toggle.getAttribute('aria-label')).to.equal('Show value');

        toggle.click();
        expect(input.type).to.equal('text');
        expect(toggle.getAttribute('aria-pressed')).to.equal('true');
        expect(toggle.getAttribute('aria-label')).to.equal('Hide value');
        expect(input.value).to.equal('sk-test-123');

        toggle.click();
        expect(input.type).to.equal('password');
        expect(toggle.getAttribute('aria-pressed')).to.equal('false');
    });
});

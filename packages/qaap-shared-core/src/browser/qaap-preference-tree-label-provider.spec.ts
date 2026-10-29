// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import { Preference } from '@theia/preferences/lib/browser/util/preference-types';
import { QaapPreferenceTreeLabelProvider } from './qaap-preference-tree-label-provider';

disableJSDOM();

describe('QaapPreferenceTreeLabelProvider', () => {

    const provider = new QaapPreferenceTreeLabelProvider();

    function leafNode(prefId: string): Preference.TreeNode {
        const group = prefId.split('.')[0];
        return {
            id: `${group}@${prefId}`,
            name: prefId.split('.').pop() ?? prefId,
            depth: 2,
            visible: true,
            children: [],
            parent: undefined,
        } as unknown as Preference.TreeNode;
    }

    it('labels a Pi-only API key preference with the provider name', () => {
        expect(provider.getName(leafNode('ai-features.pi.deepseekApiKey'))).to.equal('DeepSeek API key');
    });

    it('labels another Pi-only API key preference with the provider name', () => {
        expect(provider.getName(leafNode('ai-features.pi.xaiApiKey'))).to.equal('xAI API key');
    });

    it('keeps the upstream label for a preference that reuses an existing BYOK key', () => {
        expect(provider.getName(leafNode('ai-features.openrouter.openrouterApiKey'))).to.equal('Openrouter Api Key');
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import { Container } from '@theia/core/shared/inversify';
import { CompositeTreeNode } from '@theia/core/lib/browser/tree/tree';
import { Disposable } from '@theia/core/lib/common/disposable';
import { PreferenceConfigurations, PreferenceDataProperty, PreferenceSchemaService } from '@theia/core/lib/common/preferences';
import { PreferenceLayoutProvider } from '@theia/preferences/lib/browser/util/preference-layout';
import { PreferenceTreeLabelProvider } from '@theia/preferences/lib/browser/util/preference-tree-label-provider';
import { Preference } from '@theia/preferences/lib/browser/util/preference-types';
import { QaapPreferenceLayoutProvider } from './qaap-preference-layout-provider';
import { QaapPreferenceTreeGenerator } from './qaap-preference-tree-generator';

disableJSDOM();

describe('QaapPreferenceTreeGenerator', () => {

    const properties = new Map<string, PreferenceDataProperty>([
        'ai-features.zzz.option',
        'ai-features.ollama.ollamaHost',
        'ai-features.aaa.option',
        'ai-features.google.apiKey',
        'ai-features.anthropic.AnthropicApiKey',
        'ai-features.openrouter.openrouterApiKey',
        'ai-features.agentSettings',
        'zzzext.option',
        'aaaext.option',
    ].map(key => [key, { type: 'string' }]));

    function createGenerator(): QaapPreferenceTreeGenerator {
        const container = new Container();
        container.bind(PreferenceSchemaService).toConstantValue({
            getSchemaProperties: () => properties,
            onDidChangeSchema: () => Disposable.NULL,
        } as unknown as PreferenceSchemaService);
        container.bind(PreferenceConfigurations).toConstantValue({ isSectionName: () => false } as unknown as PreferenceConfigurations);
        container.bind(PreferenceTreeLabelProvider).toConstantValue({ formatString: (id: string) => id } as unknown as PreferenceTreeLabelProvider);
        container.bind(PreferenceLayoutProvider).to(QaapPreferenceLayoutProvider).inSingletonScope();
        container.bind(QaapPreferenceTreeGenerator).toSelf().inSingletonScope();
        return container.get(QaapPreferenceTreeGenerator);
    }

    function childGroupIds(root: CompositeTreeNode, topLevelId: string): string[] {
        const group = root.children.find(child => Preference.TreeNode.getGroupAndIdFromNodeId(child.id).id === topLevelId);
        expect(group, topLevelId).to.not.equal(undefined);
        return (group as CompositeTreeNode).children
            .filter(CompositeTreeNode.is)
            .map(child => Preference.TreeNode.getGroupAndIdFromNodeId(child.id).id);
    }

    it('keeps the curated AI Features layout order, with unknown groups after it alphabetically', () => {
        const root = createGenerator().generateTree();
        expect(childGroupIds(root, 'ai-features')).to.deep.equal([
            'ai-features.agents',
            'ai-features.openrouter',
            'ai-features.anthropic',
            'ai-features.google',
            'ai-features.ollama',
            'ai-features.aaa',
            'ai-features.zzz',
        ]);
    });

    it('leaves non-curated sections in the upstream id order', () => {
        const root = createGenerator().generateTree();
        expect(childGroupIds(root, 'extensions')).to.deep.equal(['extensions.aaaext', 'extensions.zzzext']);
    });
});

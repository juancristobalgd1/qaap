// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { ContributionProvider } from '@theia/core/lib/common/contribution-provider';
import { CommonCommands } from '@theia/core/lib/browser/common-commands';
import { QaapDisplayLanguageCommandContribution } from './qaap-display-language-command-contribution';

disableJSDOM();

class SpanishEnabledDisplayLanguageCommandContribution extends QaapDisplayLanguageCommandContribution {
    protected override readonly supportedLocales: readonly string[] = ['en', 'es'];
}

function startRegistry(contribution: CommandContribution): CommandRegistry {
    const core: CommandContribution = {
        registerCommands: registry => {
            registry.registerCommand(CommonCommands.CONFIGURE_DISPLAY_LANGUAGE, { execute: () => undefined });
        },
    };
    const provider: ContributionProvider<CommandContribution> = { getContributions: () => [core, contribution] };
    const registry = new CommandRegistry(provider);
    registry.onStart();
    return registry;
}

describe('QaapDisplayLanguageCommandContribution', () => {

    it('removes "Configure Display Language" while Qaap ships English only', () => {
        const registry = startRegistry(new QaapDisplayLanguageCommandContribution());
        expect(registry.getCommand(CommonCommands.CONFIGURE_DISPLAY_LANGUAGE.id)).to.equal(undefined);
        expect(registry.isVisible(CommonCommands.CONFIGURE_DISPLAY_LANGUAGE.id)).to.equal(false);
    });

    it('keeps the command once another display language is enabled', () => {
        const registry = startRegistry(new SpanishEnabledDisplayLanguageCommandContribution());
        expect(registry.getCommand(CommonCommands.CONFIGURE_DISPLAY_LANGUAGE.id)).to.not.equal(undefined);
    });

    it('is a no-op when core did not register the command (trimmed entries)', () => {
        const registry = new CommandRegistry({ getContributions: () => [new QaapDisplayLanguageCommandContribution()] });
        expect(() => registry.onStart()).to.not.throw();
    });
});

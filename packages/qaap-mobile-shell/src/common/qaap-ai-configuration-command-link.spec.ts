// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildAiConfigurationCommandLink,
    resolveAiConfigurationTabArg,
} from './qaap-ai-configuration-command-link';

describe('qaap-ai-configuration-command-link', () => {
    it('builds a JSON-encoded command link for CommandOpenHandler', () => {
        const link = buildAiConfigurationCommandLink('ai-skills-configuration-widget');
        expect(link.startsWith('command:aiConfiguration:open?')).to.equal(true);
        const query = decodeURIComponent(link.slice('command:aiConfiguration:open?'.length));
        expect(JSON.parse(query)).to.equal('ai-skills-configuration-widget');
    });

    it('resolves tab args from string, quoted JSON, or array', () => {
        expect(resolveAiConfigurationTabArg('ai-mcp-configuration-container-widget', 'fallback'))
            .to.equal('ai-mcp-configuration-container-widget');
        expect(resolveAiConfigurationTabArg('"ai-skills-configuration-widget"', 'fallback'))
            .to.equal('ai-skills-configuration-widget');
        expect(resolveAiConfigurationTabArg(['ai-model-aliases-configuration-widget'], 'fallback'))
            .to.equal('ai-model-aliases-configuration-widget');
        expect(resolveAiConfigurationTabArg(undefined, 'fallback')).to.equal('fallback');
        expect(resolveAiConfigurationTabArg('', 'fallback')).to.equal('fallback');
    });
});

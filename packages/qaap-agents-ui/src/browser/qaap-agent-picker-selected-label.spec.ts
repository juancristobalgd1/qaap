// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { formatAgentPickerSelectedLabel } from './qaap-agent-ui';

disableImportJSDOM();

describe('agent picker selected label', () => {

    it('shows the readable model label instead of the raw slug and the duplicated provider', () => {
        const label = formatAgentPickerSelectedLabel('OpenCode', {
            modelId: 'opencode/beam-free',
            label: undefined,
        });
        expect(label).to.equal('OpenCode · Beam Free');
        expect(label).to.not.contain('opencode/beam-free');
        expect(label).to.not.contain('Opencode');
    });

    it('uses the stored catalog label when present', () => {
        expect(formatAgentPickerSelectedLabel('OpenCode', {
            modelId: 'opencode/beam-free',
            label: 'Beam Free',
        })).to.equal('OpenCode · Beam Free');
    });

    it('drops a model segment that repeats the agent name ignoring case', () => {
        expect(formatAgentPickerSelectedLabel('OpenCode', {
            modelId: 'opencode',
            label: 'opencode',
        })).to.equal('OpenCode');
    });
});

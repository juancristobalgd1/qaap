// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { TranscriptActivityNavigationItem } from '../common/qaap-transcript-activity-navigation';
import { resolveTranscriptExecutionNarrative, resolveTranscriptExecutionToolGroupParts } from './mobile-projects-transcript-timeline-utils';

describe('mobile transcript tool group labels', () => {

    it('labels agent test commands as commands, not Qaap verification checks', () => {
        const item: TranscriptActivityNavigationItem = {
            label: 'npm run test',
            state: 'success',
            timelineRole: 'toolGroup',
            toolKind: 'terminal',
            detail: 'npm run test',
            groupCount: 1,
        };
        const group = resolveTranscriptExecutionToolGroupParts(item);

        expect(group.verb).to.equal('Run');
        expect(group.detail).to.equal('1 command');
        expect(group.label).to.equal('1 command');
        expect(resolveTranscriptExecutionNarrative(item)).to.equal("I'm running the next command.");
    });
});

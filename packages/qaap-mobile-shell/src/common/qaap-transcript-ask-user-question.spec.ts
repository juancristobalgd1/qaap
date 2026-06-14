// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildAskUserQuestionUpdatedInput,
    isAskUserQuestionToolName,
} from './qaap-transcript-ask-user-question';

describe('qaap-transcript-ask-user-question', () => {
    it('detects AskUserQuestion tool names', () => {
        expect(isAskUserQuestionToolName('AskUserQuestion')).to.equal(true);
        expect(isAskUserQuestionToolName('ask_user_question')).to.equal(true);
        expect(isAskUserQuestionToolName('Bash')).to.equal(false);
    });

    it('merges a selection into tool args for stdio approval', () => {
        const args = JSON.stringify({
            questions: [{
                question: 'Which file?',
                header: 'Code source',
                options: [{ label: 'Paste now' }, { label: 'Branch files' }],
            }],
        });
        const updated = buildAskUserQuestionUpdatedInput(args, {
            questionId: 'q-0',
            questionText: 'Which file?',
            optionId: 'opt-0',
            optionLabel: 'Paste now',
        });
        expect(updated?.answers).to.deep.equal({ 'Which file?': 'Paste now' });
        expect(updated?.questions).to.be.an('array').with.length(1);
    });
});

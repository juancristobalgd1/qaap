// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    createQaapJobLoopTriggerDraft,
    qaapJobLoopTriggerToDraft,
    qaapJobLoopTriggerDraftToRequest,
    validateQaapJobLoopTriggerDraft,
} from './qaap-job-loop-management';

describe('QaapJobLoopManagement validation', () => {

    it('requires a template, title, and bounded integer interval', () => {
        const draft = createQaapJobLoopTriggerDraft();
        const validation = validateQaapJobLoopTriggerDraft({ ...draft, intervalMinutes: '4.5' });

        expect(validation.valid).to.equal(false);
        expect(validation.errors.template).to.not.equal(undefined);
        expect(validation.errors.title).to.not.equal(undefined);
        expect(validation.errors.interval).to.not.equal(undefined);
    });

    it('accepts a cron trigger and strips optional blank timezone values', () => {
        const draft = {
            ...createQaapJobLoopTriggerDraft('template-1'),
            title: 'Daily cleanup',
            type: 'cron' as const,
            cronExpression: '0 0 * * *',
            timezone: '   ',
            oneShot: true,
        };

        expect(validateQaapJobLoopTriggerDraft(draft).valid).to.equal(true);
        expect(qaapJobLoopTriggerDraftToRequest(draft)).to.deep.equal({
            templateId: 'template-1', title: 'Daily cleanup', type: 'cron',
            cronExpression: '0 0 * * *', timezone: undefined, oneShot: true,
        });
    });

    it('turns a persisted trigger into an editable, non-secret draft', () => {
        const draft = qaapJobLoopTriggerToDraft({
            id: 'trigger-1', ownerLogin: 'octocat', templateId: 'template-1', title: 'Every hour',
            type: 'interval', enabled: true, intervalMinutes: 60, createdAt: 1, updatedAt: 1,
        });

        expect(draft).to.deep.equal({
            templateId: 'template-1', title: 'Every hour', type: 'interval', intervalMinutes: '60',
            cronExpression: '', timezone: '', oneShot: false,
        });
    });

    it('rejects invalid cron expressions and timezones before calling the backend', () => {
        const validation = validateQaapJobLoopTriggerDraft({
            ...createQaapJobLoopTriggerDraft('template-1'),
            title: 'Broken cron',
            type: 'cron',
            cronExpression: 'not cron',
            timezone: 'Mars/Olympus',
        });

        expect(validation.valid).to.equal(false);
        expect(validation.errors.cron).to.not.equal(undefined);
        expect(validation.errors.timezone).to.not.equal(undefined);
    });

});

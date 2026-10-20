// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapPlanLimit, type QaapPlanLimitReason } from './qaap-plan-limit';

describe('QaapPlanLimit', () => {
    const reasons: QaapPlanLimitReason[] = ['repo_limit', 'hosted_model_denied', 'credits_exhausted', 'runtime_exhausted'];

    it('round-trips every reason through the log tag', () => {
        for (const reason of reasons) {
            const text = QaapPlanLimit.tagged(reason, 'Credits are used up.');
            expect(QaapPlanLimit.parse(text), reason).to.equal(reason);
            expect(QaapPlanLimit.strip(text)).to.equal('Credits are used up.');
        }
    });

    it('ignores unknown reasons and untagged text', () => {
        expect(QaapPlanLimit.parse('[qaap:plan_limit:something_else] x')).to.equal(undefined);
        expect(QaapPlanLimit.parse('quota exceeded')).to.equal(undefined);
        expect(QaapPlanLimit.parse(undefined)).to.equal(undefined);
    });

    it('only honours a tag at the very start (an agent echoing one mid-log cannot forge a paywall)', () => {
        expect(QaapPlanLimit.parse('thinking...\n[qaap:plan_limit:credits_exhausted] pay up')).to.equal(undefined);
        expect(QaapPlanLimit.parse('  [qaap:plan_limit:credits_exhausted] ok')).to.equal('credits_exhausted');
    });

    it('recognizes the new and legacy job error codes', () => {
        expect(QaapPlanLimit.isPlanLimitCode('plan_limit')).to.equal(true);
        expect(QaapPlanLimit.isPlanLimitCode('plan_repo_limit')).to.equal(true);
        expect(QaapPlanLimit.isPlanLimitCode('sign_in_required')).to.equal(false);
        expect(QaapPlanLimit.isPlanLimitCode(undefined)).to.equal(false);
    });

    it('picks Upgrade for plan boundaries and Top up for consumable ones', () => {
        expect(QaapPlanLimit.ctaLabel('repo_limit')).to.equal('Upgrade plan');
        expect(QaapPlanLimit.ctaLabel('hosted_model_denied')).to.equal('Upgrade plan');
        expect(QaapPlanLimit.ctaLabel('credits_exhausted')).to.equal('Top up');
        expect(QaapPlanLimit.ctaLabel('runtime_exhausted')).to.equal('Top up');
    });

    it('describes every reason without a plan name or raw code', () => {
        for (const reason of reasons) {
            const message = QaapPlanLimit.describe(reason);
            expect(message, reason).not.to.match(/starter|plan_|qaap:/i);
        }
    });
});

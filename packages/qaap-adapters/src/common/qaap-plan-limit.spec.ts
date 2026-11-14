// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapPlanLimit, type QaapPlanLimitReason } from './qaap-plan-limit';

describe('QaapPlanLimit', () => {
    const reasons: QaapPlanLimitReason[] = ['repo_limit', 'storage_limit'];

    it('round-trips every reason through the log tag', () => {
        for (const reason of reasons) {
            const text = QaapPlanLimit.tagged(reason, 'Limit reached.');
            expect(QaapPlanLimit.parse(text), reason).to.equal(reason);
            expect(QaapPlanLimit.strip(text)).to.equal('Limit reached.');
        }
    });

    it('ignores unknown reasons and untagged text', () => {
        expect(QaapPlanLimit.parse('[qaap:plan_limit:something_else] x')).to.equal(undefined);
        expect(QaapPlanLimit.parse('[qaap:plan_limit:credits_exhausted] x')).to.equal(undefined);
        expect(QaapPlanLimit.parse('[qaap:plan_limit:runtime_exhausted] x')).to.equal(undefined);
        expect(QaapPlanLimit.parse('[qaap:plan_limit:hosted_model_denied] x')).to.equal(undefined);
        expect(QaapPlanLimit.parse('quota exceeded')).to.equal(undefined);
        expect(QaapPlanLimit.parse(undefined)).to.equal(undefined);
    });

    it('only honours a tag at the very start (an agent echoing one mid-log cannot forge a paywall)', () => {
        expect(QaapPlanLimit.parse('thinking...\n[qaap:plan_limit:storage_limit] pay up')).to.equal(undefined);
        expect(QaapPlanLimit.parse('  [qaap:plan_limit:storage_limit] ok')).to.equal('storage_limit');
    });

    it('recognizes the new and legacy job error codes', () => {
        expect(QaapPlanLimit.isPlanLimitCode('plan_limit')).to.equal(true);
        expect(QaapPlanLimit.isPlanLimitCode('plan_repo_limit')).to.equal(true);
        expect(QaapPlanLimit.isPlanLimitCode('sign_in_required')).to.equal(false);
        expect(QaapPlanLimit.isPlanLimitCode(undefined)).to.equal(false);
    });

    it('offers Upgrade for every plan boundary', () => {
        expect(QaapPlanLimit.cta('repo_limit')).to.equal('upgrade');
        expect(QaapPlanLimit.ctaLabel('repo_limit')).to.equal('Upgrade plan');
        expect(QaapPlanLimit.ctaLabel('storage_limit')).to.equal('Upgrade plan');
    });

    it('describes the storage limit with the free-space or upgrade call to action', () => {
        expect(QaapPlanLimit.describe('storage_limit'))
            .to.equal('Your workspace is over its storage limit. Free some space or upgrade to Pro.');
    });

    it('describes every reason without a plan name or raw code', () => {
        for (const reason of reasons) {
            const message = QaapPlanLimit.describe(reason);
            expect(message, reason).not.to.match(/starter|plan_|qaap:/i);
        }
    });
});

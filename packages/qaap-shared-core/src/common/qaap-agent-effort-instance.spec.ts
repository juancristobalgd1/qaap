// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentEffort } from './qaap-agent-effort';

describe('QaapAgentEffort for harness instances', () => {

    it('gives a harness instance the effort levels of its base harness', () => {
        expect(QaapAgentEffort.support('codex#2', undefined)).to.deep.equal(QaapAgentEffort.support('codex', undefined));
        expect(QaapAgentEffort.support('claude#3', undefined)).to.deep.equal(QaapAgentEffort.support('claude', undefined));
        expect(QaapAgentEffort.normalize('codex#2', undefined, QaapAgentEffort.support('codex', undefined)?.defaultLevel))
            .to.equal(QaapAgentEffort.support('codex', undefined)?.defaultLevel);
    });

    it('leaves the base harness unchanged', () => {
        expect(QaapAgentEffort.support('codex', undefined)).to.not.equal(undefined);
        expect(QaapAgentEffort.support('no-such-harness', undefined)).to.equal(undefined);
    });
});

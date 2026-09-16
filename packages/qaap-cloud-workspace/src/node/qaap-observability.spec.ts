// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildQaapAuditFields,
    qaapCommandHash,
    redactQaapCommand,
    summarizeQaapAgentCommand,
} from './qaap-observability';

describe('QaapObservability', () => {

    it('redacts credential-shaped command values while preserving non-sensitive arguments', () => {
        const command = 'curl -H "Authorization: Bearer secret-token" --api-key=api-secret --retry 2';
        const redacted = redactQaapCommand(command);

        expect(redacted).to.include('curl');
        expect(redacted).to.include('--retry 2');
        expect(redacted).not.to.include('secret-token');
        expect(redacted).not.to.include('api-secret');
        expect(redacted).to.include('[REDACTED]');
    });

    it('keeps command hashes deterministic for audit correlation', () => {
        expect(qaapCommandHash('npm test')).to.equal(qaapCommandHash('npm test'));
        expect(qaapCommandHash('npm test')).not.to.equal(qaapCommandHash('npm run build'));
    });

    it('summarizes agent CLI commands without retaining the prompt tail', () => {
        const command = `qaiq --permission-mode default ${'user prompt '.repeat(100)}`;
        const preview = summarizeQaapAgentCommand(command);

        expect(preview).to.match(/^qaiq --permission-mode default/);
        expect(preview).not.to.include('user prompt');
        expect(preview.length).to.be.lessThan(321);
    });

    it('omits undefined fields so JSON audit records stay compact', () => {
        expect(buildQaapAuditFields({ event: 'quota.consumption', tenantLogin: 'alice', reason: undefined }))
            .to.deep.equal({ event: 'quota.consumption', tenantLogin: 'alice' });
    });
});

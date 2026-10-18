// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { redactQaapSecrets } from './qaap-secret-redaction';

describe('redactQaapSecrets', () => {

    it('redacts well-known token shapes and credential assignments', () => {
        const text = [
            'gh: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
            'pat: github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
            'openai: sk-proj-abcdefghijklmnopqrstuvwx',
            'aws: AKIAABCDEFGHIJKLMNOP',
            'slack: xoxb-1234567890-abcdefghij',
            'password = "hunter2"',
            'curl -H "Authorization: Bearer abc.def"',
            'git clone https://user:s3cret@github.com/o/r.git',
            '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
        ].join('\n');
        const redacted = redactQaapSecrets(text);
        for (const secret of ['ghp_abcdef', 'github_pat_11', 'sk-proj-abc', 'AKIAABCD', 'xoxb-123', 'hunter2', 'abc.def', 's3cret', 'MIIE']) {
            expect(redacted, secret).not.to.contain(secret);
        }
    });

    it('keeps ordinary text and line breaks', () => {
        expect(redactQaapSecrets('### Summary\n\nAdded the token field to the form.')).to.equal('### Summary\n\nAdded the token field to the form.');
    });
});

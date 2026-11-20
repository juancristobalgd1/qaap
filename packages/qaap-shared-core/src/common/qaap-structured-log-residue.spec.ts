// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { parseAgentLogForTranscript } from './qaap-cli-transcript-stream';
import { structuredLogResidueText } from './qaap-structured-log-residue';

describe('structured agent log without reply text', () => {
    // A Pi turn that failed at the provider: events only, no assistant text.
    const failedPiLog = [
        '(node:16) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.',
        '(Use `node --trace-warnings ...` to show where the warning was created)',
        '{"type":"session","version":3,"id":"01a1","cwd":"/workspace/repos/users/u/app"}',
        '{"type":"agent_start"}',
        '{"type":"turn_start"}',
        '{"type":"message_start","message":{"role":"system","content":"","sections":{"preamble":"You are an expert coding assistant"}}}',
        '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"401 Unauthorized"}}',
        '{"type":"turn_end"}',
    ].join('\n') + '\n';

    it('never shows the raw Pi event stream as the reply', () => {
        const parsed = parseAgentLogForTranscript('pi', failedPiLog);
        expect(parsed.content).to.equal('');
        expect(parsed.content).to.not.include('"type"');
    });

    it('keeps plain lines the CLI printed around its events', () => {
        expect(structuredLogResidueText(`${failedPiLog}\nError: provider rejected the request`))
            .to.equal('Error: provider rejected the request');
    });

    it('drops a record cut mid-line', () => {
        expect(structuredLogResidueText('{"type":"message_update","assistantMessageEvent":{"type":"text_del')).to.equal('');
    });

    it('still returns the reply text of a normal Pi turn', () => {
        const log = [
            '{"type":"session","version":3,"id":"01a1"}',
            '{"type":"message_start","message":{"role":"assistant","content":[]}}',
            '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Listo."}]}}',
        ].join('\n') + '\n';
        expect(parseAgentLogForTranscript('pi', log).content).to.equal('Listo.');
    });
});

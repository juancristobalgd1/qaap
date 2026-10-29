// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
    buildGoldenScenarios,
    GOLDEN_CALLS,
    GOLDEN_CWD,
    GOLDEN_RESERVED_PORT,
    goldenCheckPathsInsideCwd,
    packGoldenRecords,
    type QaapToolGoldenPacked,
    type QaapToolGoldenRecord,
} from './test/qaap-tool-gate-golden-corpus';
import { QaapToolGateService } from './qaap-tool-gate-service';
import { resolveQaiqControlRequestAutoAction } from '../common/qaap-qaiq-control-auto-response';

/**
 * Golden corpus: `test-resources/qaap-tool-gate-golden.json` was recorded from the QAIQ stdio decision
 * code as it stood inline in the task runner BEFORE it moved into QaapToolGateService (P0-1). The
 * service must reproduce every decision, message and approval side-effect flag exactly.
 */
describe('qaap-tool-gate-service golden corpus', () => {

    const service = new QaapToolGateService();
    const fixture: QaapToolGoldenPacked = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '../../test-resources/qaap-tool-gate-golden.json'), 'utf8'));

    const evaluateAll = (): QaapToolGoldenRecord[] => {
        const records: QaapToolGoldenRecord[] = [];
        for (const scenario of buildGoldenScenarios()) {
            GOLDEN_CALLS.forEach((request, call) => {
                const outcome = service.evaluateQaiqControlRequest({
                    command: scenario.command,
                    autoApprove: scenario.autoApprove,
                    request,
                    cwd: GOLDEN_CWD,
                    options: {
                        autoApproveReadOnlyShell: scenario.autoApproveReadOnlyShell,
                        cwd: GOLDEN_CWD,
                        checkGitExecConfig: () => scenario.gitRisk,
                        checkPathsInsideCwd: goldenCheckPathsInsideCwd,
                    },
                    reservedPort: () => GOLDEN_RESERVED_PORT,
                });
                const { reservedPort: _reservedPort, ...rest } = outcome;
                records.push({
                    scenario: scenario.id,
                    call,
                    outcome: {
                        ...rest,
                        hookAllowBlocked: service.isHookAllowBlocked(scenario.command, scenario.autoApprove, request, GOLDEN_CWD),
                    },
                });
            });
        }
        return records;
    };

    it('covers at least 60 tool calls across policies, read-only workspace and read-only shell preference', () => {
        expect(GOLDEN_CALLS.length).to.be.at.least(60);
        expect(buildGoldenScenarios().length).to.be.at.least(3 * 2);
        expect(fixture.records.length).to.equal(GOLDEN_CALLS.length * buildGoldenScenarios().length);
    });

    it('reproduces every recorded decision and side-effect flag', () => {
        const packed = packGoldenRecords(evaluateAll());
        expect(packed.strings).to.deep.equal(fixture.strings);
        expect(packed.records.length).to.equal(fixture.records.length);
        packed.records.forEach((record, index) => {
            expect(record, `${record.s} call #${record.c}`).to.deep.equal(fixture.records[index]);
        });
    });

    it('keeps hook-allow vetoes aligned with the auto-action deny rules', () => {
        const scenario = buildGoldenScenarios()[0];
        for (const request of GOLDEN_CALLS) {
            if (resolveQaiqControlRequestAutoAction(scenario.command, scenario.autoApprove, request) === 'deny') {
                expect(service.isHookAllowBlocked(scenario.command, scenario.autoApprove, request, GOLDEN_CWD)).to.equal(true);
            }
        }
    });
});

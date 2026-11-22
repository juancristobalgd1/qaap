// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { GOLDEN_FIXTURE_DIR, GOLDEN_SUITES } from './qaap-harness-golden-support';

/**
 * Equivalence of the harness adapters with the pre-F0 runner: the fixtures were captured from master before
 * any branch by agent id moved behind `QaapHarnessAdapter`. A diff here is a behaviour change, not a stale fixture.
 */
describe('harness contract golden equivalence (F0)', function (): void {
    this.timeout(180_000);

    for (const suite of GOLDEN_SUITES) {
        it(`${suite.name} matches the pre-adapter fixtures`, () => {
            const fixture = path.join(GOLDEN_FIXTURE_DIR, `${suite.name}.json`);
            const actual = JSON.parse(JSON.stringify(suite.capture(), (_key, value) => value === undefined ? null : value)) as Record<string, unknown>;
            if (process.env.QAAP_HARNESS_GOLDEN_UPDATE === '1') {
                fs.mkdirSync(GOLDEN_FIXTURE_DIR, { recursive: true });
                fs.writeFileSync(fixture, `${JSON.stringify(actual, undefined, 2)}\n`);
                return;
            }
            expect(fs.existsSync(fixture), `missing fixture ${fixture}`).to.equal(true);
            const expected = JSON.parse(fs.readFileSync(fixture, 'utf8')) as Record<string, unknown>;
            expect(Object.keys(actual).sort()).to.deep.equal(Object.keys(expected).sort());
            for (const key of Object.keys(expected)) {
                expect(actual[key], `${suite.name}: ${key}`).to.deep.equal(expected[key]);
            }
        });
    }
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { countAddedCheckSuppressions, detectCheckSuppression } from './qaap-check-suppression';

describe('detectCheckSuppression', () => {
    it('flags eslint disable comments in every form', () => {
        expect(detectCheckSuppression('// eslint-disable-next-line react-hooks/exhaustive-deps', 'src/App.tsx')).to.equal('eslint-disable');
        expect(detectCheckSuppression('/* eslint-disable */', 'src/App.tsx')).to.equal('eslint-disable');
        expect(detectCheckSuppression('    const x = y; // eslint-disable-line no-unused-vars', 'a.js')).to.equal('eslint-disable');
        expect(detectCheckSuppression('{/* eslint-disable-next-line jsx-a11y/alt-text */}', 'a.jsx')).to.equal('eslint-disable');
        expect(detectCheckSuppression('/* eslint no-console: "off" */', 'a.js')).to.equal('eslint-disable');
    });

    it('flags TypeScript suppressions', () => {
        expect(detectCheckSuppression('// @ts-ignore', 'a.ts')).to.equal('ts-ignore');
        expect(detectCheckSuppression('  // @ts-expect-error: legacy typing', 'a.ts')).to.equal('ts-expect-error');
        expect(detectCheckSuppression('// @ts-nocheck', 'a.ts')).to.equal('ts-nocheck');
        expect(detectCheckSuppression(' * @ts-ignore', 'a.ts')).to.equal('ts-ignore');
    });

    it('flags other linters and skipped or focused tests', () => {
        expect(detectCheckSuppression('import os  # noqa: F401', 'a.py')).to.equal('lint-ignore');
        expect(detectCheckSuppression('x = f()  # type: ignore', 'a.py')).to.equal('lint-ignore');
        expect(detectCheckSuppression('/* istanbul ignore next */', 'a.ts')).to.equal('lint-ignore');
        expect(detectCheckSuppression('it.skip(\'renders\', () => {', 'a.spec.ts')).to.equal('skipped-test');
        expect(detectCheckSuppression('describe.only(\'suite\', () => {', 'a.spec.ts')).to.equal('skipped-test');
        expect(detectCheckSuppression('xit(\'renders\', () => {', 'a.spec.ts')).to.equal('skipped-test');
    });

    it('flags loosened lint and tsconfig settings only in those config files', () => {
        expect(detectCheckSuppression('    "no-unused-vars": "off",', '.eslintrc.json')).to.equal('config-loosened');
        expect(detectCheckSuppression('      \'react-hooks/exhaustive-deps\': \'off\',', 'eslint.config.mjs')).to.equal('config-loosened');
        expect(detectCheckSuppression('    "strict": false,', 'tsconfig.json')).to.equal('config-loosened');
        expect(detectCheckSuppression('    "skipLibCheck": true', 'packages/app/tsconfig.build.json')).to.equal('config-loosened');
        expect(detectCheckSuppression('    "strict": false,', 'src/settings.json')).to.equal(undefined);
        expect(detectCheckSuppression('    "strict": true,', 'tsconfig.json')).to.equal(undefined);
    });

    it('ignores ordinary code, string mentions and documentation', () => {
        expect(detectCheckSuppression('const total = items.length;', 'a.ts')).to.equal(undefined);
        expect(detectCheckSuppression('\'Never add eslint-disable or @ts-ignore\',', 'prompt.ts')).to.equal(undefined);
        expect(detectCheckSuppression('Avoid `// eslint-disable` in components.', 'CONTRIBUTING.md')).to.equal(undefined);
        expect(detectCheckSuppression('model.fit(data)', 'train.ts')).to.equal(undefined);
        expect(detectCheckSuppression('   ', 'a.ts')).to.equal(undefined);
    });
});

describe('countAddedCheckSuppressions', () => {
    it('counts only added lines', () => {
        const hunks = [{
            lines: [
                { type: 'ctx', text: '// eslint-disable-next-line' },
                { type: 'del', text: '// @ts-ignore' },
                { type: 'add', text: '// @ts-ignore' },
                { type: 'add', text: 'foo(); // eslint-disable-line' },
                { type: 'add', text: 'bar();' },
            ],
        }];
        expect(countAddedCheckSuppressions(hunks, 'src/a.ts')).to.equal(2);
        expect(countAddedCheckSuppressions([], 'src/a.ts')).to.equal(0);
    });
});

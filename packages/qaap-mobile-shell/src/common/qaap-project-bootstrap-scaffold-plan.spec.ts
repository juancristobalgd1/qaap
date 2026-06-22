// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    enrichBootstrapDevRunError,
    formatMissingBootstrapProjectHint,
    resolveBootstrapDevTarget,
    resolveBootstrapInstallTarget,
} from './qaap-project-bootstrap-scaffold-plan';

describe('qaap-project-bootstrap-scaffold-plan', () => {

    it('formatMissingBootstrapProjectHint explains orphan scaffolds', () => {
        expect(formatMissingBootstrapProjectHint([])).to.include('Run/preview failed');
        expect(formatMissingBootstrapProjectHint(['rioja-wines-landing-page'])).to.include('rioja-wines-landing-page');
    });

    it('resolveBootstrapInstallTarget uses the child folder for orphan scaffolds', () => {
        const plan = resolveBootstrapInstallTarget(
            { rootKey: '/ws', installCommand: 'npm install' },
            undefined,
            { rootKey: '/ws/rioja-wines-landing-page', devCommand: 'npm run dev' },
        );
        expect(plan.cwdKey).to.equal('/ws/rioja-wines-landing-page');
    });

    it('resolveBootstrapDevTarget runs orphan apps from their folder', () => {
        const plan = resolveBootstrapDevTarget(
            { rootKey: '/ws', installCommand: 'npm install', packageManager: 'npm' },
            undefined,
            { rootKey: '/ws/rioja-wines-landing-page', devCommand: 'npm run dev', kind: 'node-vite', expectedPort: 5173 },
        );
        expect(plan?.cwdKey).to.equal('/ws/rioja-wines-landing-page');
        expect(plan?.command).to.equal('npm run dev');
    });

    it('enrichBootstrapDevRunError mentions the preview root on package.json errors', () => {
        const enriched = enrichBootstrapDevRunError(
            'npm ERR! enoent Could not read package.json',
            'rioja-wines-landing-page',
        );
        expect(enriched).to.include('rioja-wines-landing-page');
    });
});

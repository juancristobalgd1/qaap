// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { deriveVisualFlowSteps, routeFromEditedFile, routesMentionedInText } from './qaap-visual-flow-plan';

describe('routeFromEditedFile', () => {
    it('maps the common framework route-file conventions', () => {
        expect(routeFromEditedFile('src/pages/checkout.tsx')).to.equal('/checkout');
        expect(routeFromEditedFile('pages/checkout/index.tsx')).to.equal('/checkout');
        expect(routeFromEditedFile('src/pages/index.astro')).to.equal('/');
        expect(routeFromEditedFile('app/dashboard/page.tsx')).to.equal('/dashboard');
        expect(routeFromEditedFile('src/app/page.tsx')).to.equal('/');
        expect(routeFromEditedFile('src/routes/settings/+page.svelte')).to.equal('/settings');
        expect(routeFromEditedFile('src/routes/+page.svelte')).to.equal('/');
        expect(routeFromEditedFile('app/routes/pricing.tsx')).to.equal('/pricing');
        expect(routeFromEditedFile('app/routes/_index.tsx')).to.equal('/');
    });

    it('ignores non-page files and non-navigable segments', () => {
        expect(routeFromEditedFile('app/components/button.tsx')).to.equal(undefined);
        expect(routeFromEditedFile('app/dashboard/layout.tsx')).to.equal(undefined);
        expect(routeFromEditedFile('src/pages/api/users.ts')).to.equal(undefined);
        expect(routeFromEditedFile('app/blog/[slug]/page.tsx')).to.equal(undefined);
        expect(routeFromEditedFile('src/routes/(admin)/tools/+page.svelte')).to.equal(undefined);
        expect(routeFromEditedFile('src/index.css')).to.equal(undefined);
    });
});

describe('routesMentionedInText', () => {
    it('extracts short absolute routes from prose', () => {
        expect(routesMentionedInText('I updated the styles on /checkout and the `/pricing` page.'))
            .to.deep.equal(['/checkout', '/pricing']);
    });

    it('ignores filesystem paths, API routes, and deep paths', () => {
        expect(routesMentionedInText('Edited /src/pages/checkout.tsx, called /api/users, saved to /workspace/repos/users/x'))
            .to.deep.equal([]);
        expect(routesMentionedInText('see /a/b/c/d')).to.deep.equal([]);
    });
});

describe('deriveVisualFlowSteps', () => {
    it('always starts at the root and dedupes', () => {
        expect(deriveVisualFlowSteps({ messages: [] })).to.deep.equal(['/']);
        expect(deriveVisualFlowSteps({
            messages: [
                { role: 'user', content: 'Fix the home page /' },
                { role: 'agent', content: 'Done — check / again.' },
            ],
        })).to.deep.equal(['/']);
    });

    it('walks routes from edited route files before routes mentioned in prose', () => {
        const steps = deriveVisualFlowSteps({
            messages: [
                { role: 'user', content: 'Restyle /pricing and the checkout flow' },
                {
                    role: 'agent',
                    content: 'Updated the checkout page.',
                    segments: [
                        { type: 'tool', name: 'Edit', args: '{"file_path":"/repo/src/pages/checkout.tsx"}' },
                        { type: 'tool', name: 'Bash', args: 'ls src/pages/other.tsx' },
                    ],
                },
            ],
        });
        expect(steps).to.deep.equal(['/', '/checkout', '/pricing']);
    });

    it('caps the walk at three steps', () => {
        const steps = deriveVisualFlowSteps({
            messages: [
                { role: 'user', content: 'Polish /a and /b and /c please' },
                { role: 'agent', content: 'Done.' },
            ],
        });
        expect(steps).to.have.length(3);
        expect(steps[0]).to.equal('/');
    });
});

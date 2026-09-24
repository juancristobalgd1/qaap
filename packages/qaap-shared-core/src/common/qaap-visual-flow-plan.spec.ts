// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { deriveVisualFlowSteps, routeFromEditedFile } from './qaap-visual-flow-plan';

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

describe('deriveVisualFlowSteps', () => {
    it('always starts at the root and dedupes', () => {
        expect(deriveVisualFlowSteps({ messages: [] })).to.deep.equal(['/']);
        expect(deriveVisualFlowSteps({
            messages: [
                { role: 'user', content: 'Fix the home page /' },
                { role: 'agent', content: 'Done — check / again.\n[QAAP capture: /]' },
            ],
        })).to.deep.equal(['/']);
    });

    it('walks the routes the agent declared in its capture directive first', () => {
        const steps = deriveVisualFlowSteps({
            messages: [
                { role: 'user', content: 'Restyle the pricing page' },
                {
                    role: 'agent',
                    content: 'Updated pricing.\n\n[QAAP capture: /pricing /checkout]',
                    segments: [
                        { type: 'tool', name: 'Edit', args: '{"file_path":"/repo/src/pages/about.tsx"}' },
                    ],
                },
            ],
        });
        expect(steps).to.deep.equal(['/', '/pricing', '/checkout']);
    });

    it('falls back to routes from edited route files without a directive', () => {
        const steps = deriveVisualFlowSteps({
            messages: [
                { role: 'user', content: 'Restyle the checkout flow' },
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
        expect(steps).to.deep.equal(['/', '/checkout']);
    });
});

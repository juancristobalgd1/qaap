// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

const sourceRoot = path.resolve(__dirname, '../../src');
const read = (relativePath: string): string => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');

describe('Qaap login gate accessibility contract', () => {

    it('keeps the TypeScript gate labelled and announces async status', () => {
        const source = read('browser/qaap-login-gate.ts');
        expect(source).to.include("host.setAttribute('aria-labelledby', 'qaap-login-title')");
        expect(source).to.include("host.setAttribute('aria-describedby', 'qaap-login-description')");
        expect(source).to.include('aria-live="polite"');
        expect(source).to.include('href="/legal/terms.html"');
        expect(source).to.include('href="/legal/privacy.html"');
        expect(source).to.include('id="qaap-login-local"');
        expect(source).to.include('id="qaap-login-retry"');
        expect(source).to.include("host.querySelectorAll<HTMLElement>(");
        expect(source).to.not.include("githubButton.addEventListener('keydown'");
        expect(source).to.not.include('data-qaap-link');
    });

    it('keeps the pre-bundle gate in sync with the accessible contract', () => {
        const source = fs.readFileSync(path.resolve(sourceRoot, '../../qaap-product/resources/qaap-login-gate.js'), 'utf8');
        expect(source).to.include("host.setAttribute('aria-labelledby', 'qaap-login-title')");
        expect(source).to.include("host.setAttribute('aria-describedby', 'qaap-login-description')");
        expect(source).to.include('aria-live="polite"');
        expect(source).to.include("prefers-reduced-motion:reduce");
        expect(source).to.include("button.setAttribute('aria-busy', 'true')");
        expect(source).to.include('href="/legal/terms.html"');
        expect(source).to.include('href="/legal/privacy.html"');
        expect(source).to.include('id="qaap-login-local"');
        expect(source).to.include('id="qaap-login-retry"');
        expect(source).to.include('.qaap-login-footer a:focus-visible');
        expect(source).to.include('cursor:not-allowed');
        expect(source).to.include('.qaap-login-btn[aria-busy="true"]{cursor:wait}');
        expect(source).to.include('var AUTH_CONFIG_TIMEOUT_MS = 4000');
        expect(source).to.include('var AUTH_SESSION_TIMEOUT_MS = 6000');
        expect(source).to.include('function showGateAndLoadBundle()');
        expect(source).to.include('if (skipped === false)');
        expect(source).to.include('return undefined;');
        expect(source).to.not.include('.qaap-login-btn:disabled{opacity:.85;cursor:wait}');
    });

    it('provides a visible focus ring, touch handling and reduced motion in the bundled CSS', () => {
        const css = read('browser/style/qaap-login.css');
        expect(css).to.include('.qaap-login-btn:focus-visible');
        expect(css).to.include('.qaap-login-footer a:focus-visible');
        expect(css).to.include('touch-action: manipulation');
        expect(css).to.include('@media (prefers-reduced-motion: reduce)');
        expect(css).to.not.include('transition: all');
        expect(css).to.include('cursor: not-allowed');
        expect(css).to.match(/\.qaap-login-btn\[aria-busy="true"\][\s\S]*cursor:\s*wait/);
    });

    it('does not advertise GitLab OAuth that is not implemented', () => {
        const view = read('browser/qaap-login-view.tsx');
        const gate = fs.readFileSync(path.resolve(sourceRoot, '../../qaap-product/resources/qaap-login-gate.js'), 'utf8');
        expect(view).to.not.include('qaap-login-gitlab');
        expect(view).to.not.include('Continue with GitLab');
        expect(gate).to.not.include('qaap-login-gitlab');
        expect(gate).to.not.include('GITLAB_SVG');
    });
});

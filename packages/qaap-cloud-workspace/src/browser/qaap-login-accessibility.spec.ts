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
        expect(source).to.include("host.querySelectorAll<HTMLElement>(");
        expect(source).to.not.include("githubButton.addEventListener('keydown'");
    });

    it('keeps the pre-bundle gate in sync with the accessible contract', () => {
        const source = fs.readFileSync(path.resolve(sourceRoot, '../../qaap-product/resources/qaap-login-gate.js'), 'utf8');
        expect(source).to.include("host.setAttribute('aria-labelledby', 'qaap-login-title')");
        expect(source).to.include("host.setAttribute('aria-describedby', 'qaap-login-description')");
        expect(source).to.include('aria-live="polite"');
        expect(source).to.include("prefers-reduced-motion:reduce");
        expect(source).to.include("button.setAttribute('aria-busy', 'true')");
    });

    it('provides a visible focus ring, touch handling and reduced motion in the bundled CSS', () => {
        const css = read('browser/style/qaap-login.css');
        expect(css).to.include('.qaap-login-btn:focus-visible');
        expect(css).to.include('touch-action: manipulation');
        expect(css).to.include('@media (prefers-reduced-motion: reduce)');
        expect(css).to.not.include('transition: all');
    });
});

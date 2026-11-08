// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('Work Hub motion stylesheet', () => {
    const styleDir = path.join(__dirname, '..', '..', 'src', 'browser', 'style');
    const css = fs.readFileSync(path.join(styleDir, 'qaap-work-hub-motion.css'), 'utf8');
    const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)];

    it('animates only compositor properties (opacity and transform)', () => {
        expect(keyframes.length).to.be.greaterThan(0);
        for (const [, name, body] of keyframes) {
            const properties = [...body.matchAll(/([\w-]+)\s*:/g)].map(match => match[1]);
            expect(properties, name).to.not.be.empty;
            for (const property of properties) {
                expect(['opacity', 'transform'], `${name} animates ${property}`).to.include(property);
            }
        }
    });

    it('keeps entrance animations from overriding inline transforms once they finish', () => {
        const animations = [...css.matchAll(/animation:\s*(qaap-work-hub-[\w-]+)[^;]*;/g)];
        expect(animations.length).to.be.greaterThan(0);
        for (const [declaration] of animations) {
            expect(declaration).to.match(/\bbackwards;$/);
        }
    });

    it('never transitions layout properties on the controls it touches', () => {
        for (const [, list] of css.matchAll(/transition:\s*([^;]+);/g)) {
            expect(list).to.not.match(/\b(width|height|top|left|margin|padding|all)\b/);
        }
    });

    it('turns animations and press scaling off under prefers-reduced-motion', () => {
        const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
        expect(reduced).to.match(/animation:\s*none;/);
        expect(reduced).to.match(/scale:\s*none;/);
    });

    it('uses theme variables, not literal colours', () => {
        expect(css).to.not.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    });

    it('is imported after every other Work Hub stylesheet so it layers over them', () => {
        const module = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'browser', 'qaap-work-hub-frontend-module.ts'), 'utf8');
        const imports = [...module.matchAll(/^import '([^']+\.css)';$/gm)].map(match => match[1]);
        expect(imports[imports.length - 1]).to.equal('../../src/browser/style/qaap-work-hub-motion.css');
    });
});

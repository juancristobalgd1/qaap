// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    normalizeAntigravityCliBin,
    resolveAntigravityCliBin,
    resolveAntigravityCliTemplate,
} from './qaap-antigravity-cli';

describe('resolveAntigravityCliBin', () => {
    it('prefers gemini, then agy, then the community antigravity CLI', () => {
        expect(resolveAntigravityCliBin(() => true)).to.equal('gemini');
        expect(resolveAntigravityCliBin(bin => bin !== 'gemini')).to.equal('agy');
        expect(resolveAntigravityCliBin(bin => bin === 'antigravity')).to.equal('antigravity');
    });

    it('returns undefined when no Antigravity CLI is on PATH', () => {
        expect(resolveAntigravityCliBin(() => false)).to.equal(undefined);
    });
});

describe('normalizeAntigravityCliBin', () => {
    it('accepts only the known Antigravity binaries, trimmed', () => {
        expect(normalizeAntigravityCliBin(' agy ')).to.equal('agy');
        expect(normalizeAntigravityCliBin('gemini')).to.equal('gemini');
        expect(normalizeAntigravityCliBin('codex')).to.equal(undefined);
        expect(normalizeAntigravityCliBin('')).to.equal(undefined);
        expect(normalizeAntigravityCliBin(undefined)).to.equal(undefined);
    });
});

describe('resolveAntigravityCliTemplate', () => {
    it('runs gemini headless with its model flag placeholder', () => {
        expect(resolveAntigravityCliTemplate('gemini')).to.equal('gemini --approval-mode=yolo {model_flags} -p {prompt}');
    });

    it('runs agy and the community CLI with -p and no model flag', () => {
        expect(resolveAntigravityCliTemplate('agy')).to.equal('agy -p {prompt}');
        expect(resolveAntigravityCliTemplate('antigravity')).to.equal('antigravity -p {prompt}');
    });
});

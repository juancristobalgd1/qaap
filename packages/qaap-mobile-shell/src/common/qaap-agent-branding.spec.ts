// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    normalizeAgentBrandId,
    resolveAgentBrand,
} from './qaap-agent-branding';
import { QAIQ_AGENT_ID, THEIA_CODER_AGENT_ID } from './qaap-agent-task-client';

describe('qaap-agent-branding', () => {

    it('normalizeAgentBrandId maps aliases and legacy ids', () => {
        expect(normalizeAgentBrandId('cursor-agent')).to.equal('cursor');
        expect(normalizeAgentBrandId('openclaude')).to.equal(QAIQ_AGENT_ID);
        expect(normalizeAgentBrandId(THEIA_CODER_AGENT_ID)).to.equal('coder');
        expect(normalizeAgentBrandId('  Antigravity  ')).to.equal('antigravity');
        expect(normalizeAgentBrandId('  Gemini  ')).to.equal('antigravity');
        expect(normalizeAgentBrandId('grok-build')).to.equal('grok');
    });

    it('resolveAgentBrand returns svg brands for built-in agents', () => {
        expect(resolveAgentBrand('openclaw')?.label).to.equal('OpenClaw');
        expect(resolveAgentBrand('openclaw')?.svg).to.include('<svg');
        expect(resolveAgentBrand('antigravity')?.tone).to.equal('light');
        expect(resolveAgentBrand('codex')?.tone).to.equal('dark');
        expect(resolveAgentBrand('qwen')?.label).to.equal('Qwen Code');
    });

    it('resolveAgentBrand uses light/dark Grok Build mark variants', () => {
        const brand = resolveAgentBrand('grok');
        expect(brand?.label).to.equal('Grok Build');
        expect(brand?.tone).to.equal('light');
        expect(brand?.svgLight).to.include('data:image/png;base64,');
        expect(brand?.svgDark).to.include('data:image/png;base64,');
        expect(brand?.svgLight).to.not.equal(brand?.svgDark);
    });

    it('resolveAgentBrand uniquifies antigravity mask ids across calls', () => {
        const first = resolveAgentBrand('antigravity')?.svg ?? '';
        const second = resolveAgentBrand('antigravity')?.svg ?? '';
        expect(first).to.not.equal(second);
        expect(first).to.include('antigravity__mask0_111_52-');
        expect(second).to.include('antigravity__mask0_111_52-');
    });

    it('resolveAgentBrand uniquifies the openclaw lobster gradient across calls', () => {
        const first = resolveAgentBrand('openclaw')?.svg ?? '';
        const second = resolveAgentBrand('openclaw')?.svg ?? '';
        expect(first).to.not.equal(second);
        // The suffix must land on both the definition and every url(#...) reference,
        // otherwise the fill silently falls back to none.
        for (const svg of [first, second]) {
            const defined = svg.match(/\bid="([^"]+)"/g) ?? [];
            expect(defined).to.have.lengthOf(1);
            const gradientId = /\bid="([^"]+)"/.exec(svg)?.[1] ?? '';
            expect(gradientId).to.match(/^openclaw__lobster-gradient-\d+$/);
            expect(svg.split(`url(#${gradientId})`)).to.have.lengthOf(4);
            expect(svg).to.not.include('url(#openclaw__lobster-gradient)');
        }
    });

    it('every built-in brand mark uses a distinct svg', () => {
        const ids = [
            QAIQ_AGENT_ID, 'codex', 'claude', 'grok', 'opencode', 'goose', 'hermes',
            'openclaw', 'cursor', 'antigravity', 'copilot', 'qwen', 'kimi', 'coder',
        ];
        const seen = new Map<string, string>();
        for (const id of ids) {
            const svg = resolveAgentBrand(id)?.svg ?? '';
            expect(svg, `${id} has no svg`).to.include('<svg');
            // Strip the uniquify suffix so two genuinely different marks are not
            // reported as distinct purely because their generated ids differ.
            const shape = svg.replace(/-(\d+)(?=["))])/g, '');
            const clash = seen.get(shape);
            expect(clash, `${id} renders the same mark as ${clash}`).to.equal(undefined);
            seen.set(shape, id);
        }
    });

    it('resolveAgentBrand returns undefined for unknown ids', () => {
        expect(resolveAgentBrand('unknown-agent')).to.equal(undefined);
        expect(resolveAgentBrand(undefined)).to.equal(undefined);
    });
});

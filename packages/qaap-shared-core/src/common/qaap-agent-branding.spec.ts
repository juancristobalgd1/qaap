// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    normalizeAgentBrandId,
    resolveAgentBrand,
} from './qaap-agent-branding';
import { OPENCLAUDE_AGENT_ID, QAIQ_AGENT_ID, THEIA_CODER_AGENT_ID } from './qaap-agent-task-client';

describe('qaap-agent-branding', () => {

    it('normalizeAgentBrandId maps aliases and distinct agent ids', () => {
        expect(normalizeAgentBrandId('cursor-agent')).to.equal('cursor');
        expect(normalizeAgentBrandId('openclaude')).to.equal(OPENCLAUDE_AGENT_ID);
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
        expect(resolveAgentBrand(OPENCLAUDE_AGENT_ID)?.label).to.equal('OpenClaude');
    });

    it('resolveAgentBrand uses light/dark Grok Build mark variants', () => {
        const brand = resolveAgentBrand('grok');
        expect(brand?.label).to.equal('Grok Build');
        expect(brand?.tone).to.equal('light');
        expect(brand?.svgLight).to.include('data:image/png;base64,');
        expect(brand?.svgDark).to.include('data:image/png;base64,');
        expect(brand?.svgLight).to.not.equal(brand?.svgDark);
    });

    it('resolveAgentBrand uses the QAIQ terminal mark and uniquifies its gradients', () => {
        const first = resolveAgentBrand(QAIQ_AGENT_ID);
        const second = resolveAgentBrand(QAIQ_AGENT_ID);
        expect(first?.label).to.equal('QAIQ');
        expect(first?.tone).to.equal('dark');
        expect(first?.svg).to.not.equal(second?.svg);
        for (const svg of [first?.svg ?? '', second?.svg ?? '']) {
            const gradientIds = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
            expect(gradientIds).to.have.lengthOf(4);
            expect(gradientIds.every(id => /^qaiq__[\w-]+-gradient-\d+$/.test(id))).to.equal(true);
            for (const id of gradientIds) {
                expect(svg).to.include(`url(#${id})`);
            }
            expect(svg).to.include('stroke="#47E1E0"');
            expect(svg).to.not.include('<style');
        }
    });

    it('resolveAgentBrand serves theme-adaptive monochrome marks for copilot and hermes', () => {
        for (const id of ['copilot', 'hermes']) {
            const brand = resolveAgentBrand(id);
            // Transparent tone so the glyph sits on the theme surface, not on a plate.
            expect(brand?.tone, `${id} tone`).to.equal('light');
            expect(brand?.svgLight, `${id} svgLight`).to.be.a('string');
            expect(brand?.svgDark, `${id} svgDark`).to.be.a('string');
            expect(brand?.svgLight).to.not.equal(brand?.svgDark);
            // currentColor would let ambient colour bleed in; each variant is a fixed fill.
            expect(brand?.svgLight).to.not.include('currentColor');
            expect(brand?.svgDark).to.not.include('currentColor');
            // Dark glyph for the light theme, white glyph for the dark theme.
            expect(brand?.svgLight?.toLowerCase()).to.include('#1f2328');
            expect(brand?.svgDark?.toLowerCase()).to.include('#ffffff');
        }
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
            QAIQ_AGENT_ID, OPENCLAUDE_AGENT_ID, 'codex', 'claude', 'grok', 'opencode', 'goose', 'hermes',
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

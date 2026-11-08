// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { UsageChartPathBuilder, UsageChartPoint } from './usage-chart-path';

describe('UsageChartPathBuilder', () => {

    const builder = new UsageChartPathBuilder();

    /** Parses the end point of every cubic segment of a path with C commands. */
    function curveEndpoints(path: string): number[][] {
        const segments = path.split(' C').slice(1);
        return segments.map(segment => segment.trim().split(' ').slice(4, 6).map(Number));
    }

    it('returns empty strings for empty or single-point input', () => {
        expect(builder.linePath([])).to.equal('');
        expect(builder.linePath([{ x: 0, y: 0 }])).to.equal('M0 0');
        expect(builder.areaPath([{ x: 0, y: 0 }], [{ x: 0, y: 1 }])).to.equal('');
    });

    it('emits one cubic segment per gap between points', () => {
        const points: UsageChartPoint[] = [{ x: 0, y: 10 }, { x: 10, y: 20 }, { x: 20, y: 5 }, { x: 30, y: 8 }];
        const path = builder.linePath(points);
        expect(path.startsWith('M0 10')).to.equal(true);
        expect(path.split(' C').length - 1).to.equal(points.length - 1);
        expect(curveEndpoints(path)).to.deep.equal([[10, 20], [20, 5], [30, 8]]);
    });

    it('does not overshoot between a local minimum and its neighbours', () => {
        // The middle point is a valley. Control points must not dip below it nor rise above the neighbours.
        const points: UsageChartPoint[] = [{ x: 0, y: 0 }, { x: 10, y: 100 }, { x: 20, y: 0 }, { x: 30, y: 100 }];
        const path = builder.linePath(points);
        const numbers = path.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number);
        const ys = numbers.filter((_, index) => index % 2 === 1);
        for (const y of ys) {
            expect(y).to.be.within(-0.01, 100.01);
        }
    });

    it('keeps a flat run flat', () => {
        const points: UsageChartPoint[] = [{ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 20, y: 5 }];
        expect(builder.linePath(points)).to.equal('M0 5 C3.33 5 6.67 5 10 5 C13.33 5 16.67 5 20 5');
    });

    it('builds a closed area from the top edge and the reversed bottom edge', () => {
        const top: UsageChartPoint[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
        const bottom: UsageChartPoint[] = [{ x: 0, y: 4 }, { x: 10, y: 4 }];
        const path = builder.areaPath(top, bottom);
        expect(path.startsWith('M0 0 C')).to.equal(true);
        expect(path).to.contain(' L10 4 C');
        expect(path.endsWith(' Z')).to.equal(true);
    });

    it('rejects area input whose edges have different lengths', () => {
        expect(builder.areaPath([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: 0 }])).to.equal('');
    });

    it('stacks series so each area starts where the previous one ends', () => {
        const project = (index: number, value: number): UsageChartPoint => ({ x: index, y: 100 - value });
        const areas = builder.stackedAreaPaths([
            { key: 'claude', values: [10, 0] },
            { key: 'codex', values: [5, 20] }
        ], 2, project);
        expect(areas.map(area => area.key)).to.deep.equal(['claude', 'codex']);
        // Codex top edge sits at cumulative values 15 and 20, so its first move is at y = 85.
        expect(areas[1].path.startsWith('M0 85 ')).to.equal(true);
        // The area closes back to the bottom edge, which starts from the previous series' top (y = 90 at bucket 0).
        expect(areas[1].path).to.contain(' L1 100 ');
        expect(areas[0].path.startsWith('M0 90 ')).to.equal(true);
    });

    it('treats missing, negative and non-finite values as zero', () => {
        const project = (index: number, value: number): UsageChartPoint => ({ x: index, y: value });
        const [area] = builder.stackedAreaPaths([{ key: 'x', values: [Number.NaN, -3, 4] }], 3, project);
        expect(area.path.startsWith('M0 0 ')).to.equal(true);
        expect(area.path).to.contain(' L2 0 ');
    });
});

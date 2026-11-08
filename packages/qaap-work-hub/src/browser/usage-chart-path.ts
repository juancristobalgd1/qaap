// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** A point in SVG user units. */
export interface UsageChartPoint {
    readonly x: number;
    readonly y: number;
}

/** One stacked series: a value per bucket, bottom series first. */
export interface UsageStackedSeries {
    readonly key: string;
    readonly values: readonly number[];
}

/**
 * Pure SVG path builder for the Usage chart. It produces smooth curves that never overshoot
 * the data (Fritsch-Carlson monotone cubic interpolation), so an area never dips below zero
 * between two daily values.
 */
export class UsageChartPathBuilder {

    /**
     * Cubic Bezier commands that continue from the current point through `points`.
     * The first point is assumed to be the current point and is not emitted.
     */
    curveTo(points: readonly UsageChartPoint[]): string {
        if (points.length < 2) {
            return '';
        }
        const tangents = this.tangents(points);
        let path = '';
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const h = (p1.x - p0.x) / 3;
            const c1x = p0.x + h;
            const c1y = p0.y + tangents[i] * h;
            const c2x = p1.x - h;
            const c2y = p1.y - tangents[i + 1] * h;
            path += ` C${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(p1.x)} ${round(p1.y)}`;
        }
        return path;
    }

    /** Smooth line through `points`, starting with a move command. */
    linePath(points: readonly UsageChartPoint[]): string {
        if (points.length === 0) {
            return '';
        }
        const [first] = points;
        return `M${round(first.x)} ${round(first.y)}${this.curveTo(points)}`;
    }

    /**
     * Closed area between a smoothed top edge and a smoothed bottom edge (bottom is traversed
     * backwards). Returns an empty string when there are fewer than two points.
     */
    areaPath(top: readonly UsageChartPoint[], bottom: readonly UsageChartPoint[]): string {
        if (top.length < 2 || top.length !== bottom.length) {
            return '';
        }
        const reversedBottom = [...bottom].reverse();
        const [topFirst] = top;
        const [bottomLast] = reversedBottom;
        return `M${round(topFirst.x)} ${round(topFirst.y)}${this.curveTo(top)}`
            + ` L${round(bottomLast.x)} ${round(bottomLast.y)}${this.curveTo(reversedBottom)} Z`;
    }

    /**
     * Stacked area paths, one per series in input order. `project` maps a bucket index and a
     * stacked value to SVG coordinates, so callers own the scales.
     */
    stackedAreaPaths(
        series: readonly UsageStackedSeries[],
        bucketCount: number,
        project: (bucketIndex: number, value: number) => UsageChartPoint
    ): Array<{ key: string; path: string }> {
        const baseline: number[] = new Array<number>(bucketCount).fill(0);
        return series.map(entry => {
            const top: UsageChartPoint[] = [];
            const bottom: UsageChartPoint[] = [];
            for (let index = 0; index < bucketCount; index++) {
                const value = finiteOrZero(entry.values[index]);
                const lower = baseline[index];
                const upper = lower + value;
                top.push(project(index, upper));
                bottom.push(project(index, lower));
                baseline[index] = upper;
            }
            return { key: entry.key, path: this.areaPath(top, bottom) };
        });
    }

    /**
     * Fritsch-Carlson tangents. Interior tangents are zero where the data changes direction,
     * and each segment is clamped so the curve stays monotone between its endpoints.
     */
    protected tangents(points: readonly UsageChartPoint[]): number[] {
        const count = points.length;
        const slopes: number[] = [];
        for (let i = 0; i < count - 1; i++) {
            const dx = points[i + 1].x - points[i].x;
            slopes.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
        }
        const result: number[] = new Array<number>(count).fill(0);
        result[0] = slopes[0];
        result[count - 1] = slopes[count - 2];
        for (let i = 1; i < count - 1; i++) {
            result[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
        }
        for (let i = 0; i < count - 1; i++) {
            if (slopes[i] === 0) {
                result[i] = 0;
                result[i + 1] = 0;
                continue;
            }
            const alpha = result[i] / slopes[i];
            const beta = result[i + 1] / slopes[i];
            const magnitude = alpha * alpha + beta * beta;
            if (magnitude > 9) {
                const tau = 3 / Math.sqrt(magnitude);
                result[i] = tau * alpha * slopes[i];
                result[i + 1] = tau * beta * slopes[i];
            }
        }
        return result;
    }
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

function finiteOrZero(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * GPU compositor helpers for the transcript virtual list.
 *
 * Markdown, sanitization and row measurement stay on the CPU (and the markdown
 * worker). WebGL/canvas text would break selection, links and accessibility.
 * What the GPU *can* do cheaply is composite the already-painted window: a 3D
 * translate keeps scroll frames on the compositor thread instead of
 * invalidating layout of every mounted row.
 */

/** Class on the virtual window/footer so CSS can promote a single compositor layer. */
export const TRANSCRIPT_GPU_LAYER_CLASS = 'theia-mod-transcript-gpu-layer';

/**
 * Pixel-snapped 3D translate. Fractional Y on a composited layer blurs text;
 * offsets already come from layout integers, but streaming measure noise can
 * still produce subpixels.
 */
export function formatTranscriptGpuLayerTransform(offsetY: number): string {
    const y = Number.isFinite(offsetY) ? Math.round(offsetY) : 0;
    return `translate3d(0, ${y}px, 0)`;
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    formatTranscriptGpuLayerTransform,
    TRANSCRIPT_GPU_LAYER_CLASS,
} from './qaap-transcript-gpu-compositor';

describe('qaap-transcript-gpu-compositor', () => {

    it('snaps the window offset onto a 3D compositor translate', () => {
        expect(formatTranscriptGpuLayerTransform(480)).to.equal('translate3d(0, 480px, 0)');
        expect(formatTranscriptGpuLayerTransform(0)).to.equal('translate3d(0, 0px, 0)');
    });

    it('rounds subpixels so composited text stays sharp', () => {
        expect(formatTranscriptGpuLayerTransform(119.4)).to.equal('translate3d(0, 119px, 0)');
        expect(formatTranscriptGpuLayerTransform(119.6)).to.equal('translate3d(0, 120px, 0)');
    });

    it('treats non-finite offsets as the origin', () => {
        expect(formatTranscriptGpuLayerTransform(Number.NaN)).to.equal('translate3d(0, 0px, 0)');
        expect(formatTranscriptGpuLayerTransform(Number.POSITIVE_INFINITY)).to.equal('translate3d(0, 0px, 0)');
    });

    it('exports the CSS layer class used by the virtual list', () => {
        expect(TRANSCRIPT_GPU_LAYER_CLASS).to.equal('theia-mod-transcript-gpu-layer');
    });
});

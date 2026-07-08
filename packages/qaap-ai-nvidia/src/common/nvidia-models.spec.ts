// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isFreeNvidiaModelId, NVIDIA_FREE_MODELS } from './nvidia-models';

describe('isFreeNvidiaModelId', () => {

    it('recognizes every configured free-tier model (with the nvidia/ prefix)', () => {
        for (const model of NVIDIA_FREE_MODELS) {
            expect(isFreeNvidiaModelId(`nvidia/${model}`), model).to.equal(true);
        }
    });

    it('is false for an nvidia model that is not on the free list', () => {
        expect(isFreeNvidiaModelId('nvidia/meta/llama-3.1-405b-instruct')).to.equal(false);
    });

    it('is false when the nvidia/ provider prefix is missing', () => {
        // A bare model id (no provider prefix) is not attributed to NVIDIA.
        expect(isFreeNvidiaModelId('meta/llama-3.3-70b-instruct')).to.equal(false);
        expect(isFreeNvidiaModelId('openai/gpt-4o')).to.equal(false);
    });

    it('is false for the bare prefix or empty input', () => {
        expect(isFreeNvidiaModelId('nvidia/')).to.equal(false);
        expect(isFreeNvidiaModelId('')).to.equal(false);
    });
});

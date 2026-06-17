// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isFreeNvidiaModelId, NVIDIA_FREE_MODELS } from './nvidia-models';

describe('isFreeNvidiaModelId', () => {
    it('returns true for a known free NVIDIA model id', () => {
        const modelId = NVIDIA_FREE_MODELS[0];
        expect(isFreeNvidiaModelId(`nvidia/${modelId}`)).to.equal(true);
    });

    it('returns false for non-nvidia provider ids', () => {
        expect(isFreeNvidiaModelId('openai/gpt-4o')).to.equal(false);
    });

    it('returns false for paid nvidia models', () => {
        expect(isFreeNvidiaModelId('nvidia/missing-model')).to.equal(false);
    });
});

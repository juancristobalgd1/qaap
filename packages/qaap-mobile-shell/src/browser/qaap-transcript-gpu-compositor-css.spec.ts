// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { TRANSCRIPT_GPU_LAYER_CLASS } from '../common/qaap-transcript-gpu-compositor';

describe('transcript GPU compositor CSS', () => {

    it('promotes the virtual window and footer to a compositor layer', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'mobile-workbench-conversation.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        expect(css).to.include('.theia-transcript-virtual-window {');
        expect(css).to.include('.theia-transcript-virtual-footer {');
        expect(css).to.include('will-change: transform');
        expect(css).to.include('backface-visibility: hidden');
        expect(css).to.include('contain: layout style');
        expect(css).not.to.match(/\.theia-transcript-virtual-window\s*\{[^}]*contain:\s*layout style paint/s);
    });

    it('isolates paint of frozen streaming prose without clipping code cards', () => {
        const cssPath = path.join(__dirname, '..', '..', 'src', 'browser', 'style', 'qaap-transcript-markdown.css');
        const css = fs.readFileSync(cssPath, 'utf8');
        expect(css).to.include('.theia-transcript-stream-frozen > p');
        expect(css).to.include('contain: layout style paint');
        expect(css).not.to.include('.theia-transcript-stream-frozen > .theia-mobile-agent-code-block-card');
        expect(TRANSCRIPT_GPU_LAYER_CLASS).to.equal('theia-mod-transcript-gpu-layer');
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveTranscriptPreviewOpenUrl } from './qaap-transcript-preview-effective-url';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('resolveTranscriptPreviewOpenUrl', () => {

    const project = { id: 'marked', name: 'marked' } as MobileProjectEntry;

    it('pins QAAP_STATIC_ENTRY onto a bare identity claim', () => {
        const bootstrap = {
            previewClaimUrl: 'http://localhost:3000/qaap-preview/live-id/',
            previewUrl: 'http://localhost:3000/qaap-preview/live-id/',
            descriptor: {
                devCommand: 'QAAP_STATIC_ENTRY="/docs/demo/" node -e "/* static */"',
            },
        };
        expect(resolveTranscriptPreviewOpenUrl({
            candidateUrl: bootstrap.previewClaimUrl,
            project,
            bootstrap: bootstrap as never,
            appliesToProject: true,
        })).to.equal('http://localhost:3000/qaap-preview/live-id/docs/demo/');
    });

    it('rebases a remembered nested path onto a new identity after remount', () => {
        const remembered = {
            ...project,
            previewUrl: 'http://localhost:3000/qaap-preview/old-id/docs/demo/',
        };
        expect(resolveTranscriptPreviewOpenUrl({
            candidateUrl: 'http://localhost:3000/qaap-preview/new-id/',
            project: remembered,
            bootstrap: {
                previewClaimUrl: 'http://localhost:3000/qaap-preview/new-id/',
            } as never,
            appliesToProject: true,
        })).to.equal('http://localhost:3000/qaap-preview/new-id/docs/demo/');
    });

    it('does not apply another project\'s nested entry', () => {
        expect(resolveTranscriptPreviewOpenUrl({
            candidateUrl: 'http://localhost:3000/qaap-preview/json-id/',
            project: { id: 'json-server', name: 'json-server' } as MobileProjectEntry,
            bootstrap: {
                previewClaimUrl: 'http://localhost:3000/qaap-preview/json-id/',
                descriptor: {
                    devCommand: 'QAAP_STATIC_ENTRY="/docs/demo/" node -e "/* static */"',
                },
            } as never,
            appliesToProject: false,
        })).to.equal('http://localhost:3000/qaap-preview/json-id/');
    });

    it('does not rebase onto another project\'s identity or remembered nested demo', () => {
        expect(resolveTranscriptPreviewOpenUrl({
            candidateUrl: 'http://localhost:3000/qaap-preview/json-id/',
            project: { id: 'json-server', name: 'json-server' } as MobileProjectEntry,
            bootstrap: {
                previewClaimUrl: 'http://localhost:3000/qaap-preview/marked-id/',
                previewUrl: 'http://localhost:3000/qaap-preview/marked-id/docs/demo/',
                descriptor: {
                    devCommand: 'QAAP_STATIC_ENTRY="/docs/demo/" node -e "/* static */"',
                },
            } as never,
            appliesToProject: false,
        })).to.equal('http://localhost:3000/qaap-preview/json-id/');
    });
});

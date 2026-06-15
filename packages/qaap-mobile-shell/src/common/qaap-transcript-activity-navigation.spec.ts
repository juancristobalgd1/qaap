// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveTranscriptActivityNavigationItems } from './qaap-transcript-activity-navigation';

const deps = {
    localizeActivityLabel: (label: string) => label,
    formatToolActivityLabel: (toolName: string) => `Running: ${toolName}`,
    localizePlanningLabel: () => 'Planning next steps',
    localizeWritingLabel: () => 'Writing response',
    extractToolPath: (argsJson: string) => {
        try {
            const args = JSON.parse(argsJson) as { path?: string };
            return args.path;
        } catch {
            return undefined;
        }
    },
    resolveToolKind: (toolName: string) => {
        if (toolName.includes('bash')) {
            return 'terminal';
        }
        if (toolName.includes('read')) {
            return 'reading';
        }
        return 'tool';
    },
};

describe('qaap-transcript-activity-navigation', () => {

    it('maps tool segments to file and terminal navigation targets', () => {
        const items = resolveTranscriptActivityNavigationItems([
            { type: 'tool', name: 'read_file', args: '{"path":"src/a.ts"}', finished: true, toolUseId: '1' },
            { type: 'tool', name: 'bash', args: '{"command":"npm test"}', finished: false, toolUseId: '2' },
        ], deps, false);
        expect(items).to.have.length(2);
        expect(items[0]?.navigate).to.equal('file');
        expect(items[0]?.filePath).to.equal('src/a.ts');
        expect(items[1]?.navigate).to.equal('terminal');
    });
});

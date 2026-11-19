// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { setChatInputProductChrome } from '@theia/ai-chat-ui/lib/browser/chat-input-product-chrome';
import { QaapGithubMcpConnectionState } from '@theia/qaap-shared-core/lib/browser/qaap-github-mcp-connection-state';
import { createQaapChatInputProductChrome } from './qaap-chat-input-product-chrome';

@injectable()
export class QaapChatInputProductContribution implements FrontendApplicationContribution {

    /** Bound by `@theia/qaap-ai-config` (a higher layer); without it the chat input shows no GitHub chip. */
    @inject(QaapGithubMcpConnectionState) @optional()
    protected readonly githubMcpConnectionState: QaapGithubMcpConnectionState | undefined;

    onStart(_app: FrontendApplication): void {
        setChatInputProductChrome(createQaapChatInputProductChrome({ githubMcp: this.githubMcpConnectionState }));
    }

    onStop(_app: FrontendApplication): void {
        setChatInputProductChrome(undefined);
    }
}

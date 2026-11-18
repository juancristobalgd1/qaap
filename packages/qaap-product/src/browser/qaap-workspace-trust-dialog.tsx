// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core';
import { codicon } from '@theia/core/lib/browser';
import * as React from '@theia/core/shared/react';
import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceTrustDialog } from '@theia/workspace/lib/browser/workspace-trust-dialog';
import { WorkspaceTrustDialogFactory } from '@theia/workspace/lib/browser/workspace-trust-dialog-factory';

/**
 * The workspace trust question as end users see it in Qaap: what trusting means, without upstream's
 * "feature is currently under development" note.
 */
export class QaapWorkspaceTrustDialog extends WorkspaceTrustDialog {

    protected override render(): React.ReactNode {
        return (
            <div className="workspace-trust-content">
                <div className="workspace-trust-header">
                    <i className={codicon('shield')}></i>
                    <div className="workspace-trust-title">
                        {nls.localizeByDefault('Do you trust the authors of the files in this folder?')}
                    </div>
                </div>
                <div className="workspace-trust-description">
                    {nls.localize(
                        'qaap/workspaceTrust/dialogMessage',
                        'If you trust the authors, code in this folder may run: tasks, scripts and agents can execute it. '
                        + 'If not, Qaap opens it in Restricted Mode and turns those features off. You can change this later.',
                    )}
                </div>
                {this.folderUris.length > 0 && (
                    <div className="workspace-trust-folder">
                        <ul className="workspace-trust-folder-list">
                            {this.folderUris.map(uri => {
                                const stringified = uri.path.fsPath();
                                return <li key={stringified}>{stringified}</li>;
                            })}
                        </ul>
                    </div>
                )}
            </div>
        );
    }
}

@injectable()
export class QaapWorkspaceTrustDialogFactory implements WorkspaceTrustDialogFactory {
    create(folderUris: URI[]): WorkspaceTrustDialog {
        return new QaapWorkspaceTrustDialog(folderUris);
    }
}

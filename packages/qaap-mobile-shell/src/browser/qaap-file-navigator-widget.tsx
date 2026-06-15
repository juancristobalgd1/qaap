// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { TreeNode } from '@theia/core/lib/browser';
import { CommandRegistry } from '@theia/core/lib/common';
import { nls } from '@theia/core/lib/common/nls';
import { matchesMobileOneColumnLayout } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { FileNode } from '@theia/filesystem/lib/browser/file-tree';
import { FileNavigatorWidget } from '@theia/navigator/lib/browser/navigator-widget';
import * as React from '@theia/core/shared/react';
import { isQaapCloudOnboarding } from '../common/qaap-cloud-onboarding';
import { QAAP_WORK_HUB_ADD_REPOSITORY_COMMAND } from '../common/qaap-work-hub-commands';
import { QaapFileNavigatorModel } from './qaap-file-navigator-model';

@injectable()
export class QaapFileNavigatorWidget extends FileNavigatorWidget {

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    protected override renderEmptyMultiRootWorkspace(): React.ReactNode {
        if (isQaapCloudOnboarding()) {
            return <div className='theia-navigator-container'>
                <div className='center'>
                    {nls.localize(
                        'qaap/cloudOnboarding/emptyExplorer',
                        'Connect a GitHub repository to browse files here.',
                    )}
                </div>
                <div className='open-workspace-button-container'>
                    <button
                        className='theia-button open-workspace-button'
                        title={nls.localize('qaap/workHub/addRepository', 'Add repository')}
                        onClick={() => { void this.commandRegistry.executeCommand(QAAP_WORK_HUB_ADD_REPOSITORY_COMMAND); }}
                        onKeyUp={this.keyUpHandler}>
                        {nls.localize('qaap/workHub/addRepository', 'Add repository')}
                    </button>
                </div>
            </div>;
        }
        return super.renderEmptyMultiRootWorkspace();
    }

    protected override tapNode(node?: TreeNode): void {
        if (node && matchesMobileOneColumnLayout() && FileNode.is(node)) {
            (this.model as QaapFileNavigatorModel).openFileOnMobileSingleTap(node);
            return;
        }
        super.tapNode(node);
    }
}

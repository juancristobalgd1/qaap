// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { ExpandableTreeNode, TreeNode } from '@theia/core/lib/browser';
import { SelectableTreeNode } from '@theia/core/lib/browser/tree/tree-selection';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { collapseLeftPanelIfMobileOneColumn } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { FileNode } from '@theia/filesystem/lib/browser/file-tree';
import { FileNavigatorModel } from '@theia/navigator/lib/browser/navigator-model';
import { WorkspaceNode } from '@theia/navigator/lib/browser/navigator-tree';

@injectable()
export class QaapFileNavigatorModel extends FileNavigatorModel {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    /**
     * Upstream selects and expands the folder of a single-root workspace only in `initializeRoot`,
     * at startup, since opening a workspace reloads the page. `QaapWorkspaceService.openWithoutReload`
     * does not: the Explorer, already created by the IDE switch, rebuilt its root on
     * `onWorkspaceChanged` with that folder hidden and collapsed, which renders no row at all
     * (prod 2026-10-07: Explorer empty for over a minute, until F5).
     */
    protected override async updateRoot(): Promise<void> {
        await super.updateRoot();
        await this.expandSingleWorkspaceRoot();
    }

    /** A hidden root folder has no row to expand it from, so it must never stay collapsed. */
    protected async expandSingleWorkspaceRoot(): Promise<void> {
        const root = this.root;
        if (!WorkspaceNode.is(root) || root.name !== WorkspaceNode.name || root.children.length !== 1) {
            return;
        }
        const folder = root.children[0];
        if (!ExpandableTreeNode.is(folder) || folder.expanded) {
            return;
        }
        if (!this.selectedNodes.length && SelectableTreeNode.is(folder)) {
            this.selectNode(folder);
        }
        await this.expandNode(folder);
    }

    override previewNode(node: TreeNode): void {
        super.previewNode(node);
        if (FileNode.is(node)) {
            this.collapseLeftExplorerSheetIfMobile();
        }
    }

    /** Narrow mobile: one tap opens the file in the editor (not preview) and closes the explorer sheet. */
    openFileOnMobileSingleTap(node: TreeNode): void {
        if (!FileNode.is(node)) {
            return;
        }
        if (SelectableTreeNode.is(node)) {
            this.selectNode(node);
        }
        this.doOpenNode(node);
        this.collapseLeftExplorerSheetIfMobile();
    }

    protected override doOpenNode(node: TreeNode): void {
        super.doOpenNode(node);
        if (FileNode.is(node)) {
            this.collapseLeftExplorerSheetIfMobile();
        }
    }

    protected collapseLeftExplorerSheetIfMobile(): void {
        collapseLeftPanelIfMobileOneColumn(this.shell);
    }
}

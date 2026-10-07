// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { Disposable } from '@theia/core/lib/common/disposable';
import { CompositeTreeNode, ExpandableTreeNode, SelectableTreeNode, TreeNode, TreeSelection } from '@theia/core/lib/browser/tree';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceNode } from '@theia/navigator/lib/browser/navigator-tree';
import { QaapFileNavigatorModel } from './qaap-file-navigator-model';
import { QaapWorkspaceService } from './qaap-workspace-service';

disableImportJSDOM();

const REPO = new URI('file:///workspace/repos/users/alice/acme/shadcn-landing-page');

/** A desktop Work Hub page at `/`: no workspace until the IDE opens one in place. */
class HubWorkspaceService extends QaapWorkspaceService {
    reloads = 0;

    constructor() {
        super();
        Object.assign(this, {
            fileService: {
                resolve: async (uri: URI): Promise<FileStat> => {
                    if (uri.isEqual(REPO)) {
                        return FileStat.dir(REPO);
                    }
                    throw new Error(`not found: ${uri}`);
                },
            },
            server: {
                getMostRecentlyUsedWorkspace: async (): Promise<string | undefined> => undefined,
                setMostRecentlyUsedWorkspace: async (): Promise<void> => { },
            },
            windowService: { reload: (): void => { this.reloads++; } },
        });
        this._ready.resolve();
    }

    /** What upstream `doInit` does on the hub page. */
    async start(): Promise<void> {
        await this.setWorkspace(await this.toFileStat(await this.getDefaultWorkspaceUri()));
    }

    protected override updateTitle(): void { }

    protected override watchRoots(): Promise<void> {
        return Promise.resolve();
    }
}

/** The Explorer model with the tree, selection and expansion reduced to what a root needs. */
class TestNavigatorModel extends QaapFileNavigatorModel {
    readonly selected: TreeNode[] = [];
    treeRoot: TreeNode | undefined;

    constructor(workspaceService: QaapWorkspaceService) {
        super();
        const model = this;
        Object.assign(this, {
            workspaceService,
            applicationState: { reachedState: async (): Promise<void> => { } },
            tree: {
                get root(): TreeNode | undefined {
                    return model.treeRoot;
                },
                set root(root: TreeNode | undefined) {
                    model.treeRoot = root;
                },
                createWorkspaceRoot: async (stat: FileStat, parent: WorkspaceNode): Promise<TreeNode> => ({
                    id: stat.resource.toString(),
                    name: stat.resource.path.base,
                    parent,
                    children: [],
                    expanded: false,
                    selected: false,
                    visible: parent.name !== WorkspaceNode.name,
                } as TreeNode),
            },
            selectionService: {
                get selectedNodes(): TreeNode[] {
                    return model.selected;
                },
                addSelection: (selection: TreeSelection | SelectableTreeNode): void => {
                    const node = TreeSelection.is(selection) ? selection.node : selection;
                    if (node) {
                        (node as SelectableTreeNode).selected = true;
                        model.selected.push(node);
                    }
                },
            },
            expansionService: {
                expandNode: async (node: ExpandableTreeNode): Promise<ExpandableTreeNode> => {
                    node.expanded = true;
                    return node;
                },
            },
        });
        // `init` fills it (tree, services); empty, `initializeRoot` takes the model for disposed.
        this.toDispose.push(Disposable.create(() => { }));
    }

    /** What `init` does once the Explorer widget exists. */
    start(): Promise<void> {
        return this.initializeRoot();
    }

    /** The workspace folder: hidden in a single-root workspace, so its children are the tree. */
    workspaceRoot(): TreeNode | undefined {
        return CompositeTreeNode.is(this.root) ? this.root.children[0] : undefined;
    }
}

async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

describe('QaapFileNavigatorModel after an in-place workspace open', () => {

    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => disableJSDOM());

    it('shows the project folder once the hub opens the IDE in place (prod 2026-10-07: Explorer empty until F5)', async () => {
        const workspaceService = new HubWorkspaceService();
        await workspaceService.start();
        // `openDesktopIde()` shows the IDE, and so the Explorer, before the workspace is prepared.
        const model = new TestNavigatorModel(workspaceService);
        await model.start();
        expect(model.root).to.equal(undefined);

        expect(await workspaceService.openWithoutReload(REPO)).to.equal(true);
        await settle();

        const root = model.workspaceRoot();
        expect(workspaceService.reloads).to.equal(0);
        expect(root?.id).to.equal(REPO.toString());
        expect(root?.visible).to.equal(false);
        // A collapsed hidden folder renders no row at all: the tree looked empty.
        expect(ExpandableTreeNode.isExpanded(root)).to.equal(true);
    });

    it('shows the project folder when the Explorer starts while the in-place open is still running', async () => {
        const workspaceService = new HubWorkspaceService();
        await workspaceService.start();
        const opening = workspaceService.openWithoutReload(REPO);
        const model = new TestNavigatorModel(workspaceService);
        await model.start();
        expect(await opening).to.equal(true);
        await settle();

        const root = model.workspaceRoot();
        expect(root?.id).to.equal(REPO.toString());
        expect(ExpandableTreeNode.isExpanded(root)).to.equal(true);
    });

    it('keeps the startup behaviour: a page loaded on the workspace expands its folder once', async () => {
        const workspaceService = new HubWorkspaceService();
        await workspaceService.start();
        expect(await workspaceService.openWithoutReload(REPO)).to.equal(true);
        const model = new TestNavigatorModel(workspaceService);
        await model.start();

        expect(ExpandableTreeNode.isExpanded(model.workspaceRoot())).to.equal(true);
        expect(model.selected.map(node => node.id)).to.deep.equal([REPO.toString()]);
    });
});

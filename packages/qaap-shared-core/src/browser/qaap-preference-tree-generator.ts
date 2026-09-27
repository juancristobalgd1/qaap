// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, interfaces } from '@theia/core/shared/inversify';
import { CompositeTreeNode, TreeNode } from '@theia/core/lib/browser/tree/tree';
import { PreferenceLayout } from '@theia/preferences/lib/browser/util/preference-layout';
import { PreferenceTreeGenerator } from '@theia/preferences/lib/browser/util/preference-tree-generator';
import { Preference } from '@theia/preferences/lib/browser/util/preference-types';

/**
 * Upstream sorts every group's sub-groups by id, which discards the curated order of
 * {@link QaapPreferenceLayoutProvider} (e.g. Settings → AI Features: agents and BYOK providers first).
 * For the curated top-level sections, sub-groups are re-ordered by their position in the layout;
 * leaves stay first and sub-groups unknown to the layout keep upstream's alphabetical order at the end.
 */
@injectable()
export class QaapPreferenceTreeGenerator extends PreferenceTreeGenerator {

    /** Top-level layout sections whose sub-group order is curated by the Qaap layout. */
    protected readonly curatedSectionIds: ReadonlySet<string> = new Set(['ai-features']);

    override generateTree(): CompositeTreeNode {
        const root = super.generateTree();
        const ranks = this.collectLayoutRanks();
        if (ranks.size) {
            for (const child of root.children) {
                if (CompositeTreeNode.is(child)) {
                    this.restoreLayoutOrder(child, ranks);
                }
            }
        }
        return root;
    }

    protected collectLayoutRanks(): Map<string, number> {
        const ranks = new Map<string, number>();
        const visit = (items: readonly PreferenceLayout[]): void => {
            for (const item of items) {
                ranks.set(item.id, ranks.size);
                visit(item.children ?? []);
            }
        };
        for (const section of this.layoutProvider.getLayout()) {
            if (this.curatedSectionIds.has(section.id)) {
                visit(section.children ?? []);
            }
        }
        return ranks;
    }

    protected restoreLayoutOrder(group: CompositeTreeNode, ranks: ReadonlyMap<string, number>): void {
        const sortKey = (node: TreeNode): [number, number] => CompositeTreeNode.is(node)
            ? [1, ranks.get(Preference.TreeNode.getGroupAndIdFromNodeId(node.id).id) ?? Number.MAX_SAFE_INTEGER]
            : [0, 0];
        // Array#sort is stable: equal keys keep upstream's order (leaves by id, unknown groups by id).
        (group.children as TreeNode[]).sort((a, b) => {
            const [aKind, aRank] = sortKey(a);
            const [bKind, bRank] = sortKey(b);
            return aKind - bKind || aRank - bRank;
        });
        for (const child of group.children) {
            if (CompositeTreeNode.is(child)) {
                this.restoreLayoutOrder(child, ranks);
            }
        }
    }
}

/** Swaps the upstream generator for {@link QaapPreferenceTreeGenerator}; call from a module loaded after `@theia/preferences`. */
export function rebindQaapPreferenceTreeGenerator(bind: interfaces.Bind, rebind: interfaces.Rebind): void {
    bind(QaapPreferenceTreeGenerator).toSelf().inSingletonScope();
    rebind(PreferenceTreeGenerator).toService(QaapPreferenceTreeGenerator);
}

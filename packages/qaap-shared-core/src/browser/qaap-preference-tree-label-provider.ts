// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { injectable } from '@theia/core/shared/inversify';
import { PreferenceTreeLabelProvider } from '@theia/preferences/lib/browser/util/preference-tree-label-provider';
import { Preference } from '@theia/preferences/lib/browser/util/preference-types';
import { QaapPiProviders } from '../common/qaap-pi-provider-registry';

/**
 * Labels the API-key preferences that exist only for Pi with the provider's real name
 * (e.g. "DeepSeek API key" instead of the id-derived "Deepseek Api Key"). Every other preference
 * keeps the upstream label.
 */
@injectable()
export class QaapPreferenceTreeLabelProvider extends PreferenceTreeLabelProvider {

    protected piKeyLabels: Map<string, string> | undefined;

    override getName(node: Preference.TreeNode): string {
        const { id } = Preference.TreeNode.getGroupAndIdFromNodeId(node.id);
        const label = this.getPiKeyLabels().get(id);
        if (label !== undefined) {
            return nls.localize('theia/qaap/piProviders/apiKeyLabel', '{0} API key', label);
        }
        return super.getName(node);
    }

    /** Preference id to provider label, built once from the Pi provider registry. */
    protected getPiKeyLabels(): Map<string, string> {
        if (this.piKeyLabels === undefined) {
            this.piKeyLabels = new Map(QaapPiProviders.ownDescriptors().map(descriptor => [descriptor.pref, descriptor.label]));
        }
        return this.piKeyLabels;
    }
}

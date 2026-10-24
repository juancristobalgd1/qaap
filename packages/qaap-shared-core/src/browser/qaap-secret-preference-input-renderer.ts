// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { codicon } from '@theia/core/lib/browser/widgets/widget';
import { nls } from '@theia/core/lib/common/nls';
import { injectable, interfaces } from '@theia/core/shared/inversify';
import { Preference } from '@theia/preferences/lib/browser/util/preference-types';
import { PreferenceNodeRenderer } from '@theia/preferences/lib/browser/views/components/preference-node-renderer';
import {
    PreferenceLeafNodeRendererContribution,
    PreferenceNodeRendererContribution
} from '@theia/preferences/lib/browser/views/components/preference-node-renderer-creator';
import { PreferenceStringInputRenderer } from '@theia/preferences/lib/browser/views/components/preference-string-input';

/** Matches preference ids whose string value is a credential (API keys, tokens, secrets). */
const QAAP_SECRET_PREFERENCE_ID_PATTERN = /(api[_-]?key|token|secret)$/i;

/** Upstream string input renderer uses priority 2; secret inputs must win over it. */
const QAAP_SECRET_RENDERER_PRIORITY = 3;

/**
 * Whether a preference id names a credential that must not be shown in plain text in the
 * settings editor (e.g. `ai-features.openrouter.openrouterApiKey`).
 */
export function isQaapSecretPreferenceId(preferenceId: string): boolean {
    return QAAP_SECRET_PREFERENCE_ID_PATTERN.test(preferenceId);
}

/**
 * String input for credential preferences: masked by default, with a show/hide toggle.
 * Value handling (debounced save, blur flush, external updates) is inherited unchanged.
 */
@injectable()
export class QaapSecretPreferenceInputRenderer extends PreferenceStringInputRenderer {

    protected override createInteractable(parent: HTMLElement): void {
        const wrapper = document.createElement('div');
        wrapper.classList.add('qaap-secret-preference-input');
        parent.appendChild(wrapper);
        super.createInteractable(wrapper);

        const input = this.interactable;
        input.type = 'password';
        input.autocomplete = 'off';
        input.classList.add('qaap-secret-preference-input-field');

        const showLabel = nls.localize('theia/qaap/preferences/showSecret', 'Show value');
        const hideLabel = nls.localize('theia/qaap/preferences/hideSecret', 'Hide value');
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.classList.add('qaap-secret-preference-toggle');
        const applyVisibility = (visible: boolean): void => {
            input.type = visible ? 'text' : 'password';
            toggle.className = `qaap-secret-preference-toggle ${codicon(visible ? 'eye-closed' : 'eye')}`;
            const label = visible ? hideLabel : showLabel;
            toggle.title = label;
            toggle.setAttribute('aria-label', label);
            toggle.setAttribute('aria-pressed', String(visible));
        };
        applyVisibility(false);
        toggle.onclick = (): void => applyVisibility(input.type === 'password');
        wrapper.appendChild(toggle);
    }
}

@injectable()
export class QaapSecretPreferenceInputRendererContribution extends PreferenceLeafNodeRendererContribution {
    static ID = 'qaap-secret-preference-input-renderer';
    id = QaapSecretPreferenceInputRendererContribution.ID;

    canHandleLeafNode(node: Preference.LeafNode): number {
        if (Preference.LeafNode.getType(node) !== 'string') {
            return 0;
        }
        const { id } = Preference.TreeNode.getGroupAndIdFromNodeId(node.id);
        return isQaapSecretPreferenceId(id) ? QAAP_SECRET_RENDERER_PRIORITY : 0;
    }

    createLeafNodeRenderer(container: interfaces.Container): PreferenceNodeRenderer {
        return container.get(QaapSecretPreferenceInputRenderer);
    }
}

/** Registers {@link QaapSecretPreferenceInputRenderer} ahead of the upstream string renderer; call from a root container module. */
export function bindQaapSecretPreferenceInputRenderer(bind: interfaces.Bind): void {
    bind(QaapSecretPreferenceInputRenderer).toSelf();
    bind(PreferenceNodeRendererContribution).to(QaapSecretPreferenceInputRendererContribution).inSingletonScope();
}

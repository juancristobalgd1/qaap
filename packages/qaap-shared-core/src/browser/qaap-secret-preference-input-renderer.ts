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

import { isQaapSecretPreferenceId } from '../common/qaap-secret-preference-id';
import { isQaapSecretPlaceholder } from '../common/qaap-secret-placeholder';

export { isQaapSecretPreferenceId };

/** Upstream string input renderer uses priority 2; secret inputs must win over it. */
const QAAP_SECRET_RENDERER_PRIORITY = 3;

/**
 * String input for credential preferences: masked by default, with a show/hide toggle.
 * Value handling (debounced save, blur flush, external updates) is inherited unchanged.
 */
@injectable()
export class QaapSecretPreferenceInputRenderer extends PreferenceStringInputRenderer {

    protected secretToggle: HTMLButtonElement | undefined;

    /**
     * A saved key arrives from the backend as a placeholder: the field stays empty and says so, the
     * visibility toggle is hidden, and only a non-empty typed value is written.
     */
    protected override doHandleValueChange(): void {
        super.doHandleValueChange();
        this.applySavedState();
    }

    protected override handleUserInteraction(): void {
        if (this.isSavedWithEmptyInput()) {
            return;
        }
        super.handleUserInteraction();
    }

    protected override async handleBlur(): Promise<void> {
        if (this.isSavedWithEmptyInput()) {
            // Empty input over a saved key means "keep it": drop any pending write of an erased value.
            this.setPreferenceWithDebounce.cancel();
            this.handleValueChange();
            return;
        }
        await super.handleBlur();
    }

    protected isSavedWithEmptyInput(): boolean {
        return isQaapSecretPlaceholder(this.getValue()) && this.interactable.value.trim() === '';
    }

    protected applySavedState(): void {
        const saved = isQaapSecretPlaceholder(this.getValue());
        if (saved && document.activeElement !== this.interactable) {
            this.interactable.value = '';
        }
        this.interactable.placeholder = saved ? nls.localize('theia/qaap/preferences/secretSaved', 'Saved — enter a new key to replace it') : '';
        if (this.secretToggle) {
            this.secretToggle.hidden = saved;
            this.secretToggle.disabled = saved;
        }
    }

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
        this.secretToggle = toggle;
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

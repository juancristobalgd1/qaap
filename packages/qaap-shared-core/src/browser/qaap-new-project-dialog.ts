// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AbstractDialog, DialogError, DialogMode } from '@theia/core/lib/browser/dialogs';
import { nls } from '@theia/core/lib/common/nls';

export type QaapNewProjectKind = 'local' | 'github';

export interface QaapNewProjectValue {
    readonly name: string;
    /** GitHub only: whether the new repository is private. Always `true` for local projects. */
    readonly private: boolean;
}

export interface QaapNewProjectDialogOptions {
    readonly kind: QaapNewProjectKind;
    /** GitHub only: the account that will own the repository. */
    readonly owner?: string;
}

let nestedDialogsOpen = 0;

/** True while a "New project" dialog is on screen. Parent dialogs must not treat its Escape as their own. */
export function isQaapNewProjectDialogOpen(): boolean {
    return nestedDialogsOpen > 0;
}

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * "New local project" / "New GitHub repository". One dialog, so both entry points share the name
 * rules and Escape handling. A GitHub repository shows its owner and a visibility choice (Private by
 * default); a local project is a folder on this workspace only.
 */
export class QaapNewProjectDialog extends AbstractDialog<QaapNewProjectValue> {

    protected readonly nameInput: HTMLInputElement;
    protected privateRadio: HTMLInputElement | undefined;

    protected readonly onEscapeCapture = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') {
            return;
        }
        // Handled here in the capture phase so no parent overlay or workbench handler closes first.
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close();
    };

    constructor(options: QaapNewProjectDialogOptions) {
        super({
            title: options.kind === 'github'
                ? nls.localize('qaap/newProject/githubTitle', 'New GitHub repository')
                : nls.localize('qaap/newProject/localTitle', 'New local project'),
        });

        if (options.kind === 'github') {
            this.contentNode.appendChild(this.createLabelledRow(
                nls.localize('qaap/newProject/owner', 'Owner'),
                options.owner ?? nls.localize('qaap/newProject/ownerSignedIn', 'Your GitHub account'),
            ));
        } else {
            this.contentNode.appendChild(this.createLabelledRow(
                nls.localize('qaap/newProject/location', 'Location'),
                nls.localize('qaap/newProject/locationValue', 'This workspace only. Nothing is pushed to GitHub.'),
            ));
        }

        this.nameInput = document.createElement('input');
        this.nameInput.type = 'text';
        this.nameInput.className = 'theia-input';
        this.nameInput.spellcheck = false;
        this.nameInput.placeholder = nls.localize('qaap/newProject/namePlaceholder', 'project-name');
        this.nameInput.setAttribute('aria-label', nls.localize('qaap/newProject/nameLabel', 'Project name'));
        this.contentNode.appendChild(this.nameInput);

        if (options.kind === 'github') {
            this.contentNode.appendChild(this.createVisibilityGroup());
        }

        this.controlPanel.removeChild(this.errorMessageNode);
        this.contentNode.appendChild(this.errorMessageNode);
        this.appendAcceptButton(options.kind === 'github'
            ? nls.localize('qaap/newProject/createRepository', 'Create repository')
            : nls.localize('qaap/newProject/createProject', 'Create project'));
    }

    get value(): QaapNewProjectValue {
        return {
            name: this.nameInput.value.trim(),
            private: this.privateRadio ? this.privateRadio.checked : true,
        };
    }

    override open(disposeOnResolve: boolean = true): Promise<QaapNewProjectValue | undefined> {
        nestedDialogsOpen += 1;
        document.addEventListener('keydown', this.onEscapeCapture, true);
        const settle = (): void => {
            document.removeEventListener('keydown', this.onEscapeCapture, true);
            nestedDialogsOpen = Math.max(0, nestedDialogsOpen - 1);
        };
        return super.open(disposeOnResolve).finally(settle);
    }

    protected override isValid(value: QaapNewProjectValue, mode: DialogMode): DialogError {
        if (mode === 'preview') {
            return true;
        }
        if (!value.name) {
            return nls.localize('qaap/newProject/nameRequired', 'Enter a project name');
        }
        if (value.name.startsWith('.') || !NAME_PATTERN.test(value.name) || value.name.length > 100) {
            return nls.localize('qaap/newProject/nameInvalid', 'Use letters, numbers, dashes, underscores, or dots');
        }
        return true;
    }

    protected override onActivateRequest(): void {
        this.nameInput.focus();
    }

    protected createLabelledRow(label: string, text: string): HTMLElement {
        const row = document.createElement('div');
        row.className = 'qaap-new-project-dialog-row';
        const labelNode = document.createElement('span');
        labelNode.className = 'qaap-new-project-dialog-row-label';
        labelNode.textContent = label;
        const valueNode = document.createElement('span');
        valueNode.className = 'qaap-new-project-dialog-row-value';
        valueNode.textContent = text;
        row.append(labelNode, valueNode);
        return row;
    }

    protected createVisibilityGroup(): HTMLElement {
        const group = document.createElement('fieldset');
        group.className = 'qaap-new-project-dialog-visibility';
        const legend = document.createElement('legend');
        legend.textContent = nls.localize('qaap/newProject/visibility', 'Visibility');
        group.append(legend);
        const name = `qaap-new-project-visibility-${Math.random().toString(36).slice(2)}`;
        const choices: Array<{ label: string; isPrivate: boolean }> = [
            { label: nls.localize('qaap/newProject/private', 'Private (only you can see it)'), isPrivate: true },
            { label: nls.localize('qaap/newProject/public', 'Public (anyone can see it)'), isPrivate: false },
        ];
        for (const choice of choices) {
            const label = document.createElement('label');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = name;
            radio.checked = choice.isPrivate;
            if (choice.isPrivate) {
                this.privateRadio = radio;
            }
            label.append(radio, document.createTextNode(` ${choice.label}`));
            group.append(label);
        }
        return group;
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    clampQaapWorkHubAuxPanelWidth,
    QAAP_WORK_HUB_AUX_PANEL_MIN_CHAT_WIDTH,
    QAAP_WORK_HUB_AUX_PANEL_MIN_WIDTH,
    QAAP_WORK_HUB_AUX_PANEL_RECENT_LIMIT,
    QAAP_WORK_HUB_AUX_PANEL_STORAGE_KEY,
    QaapWorkHubAuxPanelModel,
    type QaapWorkHubAuxPanelStorage,
} from './qaap-work-hub-aux-panel-model';

function memoryStorage(): QaapWorkHubAuxPanelStorage & { entries: Map<string, string> } {
    const entries = new Map<string, string>();
    return {
        entries,
        getItem: key => entries.get(key) ?? null,
        setItem: (key, value) => { entries.set(key, value); },
    };
}

describe('qaap-work-hub-aux-panel-model', () => {

    it('starts on a single "New tab" launcher', () => {
        const model = new QaapWorkHubAuxPanelModel();
        const first = model.ensureTab();
        expect(first.kind).to.equal('launcher');
        expect(model.addLauncher().id).to.equal(first.id);
        expect(model.tabs.map(tab => tab.kind)).to.deep.equal(['launcher']);
    });

    it('turns the active launcher into the picked view and appends later views', () => {
        const model = new QaapWorkHubAuxPanelModel();
        model.ensureTab();
        model.openView('preview');
        expect(model.tabs.map(tab => tab.kind)).to.deep.equal(['preview']);
        model.openView('terminal');
        expect(model.tabs.map(tab => tab.kind)).to.deep.equal(['preview', 'terminal']);
        expect(model.activeTab?.kind).to.equal('terminal');
    });

    it('keeps one tab per view and focuses it when opened again', () => {
        const model = new QaapWorkHubAuxPanelModel();
        const preview = model.openView('preview');
        model.openView('files');
        expect(model.openView('preview').id).to.equal(preview.id);
        expect(model.tabs).to.have.length(2);
        expect(model.activeTab?.id).to.equal(preview.id);
    });

    it('activates the right neighbour (else the left one) when the active tab closes', () => {
        const model = new QaapWorkHubAuxPanelModel();
        const preview = model.openView('preview');
        const files = model.openView('files');
        const terminal = model.openView('terminal');
        model.activate(files.id);
        expect(model.closeTab(files.id)?.id).to.equal(terminal.id);
        expect(model.closeTab(terminal.id)?.id).to.equal(preview.id);
        expect(model.closeTab(preview.id)).to.equal(undefined);
        expect(model.tabs).to.have.length(0);
    });

    it('closing an inactive tab keeps the active one', () => {
        const model = new QaapWorkHubAuxPanelModel();
        const preview = model.openView('preview');
        const files = model.openView('files');
        expect(model.closeTab(preview.id)?.id).to.equal(files.id);
    });

    it('records closed views newest first, deduplicated, without the launcher', () => {
        let now = 1000;
        const model = new QaapWorkHubAuxPanelModel(() => now);
        const launcher = model.addLauncher();
        const preview = model.openView('preview');
        const files = model.openView('files');
        model.addLauncher();
        model.closeTab(model.tabs.find(tab => tab.kind === 'launcher')!.id);
        expect(launcher.kind).to.equal('launcher');
        now = 2000;
        model.closeTab(preview.id);
        now = 3000;
        model.closeTab(files.id);
        expect(model.recentlyClosed).to.deep.equal([
            { kind: 'files', closedAt: 3000 },
            { kind: 'preview', closedAt: 2000 },
        ]);
        model.reopenClosed('preview');
        expect(model.activeTab?.kind).to.equal('preview');
        expect(model.recentlyClosed.map(entry => entry.kind)).to.deep.equal(['files']);
    });

    it('caps the recently closed list', () => {
        const model = new QaapWorkHubAuxPanelModel();
        for (let i = 0; i < QAAP_WORK_HUB_AUX_PANEL_RECENT_LIMIT + 4; i++) {
            const kind = (['preview', 'files', 'terminal'] as const)[i % 3];
            model.closeTab(model.openView(kind).id);
        }
        expect(model.recentlyClosed.length).to.be.at.most(QAAP_WORK_HUB_AUX_PANEL_RECENT_LIMIT);
    });

    it('searches open and recently closed tabs by label, ignoring case', () => {
        const model = new QaapWorkHubAuxPanelModel();
        model.openView('preview');
        model.closeTab(model.openView('terminal').id);
        const labels: Record<string, string> = { preview: 'Browser', terminal: 'Terminal', launcher: 'New tab', files: 'Files' };
        const result = model.search('  TERM ', kind => labels[kind]);
        expect(result.open).to.deep.equal([]);
        expect(result.recentlyClosed.map(entry => entry.kind)).to.deep.equal(['terminal']);
        expect(model.search('', kind => labels[kind]).open.map(tab => tab.kind)).to.deep.equal(['preview']);
    });

    it('round-trips through storage under its sessionStorage key', () => {
        const storage = memoryStorage();
        const model = new QaapWorkHubAuxPanelModel(() => 42);
        model.open = true;
        model.width = 612;
        model.maximized = true;
        model.openView('preview');
        model.openView('terminal');
        model.closeTab(model.openView('files').id);
        model.activate(model.tabs[0].id);
        model.save(storage);
        expect(storage.entries.has(QAAP_WORK_HUB_AUX_PANEL_STORAGE_KEY)).to.equal(true);

        const restored = new QaapWorkHubAuxPanelModel();
        restored.load(storage);
        expect(restored.open).to.equal(true);
        expect(restored.width).to.equal(612);
        expect(restored.maximized).to.equal(true);
        expect(restored.tabs.map(tab => tab.kind)).to.deep.equal(['preview', 'terminal']);
        expect(restored.activeTab?.kind).to.equal('preview');
        expect(restored.recentlyClosed).to.deep.equal([{ kind: 'files', closedAt: 42 }]);
    });

    it('ignores corrupt or unknown persisted entries', () => {
        const storage = memoryStorage();
        storage.setItem(QAAP_WORK_HUB_AUX_PANEL_STORAGE_KEY, '{not json');
        const model = new QaapWorkHubAuxPanelModel();
        model.load(storage);
        expect(model.open).to.equal(false);
        expect(model.tabs).to.have.length(0);

        model.restore({
            open: true,
            // 'review' was a standalone view in early builds; it is the Files view's mode now.
            tabs: ['preview', 'bogus' as 'preview', 'review' as 'preview', 'preview', 'files'],
            activeIndex: 9,
            width: Number.NaN,
            recentlyClosed: [{ kind: 'launcher' as 'files', closedAt: 1 }, { kind: 'terminal', closedAt: 2 }],
        });
        expect(model.tabs.map(tab => tab.kind)).to.deep.equal(['preview', 'files']);
        expect(model.activeTab?.kind).to.equal('preview');
        expect(model.width).to.equal(480);
        expect(model.recentlyClosed.map(entry => entry.kind)).to.deep.equal(['terminal']);
    });

    it('clamps the width between the panel minimum and the room the chat needs', () => {
        expect(clampQaapWorkHubAuxPanelWidth(100, 1600)).to.equal(QAAP_WORK_HUB_AUX_PANEL_MIN_WIDTH);
        expect(clampQaapWorkHubAuxPanelWidth(5000, 1600)).to.equal(1600 - QAAP_WORK_HUB_AUX_PANEL_MIN_CHAT_WIDTH);
        expect(clampQaapWorkHubAuxPanelWidth(500.4, 1600)).to.equal(500);
        // A cramped window still keeps the panel usable.
        expect(clampQaapWorkHubAuxPanelWidth(500, 500)).to.equal(QAAP_WORK_HUB_AUX_PANEL_MIN_WIDTH);
        expect(clampQaapWorkHubAuxPanelWidth(Number.NaN, 1600)).to.equal(480);
    });
});

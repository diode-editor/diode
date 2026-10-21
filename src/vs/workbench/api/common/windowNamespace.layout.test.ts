import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Position, Selection, TabInputText, TabInputTextDiff, Uri } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

/** tabGroups/event surface not yet in the d.ts type at the time of the test. */
interface ITabsWindow {
    tabGroups: vscode.TabGroups;
    onDidChangeVisibleTextEditors(l: (e: readonly vscode.TextEditor[]) => void): { dispose(): void };
    onDidChangeTextEditorViewColumn(l: (e: vscode.TextEditorViewColumnChangeEvent) => void): { dispose(): void };
}

function makeCtx() {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    const window = createWindowNamespace(ctx);
    return { stub, window, tabs: window as unknown as ITabsWindow };
}

function tab(uri: string, opts: Partial<{ isActive: boolean; isDirty: boolean; label: string }> = {}) {
    return {
        uri,
        label: opts.label ?? uri.slice(uri.lastIndexOf("/") + 1),
        isActive: opts.isActive ?? false,
        isDirty: opts.isDirty ?? false,
        kind: "text",
    };
}

const A = Uri.file("/p/a.ts").toString();
const B = Uri.file("/p/b.ts").toString();

describe("WindowNamespace — layout differ (editor.layoutChanged)", () => {
    it("AS-12: tabGroups.all is built from the snapshot; exactly one active group", () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: false, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: true, tabs: [tab(A, { isActive: true }), tab(B)] },
            ],
        });

        const all = tabs.tabGroups.all;
        expect(all.length).toBe(2);
        expect(all.map((g) => g.viewColumn)).toEqual([1, 2]);
        expect(all.filter((g) => g.isActive).length).toBe(1);
        expect(tabs.tabGroups.activeTabGroup.viewColumn).toBe(2);
        expect(all[1].tabs.length).toBe(2);
        expect(all[1].activeTab?.label).toBe("a.ts");
    });

    it("AS-13/18: input is TabInputText with uri; isPinned/isPreview are plain false, isDirty is real", () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true, isDirty: true })] }],
        });

        const first = tabs.tabGroups.activeTabGroup.tabs[0];
        expect(first.input instanceof TabInputText).toBe(true);
        expect((first.input as TabInputText).uri.toString()).toBe(A);
        expect(first.isPinned).toBe(false);
        expect(first.isPreview).toBe(false);
        expect(first.isDirty).toBe(true);
    });

    it("AS-14: onDidChangeTabs gives opened/closed/changed from the snapshot diff", () => {
        const { stub, tabs } = makeCtx();
        const events: vscode.TabChangeEvent[] = [];
        tabs.tabGroups.onDidChangeTabs((e) => events.push(e));

        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });
        expect(events.at(-1)!.opened.map((t) => t.label)).toEqual(["a.ts"]);

        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A), tab(B, { isActive: true })] }],
        });
        expect(events.at(-1)!.opened.map((t) => t.label)).toEqual(["b.ts"]);
        expect(events.at(-1)!.changed.map((t) => t.label)).toEqual(["a.ts"]);

        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });
        expect(events.at(-1)!.closed.map((t) => t.label)).toEqual(["b.ts"]);
    });

    it("AS-15: onDidChangeTabGroups: a split is opened, a collapse is closed, an active change is changed", () => {
        const { stub, tabs } = makeCtx();
        const events: vscode.TabGroupChangeEvent[] = [];
        tabs.tabGroups.onDidChangeTabGroups((e) => events.push(e));

        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: false, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: true, tabs: [tab(A, { isActive: true })] },
            ],
        });
        expect(events.at(-1)!.opened.map((g) => g.viewColumn)).toEqual([2]);
        expect(events.at(-1)!.changed.map((g) => g.viewColumn)).toEqual([1]);

        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });
        expect(events.at(-1)!.closed.length).toBe(1);
    });

    it("AS-7/8: visibleTextEditors has one editor per group; an event on set change", () => {
        const { stub, window, tabs } = makeCtx();
        const fired: (readonly vscode.TextEditor[])[] = [];
        tabs.onDidChangeVisibleTextEditors((editors) => fired.push(editors));

        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: false, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: true, tabs: [tab(A, { isActive: true })] },
            ],
        });

        const visible = window.visibleTextEditors;
        expect(visible.length).toBe(2);
        expect(visible[0] === visible[1]).toBe(false);
        expect(visible[0].document === visible[1].document).toBe(true);
        expect(fired.length).toBe(1);

        // Same set of visible editors in the snapshot: the event does not fire again.
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: false, tabs: [tab(A, { isActive: true })] },
            ],
        });
        expect(fired.length).toBe(1);
    });

    it("AS-9: column renumbering keeps the same editor object and fires viewColumn", () => {
        const { stub, window, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: false, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: true, tabs: [tab(B, { isActive: true })] },
            ],
        });
        const editorOfGroup2 = window.visibleTextEditors[1];
        expect(editorOfGroup2.viewColumn).toBe(2);

        const events: vscode.TextEditorViewColumnChangeEvent[] = [];
        tabs.onDidChangeTextEditorViewColumn((e) => events.push(e));

        // Group 1 collapsed: group 2 became column 1.
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 2, viewColumn: 1, isActive: true, tabs: [tab(B, { isActive: true })] }],
        });

        expect(events.length).toBe(1);
        expect(events[0].textEditor === editorOfGroup2).toBe(true);
        expect(events[0].viewColumn).toBe(1);
        expect(editorOfGroup2.viewColumn).toBe(1);
    });

    it("collapsed group: the editor viewColumn is undefined, the cache is pruned", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: false, tabs: [tab(B, { isActive: true })] },
            ],
        });
        const dying = window.visibleTextEditors[1];

        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });

        expect(dying.viewColumn).toBeUndefined();
        expect(window.visibleTextEditors.length).toBe(1);
    });

    it("layoutChanged with garbage is ignored; the strip is not reset", () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });

        stub.fire("editor.layoutChanged", null);
        stub.fire("editor.layoutChanged", { groups: "junk" });

        expect(tabs.tabGroups.all.length).toBe(1);
    });

    it("diff tab: with both sides → TabInputTextDiff, without sides → input undefined", () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                {
                    groupId: 1,
                    viewColumn: 1,
                    isActive: true,
                    tabs: [
                        {
                            ...tab("diff://1", { isActive: true, label: "diff" }),
                            kind: "diff",
                            original: A,
                            modified: B,
                        },
                        { ...tab("diff://2", { label: "no sides" }), kind: "diff" },
                    ],
                },
            ],
        });

        const groupTabs = tabs.tabGroups.activeTabGroup.tabs;
        expect(groupTabs[0].input instanceof TabInputTextDiff).toBe(true);
        const diffInput = groupTabs[0].input as TabInputTextDiff;
        expect(diffInput.original.toString()).toBe(A);
        expect(diffInput.modified.toString()).toBe(B);
        expect(groupTabs[1].input).toBeUndefined();
    });

    it("TabInputTextDiff only for a diff with both sides", () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                {
                    groupId: 1,
                    viewColumn: 1,
                    isActive: true,
                    tabs: [
                        { ...tab("diff://1", { isActive: true }), kind: "diff", original: A },
                        { ...tab("diff://2"), kind: "diff", modified: B },
                        // Sides on a non-diff tab do not make its input a diff.
                        { ...tab("keybindings:global"), kind: "unknown", original: A, modified: B },
                    ],
                },
            ],
        });

        expect(tabs.tabGroups.activeTabGroup.tabs.map((t) => t.input)).toEqual([undefined, undefined, undefined]);
    });

    it("a tab of a foreign kind (kind=unknown): input undefined, not counted as a visible text editor", () => {
        const { stub, window, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                {
                    groupId: 1,
                    viewColumn: 1,
                    isActive: true,
                    tabs: [tab(A), { ...tab("keybindings:global", { isActive: true }), kind: "unknown" }],
                },
            ],
        });

        const groupTabs = tabs.tabGroups.activeTabGroup.tabs;
        expect(groupTabs[0].input instanceof TabInputText).toBe(true);
        expect(groupTabs[1].input).toBeUndefined();
        expect(tabs.tabGroups.activeTabGroup.activeTab?.input).toBeUndefined();
        expect(window.visibleTextEditors).toEqual([]);
    });

    it("onDidChangeTabs carries diff tabs with the same input rule", () => {
        const { stub, tabs } = makeCtx();
        const events: vscode.TabChangeEvent[] = [];
        tabs.tabGroups.onDidChangeTabs((e) => events.push(e));

        stub.fire("editor.layoutChanged", {
            groups: [
                {
                    groupId: 1,
                    viewColumn: 1,
                    isActive: true,
                    tabs: [
                        {
                            ...tab("diff://1", { isActive: true, label: "diff" }),
                            kind: "diff",
                            original: A,
                            modified: B,
                        },
                        { ...tab("diff://2", { label: "no sides" }), kind: "diff" },
                    ],
                },
            ],
        });

        const opened = events.at(-1)!.opened;
        expect(opened[0].input instanceof TabInputTextDiff).toBe(true);
        expect(opened[1].input).toBeUndefined();
    });

    it("group without an active tab: activeTab undefined, no visible editor", () => {
        const { stub, window, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A)] }],
        });

        expect(tabs.tabGroups.activeTabGroup.activeTab).toBeUndefined();
        expect(window.visibleTextEditors.length).toBe(0);
    });

    it("active diff tab: side models (sideEditors) are visible editors, with events on appear and leave", () => {
        // Claude Code sets `viewingProposedDiff` from onDidChangeVisibleTextEditors:
        // whether a side with its scheme is visible.
        const { stub, window, tabs } = makeCtx();
        const right = "_claude_fs_right:/p/b.ts";
        const seen: string[][] = [];
        tabs.onDidChangeVisibleTextEditors((editors) => seen.push(editors.map((e) => e.document.uri.toString())));
        const diffTab = (isActive: boolean) => ({
            ...tab("diode-diff:/p/b.ts?pair", { isActive, label: "[Claude Code] b.ts" }),
            kind: "diff",
            original: A,
            modified: right,
            sideEditors: [A, right],
        });
        const layout = (diffActive: boolean) => ({
            groups: [
                {
                    groupId: 1,
                    viewColumn: 1,
                    isActive: true,
                    tabs: [tab(B, { isActive: !diffActive }), diffTab(diffActive)],
                },
            ],
        });

        stub.fire("editor.layoutChanged", layout(true));
        expect(window.visibleTextEditors.map((e) => [e.document.uri.toString(), e.viewColumn])).toEqual([
            [A, 1],
            [right, 1],
        ]);
        stub.fire("editor.layoutChanged", layout(false));

        expect(seen).toEqual([[A, right], [B]]);
    });

    it("an active diff tab without side models (snapshots) yields no visible text editor", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                {
                    groupId: 1,
                    viewColumn: 1,
                    isActive: true,
                    tabs: [
                        {
                            ...tab("diff://1", { isActive: true, label: "diff" }),
                            kind: "diff",
                            original: A,
                            modified: B,
                        },
                    ],
                },
                { groupId: 2, viewColumn: 2, isActive: false, tabs: [tab(B, { isActive: true })] },
            ],
        });

        const visible = window.visibleTextEditors;
        expect(visible.length).toBe(1);
        expect(visible[0].viewColumn).toBe(2);
    });

    it("a closed tab's selection is pruned: reopening starts at (0,0)", () => {
        const { stub, window } = makeCtx();
        const withSelection = {
            ...tab(A, { isActive: true }),
            selections: [{ anchorLine: 2, anchorCharacter: 1, activeLine: 2, activeCharacter: 5 }],
        };
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [withSelection] }],
        });
        expect(window.visibleTextEditors[0].selection.active).toEqual({ line: 2, character: 5 });

        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(B, { isActive: true })] }],
        });
        // Reopening without a seeded selection gives the default (0,0), not the old cache.
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });
        expect(window.visibleTextEditors[0].selection.active).toEqual({ line: 0, character: 0 });
    });

    it("a group column change without cached editors does not fire a viewColumn event", () => {
        const { stub, tabs } = makeCtx();
        const events: vscode.TextEditorViewColumnChangeEvent[] = [];
        tabs.onDidChangeTextEditorViewColumn((e) => events.push(e));

        // Group 2's active tab is a diff: it has no text editor (and no cache).
        const diffTab = {
            ...tab("diff://1", { isActive: true, label: "diff" }),
            kind: "diff",
            original: A,
            modified: B,
        };
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: false, tabs: [diffTab] },
            ],
        });
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 2, viewColumn: 1, isActive: true, tabs: [diffTab] }],
        });

        expect(events.length).toBe(0);
    });

    it("visible editor selections are seeded from the snapshot", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                {
                    groupId: 1,
                    viewColumn: 1,
                    isActive: true,
                    tabs: [
                        {
                            ...tab(A, { isActive: true }),
                            selections: [{ anchorLine: 2, anchorCharacter: 1, activeLine: 2, activeCharacter: 5 }],
                        },
                    ],
                },
            ],
        });

        const editor = window.visibleTextEditors[0];
        expect(editor.selection.active).toEqual({ line: 2, character: 5 });
    });
});

describe("WindowNamespace — active editor group (meta.groupId)", () => {
    it("groupId from meta wins over the snapshot active group", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: false, tabs: [tab(A, { isActive: true })] },
            ],
        });
        stub.fire("editor.activeEditorChanged", { uri: A, groupId: 2 });

        expect(window.activeTextEditor?.viewColumn).toBe(2);
    });

    it("meta without groupId: the active editor goes into the snapshot active group", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: false, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: true, tabs: [tab(A, { isActive: true })] },
            ],
        });
        stub.fire("editor.activeEditorChanged", { uri: A });

        expect(window.activeTextEditor?.viewColumn).toBe(2);
    });

    it("the selection setter in an inactive group does not touch the active editor activeSelections", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: false, tabs: [tab(A, { isActive: true })] },
            ],
        });
        stub.fire("editor.activeEditorChanged", {
            uri: A,
            groupId: 1,
            selection: { anchorLine: 1, anchorCharacter: 1, activeLine: 1, activeCharacter: 1 },
        });

        // Same file but ANOTHER group: the active editor (group 1) does not change.
        const ofGroup2 = window.visibleTextEditors[1];
        ofGroup2.selection = new Selection(new Position(5, 0), new Position(5, 3)) as unknown as vscode.Selection;

        expect(ofGroup2.selection.active).toEqual({ line: 5, character: 3 });
        expect(window.activeTextEditor?.selection.active).toEqual({ line: 1, character: 1 });
        expect(stub.notifies.at(-1)).toMatchObject({ method: "editor.setSelection", params: { groupId: 2 } });
    });

    it("selectionChanged with groupId addresses the editor of that group", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: false, tabs: [tab(A, { isActive: true })] },
            ],
        });

        stub.fire("editor.selectionChanged", {
            uri: A,
            groupId: 2,
            selections: [{ anchorLine: 3, anchorCharacter: 4, activeLine: 3, activeCharacter: 4 }],
        });

        const [ofGroup1, ofGroup2] = window.visibleTextEditors;
        expect(ofGroup2.selection.active).toEqual({ line: 3, character: 4 });
        expect(ofGroup1.selection.active).toEqual({ line: 0, character: 0 });
    });
});

describe("WindowNamespace — layout event subscriptions (thisArgs/disposables)", () => {
    it("thisArgs is bound, dispose via the array removes the subscription, a repeated dispose is a no-op", () => {
        const { stub, tabs } = makeCtx();
        const disposables: vscode.Disposable[] = [];
        const thisArg = { count: 0 };
        tabs.tabGroups.onDidChangeTabs(
            function (this: { count: number }) {
                this.count += 1;
            },
            thisArg,
            disposables,
        );
        expect(disposables.length).toBe(1);

        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });
        expect(thisArg.count).toBe(1);

        disposables[0].dispose();
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(B, { isActive: true })] }],
        });
        expect(thisArg.count).toBe(1);

        // Disposing an already unsubscribed listener again breaks nothing.
        disposables[0].dispose();
        expect(thisArg.count).toBe(1);
    });
});

describe("WindowNamespace — Tab.group and internal tab addressing", () => {
    it("a tab from tabGroups.all knows its group: tabs[j].group and activeTab.group are the same object", () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: false, tabs: [tab(A, { isActive: true }), tab(B)] },
                { groupId: 2, viewColumn: 2, isActive: true, tabs: [tab(B, { isActive: true })] },
            ],
        });

        const all = tabs.tabGroups.all;
        expect(all[0].tabs[0].group).toBe(all[0]);
        expect(all[0].tabs[1].group).toBe(all[0]);
        expect(all[1].tabs[0].group).toBe(all[1]);
        expect(all[0].activeTab).toBe(all[0].tabs[0]);
        expect(all[0].activeTab?.group).toBe(all[0]);
        const active = tabs.tabGroups.activeTabGroup;
        expect(active.activeTab?.group).toBe(active);
    });

    it("a tab from onDidChangeTabs is in its group's tabs", () => {
        const { stub, tabs } = makeCtx();
        const events: vscode.TabChangeEvent[] = [];
        tabs.tabGroups.onDidChangeTabs((e) => events.push(e));

        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 3, viewColumn: 1, isActive: true, tabs: [tab(A), tab(B, { isActive: true })] }],
        });

        const opened = events.at(-1)!.opened;
        expect(opened.map((t) => t.label)).toEqual(["a.ts", "b.ts"]);
        expect(opened[1].group.tabs[1]).toBe(opened[1]);
        expect(opened[1].group.activeTab).toBe(opened[1]);
        expect(opened[1].group.viewColumn).toBe(1);
    });

    it("internal fields are not visible on the Tab object", () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });

        const first = tabs.tabGroups.activeTabGroup.tabs[0];
        expect(Object.keys(first).filter((key) => key.startsWith("_diode"))).toEqual([]);
        expect(Object.keys(first).sort()).toEqual(
            ["group", "input", "isActive", "isDirty", "isPinned", "isPreview", "label"].sort(),
        );
    });
});

describe("WindowNamespace — tabGroups.close", () => {
    it("a single tab → editor.closeTabs with a (groupId, uri) pair", async () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });

        await tabs.tabGroups.close(tabs.tabGroups.activeTabGroup.tabs[0]);

        expect(stub.requests.at(-1)).toEqual({
            method: "editor.closeTabs",
            params: { tabs: [{ groupId: 1, uri: A }] },
        });
    });

    it("an array of tabs from different groups is closed in one request", async () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: false, tabs: [tab(B, { isActive: true })] },
            ],
        });
        const all = tabs.tabGroups.all;

        await tabs.tabGroups.close([all[0].tabs[0], all[1].tabs[0]]);

        expect(stub.requests.at(-1)).toEqual({
            method: "editor.closeTabs",
            params: {
                tabs: [
                    { groupId: 1, uri: A },
                    { groupId: 2, uri: B },
                ],
            },
        });
    });

    it("a tab from an onDidChangeTabs event is closed by its (groupId, uri) pair", async () => {
        const { stub, tabs } = makeCtx();
        const events: vscode.TabChangeEvent[] = [];
        tabs.tabGroups.onDidChangeTabs((e) => events.push(e));
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 5, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true }), tab(B)] }],
        });

        await tabs.tabGroups.close(events.at(-1)!.opened[1]);

        expect(stub.requests.at(-1)).toEqual({
            method: "editor.closeTabs",
            params: { tabs: [{ groupId: 5, uri: B }] },
        });
    });

    it("objects without internal addressing in the tabs array are skipped", async () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });
        const foreign = { ...tabs.tabGroups.activeTabGroup.tabs[0] };

        await tabs.tabGroups.close([tabs.tabGroups.activeTabGroup.tabs[0], foreign]);

        expect(stub.requests.at(-1)).toEqual({
            method: "editor.closeTabs",
            params: { tabs: [{ groupId: 1, uri: A }] },
        });
    });

    it("an empty array → true without RPC", async () => {
        const { stub, tabs } = makeCtx();
        await expect(tabs.tabGroups.close([])).resolves.toBe(true);
        expect(stub.requests.length).toBe(0);
    });

    it("a group → editor.closeGroups by groupId from the snapshot", async () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] },
                { groupId: 7, viewColumn: 2, isActive: false, tabs: [tab(B, { isActive: true })] },
            ],
        });

        await tabs.tabGroups.close(tabs.tabGroups.all[1]);

        expect(stub.requests.at(-1)).toEqual({ method: "editor.closeGroups", params: { groupIds: [7] } });
    });

    it("a group with a foreign column (not in the snapshot) is addressed as -1", async () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });

        await tabs.tabGroups.close([{ viewColumn: 99 } as unknown as vscode.TabGroup]);

        expect(stub.requests.at(-1)).toEqual({ method: "editor.closeGroups", params: { groupIds: [-1] } });
    });
});

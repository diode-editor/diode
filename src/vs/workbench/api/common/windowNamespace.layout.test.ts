import { describe, expect, it } from "vitest";

import type * as vscode from "vscode";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { TabInputText, Uri } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

/** Поверхность tabGroups/событий, которой ещё нет в типе d.ts на момент теста. */
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

describe("WindowNamespace — layout-диффер (editor.layoutChanged)", () => {
    it("AS-12: tabGroups.all строится из снимка; ровно одна активная группа", () => {
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

    it("AS-13/18: input — TabInputText с uri; isPinned/isPreview честные false, isDirty настоящий", () => {
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

    it("AS-14: onDidChangeTabs — opened/closed/changed по диффу снимков", () => {
        const { stub, tabs } = makeCtx();
        const events: vscode.TabChangeEvent[] = [];
        tabs.tabGroups.onDidChangeTabs((e) => events.push(e));

        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });
        expect(events.at(-1)!.opened.map((t) => t.label)).toEqual(["a.ts"]);

        // Открытие b + смена активной вкладки.
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A), tab(B, { isActive: true })] }],
        });
        expect(events.at(-1)!.opened.map((t) => t.label)).toEqual(["b.ts"]);
        expect(events.at(-1)!.changed.map((t) => t.label)).toEqual(["a.ts"]);

        // Закрытие b.
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });
        expect(events.at(-1)!.closed.map((t) => t.label)).toEqual(["b.ts"]);
    });

    it("AS-15: onDidChangeTabGroups — сплит opened, схлопывание closed, смена активной changed", () => {
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

    it("AS-7/8: visibleTextEditors — по редактору на группу; событие на смену набора", () => {
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
        // Один файл в двух группах — РАЗНЫЕ TextEditor с ОДНИМ document.
        expect(visible[0] === visible[1]).toBe(false);
        expect(visible[0].document === visible[1].document).toBe(true);
        expect(fired.length).toBe(1);

        // Тот же снимок по составу видимых — событие не стреляет повторно.
        stub.fire("editor.layoutChanged", {
            groups: [
                { groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] },
                { groupId: 2, viewColumn: 2, isActive: false, tabs: [tab(A, { isActive: true })] },
            ],
        });
        expect(fired.length).toBe(1);
    });

    it("AS-9: перенумерация колонок — тот же объект редактора, событие viewColumn", () => {
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

        // Группа 1 схлопнулась: группа 2 стала колонкой 1.
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 2, viewColumn: 1, isActive: true, tabs: [tab(B, { isActive: true })] }],
        });

        expect(events.length).toBe(1);
        expect(events[0].textEditor === editorOfGroup2).toBe(true);
        expect(events[0].viewColumn).toBe(1);
        // Тот же объект, колонка — геттер от снимка.
        expect(editorOfGroup2.viewColumn).toBe(1);
    });

    it("схлопнутая группа: viewColumn редактора — undefined, кэш прюнится", () => {
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

    it("выделения видимого редактора сеются из снимка", () => {
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

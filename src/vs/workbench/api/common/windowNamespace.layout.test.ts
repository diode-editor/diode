import { describe, expect, it } from "vitest";

import type * as vscode from "vscode";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Position, Selection, TabInputText, TabInputTextDiff, Uri } from "./vscodeTypes.ts";
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

    it("layoutChanged с мусором игнорируется — полоса не сбрасывается", () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });

        stub.fire("editor.layoutChanged", null);
        stub.fire("editor.layoutChanged", { groups: "junk" });

        expect(tabs.tabGroups.all.length).toBe(1);
    });

    it("diff-вкладка: с обеими сторонами → TabInputTextDiff, без сторон → input undefined", () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                {
                    groupId: 1,
                    viewColumn: 1,
                    isActive: true,
                    tabs: [
                        { ...tab("diff://1", { isActive: true, label: "дифф" }), kind: "diff", original: A, modified: B },
                        { ...tab("diff://2", { label: "без сторон" }), kind: "diff" },
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

    it("onDidChangeTabs несёт diff-вкладки с тем же правилом input", () => {
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
                        { ...tab("diff://1", { isActive: true, label: "дифф" }), kind: "diff", original: A, modified: B },
                        { ...tab("diff://2", { label: "без сторон" }), kind: "diff" },
                    ],
                },
            ],
        });

        const opened = events.at(-1)!.opened;
        expect(opened[0].input instanceof TabInputTextDiff).toBe(true);
        expect(opened[1].input).toBeUndefined();
    });

    it("группа без активной вкладки: activeTab undefined, видимого редактора нет", () => {
        const { stub, window, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A)] }],
        });

        expect(tabs.tabGroups.activeTabGroup.activeTab).toBeUndefined();
        expect(window.visibleTextEditors.length).toBe(0);
    });

    it("активная diff-вкладка не даёт видимого текстового редактора", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [
                {
                    groupId: 1,
                    viewColumn: 1,
                    isActive: true,
                    tabs: [{ ...tab("diff://1", { isActive: true, label: "дифф" }), kind: "diff", original: A, modified: B }],
                },
                { groupId: 2, viewColumn: 2, isActive: false, tabs: [tab(B, { isActive: true })] },
            ],
        });

        const visible = window.visibleTextEditors;
        expect(visible.length).toBe(1);
        expect(visible[0].viewColumn).toBe(2);
    });

    it("выделение закрытой вкладки прюнится: повторное открытие начинается с (0,0)", () => {
        const { stub, window } = makeCtx();
        const withSelection = {
            ...tab(A, { isActive: true }),
            selections: [{ anchorLine: 2, anchorCharacter: 1, activeLine: 2, activeCharacter: 5 }],
        };
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [withSelection] }],
        });
        expect(window.visibleTextEditors[0].selection.active).toEqual({ line: 2, character: 5 });

        // Вкладка закрылась — её выделение обязано умереть вместе с ней.
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(B, { isActive: true })] }],
        });
        // Повторное открытие без seeded-выделения — дефолт (0,0), не прошлый кэш.
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });
        expect(window.visibleTextEditors[0].selection.active).toEqual({ line: 0, character: 0 });
    });

    it("смена колонки группы без закэшированных редакторов не стреляет viewColumn-событием", () => {
        const { stub, tabs } = makeCtx();
        const events: vscode.TextEditorViewColumnChangeEvent[] = [];
        tabs.onDidChangeTextEditorViewColumn((e) => events.push(e));

        // Активная вкладка группы 2 — дифф: текстового редактора (и кэша) у неё нет.
        const diffTab = { ...tab("diff://1", { isActive: true, label: "дифф" }), kind: "diff", original: A, modified: B };
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

describe("WindowNamespace — группа активного редактора (meta.groupId)", () => {
    it("groupId из меты побеждает активную группу снимка", () => {
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

    it("мета без groupId: активный редактор ложится в активную группу снимка", () => {
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

    it("сеттер selection в неактивной группе не трогает activeSelections активного редактора", () => {
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

        // Тот же файл, но ЧУЖАЯ группа: активный редактор (группа 1) не меняется.
        const ofGroup2 = window.visibleTextEditors[1];
        ofGroup2.selection = new Selection(new Position(5, 0), new Position(5, 3)) as unknown as vscode.Selection;

        expect(ofGroup2.selection.active).toEqual({ line: 5, character: 3 });
        expect(window.activeTextEditor?.selection.active).toEqual({ line: 1, character: 1 });
        expect(stub.notifies.at(-1)).toMatchObject({ method: "editor.setSelection", params: { groupId: 2 } });
    });

    it("selectionChanged с groupId адресует редактор конкретной группы", () => {
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
        // Тот же файл в первой группе не тронут — редакторы разные.
        expect(ofGroup1.selection.active).toEqual({ line: 0, character: 0 });
    });
});

describe("WindowNamespace — подписки layout-событий (thisArgs/disposables)", () => {
    it("thisArgs привязывается, dispose через массив снимает подписку, повторный dispose — no-op", () => {
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

        // Повторный dispose уже отписанного слушателя ничего не ломает.
        disposables[0].dispose();
        expect(thisArg.count).toBe(1);
    });
});

describe("WindowNamespace — tabGroups.close", () => {
    it("одиночная вкладка → editor.closeTabs с парой (groupId, uri)", async () => {
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

    it("массив вкладок из разных групп закрывается одним запросом", async () => {
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

    it("пустой массив → true без RPC", async () => {
        const { stub, tabs } = makeCtx();
        await expect(tabs.tabGroups.close([])).resolves.toBe(true);
        expect(stub.requests.length).toBe(0);
    });

    it("группа → editor.closeGroups по groupId из снимка", async () => {
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

    it("группа с чужой колонкой (нет в снимке) адресуется как -1", async () => {
        const { stub, tabs } = makeCtx();
        stub.fire("editor.layoutChanged", {
            groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, { isActive: true })] }],
        });

        await tabs.tabGroups.close([{ viewColumn: 99 } as unknown as vscode.TabGroup]);

        expect(stub.requests.at(-1)).toEqual({ method: "editor.closeGroups", params: { groupIds: [-1] } });
    });
});

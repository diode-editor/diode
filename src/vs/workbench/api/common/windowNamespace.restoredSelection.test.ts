import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import type { IWireSelection } from "./wireTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

// Same order as the host: the layout snapshot, then the active editor meta.

const A = Uri.file("/p/a.ts").toString();
const B = Uri.file("/p/b.ts").toString();
const INITIAL: IWireSelection[] = [{ anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 0 }];
const LINES_2_3: IWireSelection[] = [{ anchorLine: 1, anchorCharacter: 0, activeLine: 3, activeCharacter: 0 }];

function tab(uri: string, isActive: boolean, selections?: IWireSelection[]) {
    return {
        uri,
        label: uri,
        isActive,
        isDirty: false,
        kind: "text",
        ...(selections === undefined ? {} : { selections }),
    };
}

function setup() {
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
    const log: string[] = [];
    const events: vscode.TextEditorSelectionChangeEvent[] = [];
    window.onDidChangeActiveTextEditor((editor) => log.push(`active ${editor?.document.uri.toString() ?? "-"}`));
    window.onDidChangeTextEditorSelection((e) => {
        events.push(e);
        const sameAsActive = e.textEditor === window.activeTextEditor ? "active" : "other";
        log.push(`selection ${e.textEditor.document.uri.toString()} ${sameAsActive}`);
    });
    const showInGroup = (groupId: number, active: string, selections: IWireSelection[], isActiveGroup = true) => {
        stub.fire("editor.layoutChanged", {
            groups: [
                {
                    groupId,
                    viewColumn: groupId,
                    isActive: isActiveGroup,
                    tabs: [
                        tab(A, active === A, active === A ? selections : undefined),
                        tab(B, active === B, active === B ? selections : undefined),
                    ],
                },
            ],
        });
    };
    const activate = (uri: string, groupId = 1) => {
        stub.fire("editor.activeEditorChanged", { uri, languageId: "typescript", groupId });
    };
    return { stub, window, log, events, showInGroup, activate };
}

describe("WindowNamespace — выделение вкладки, ставшей видимой", () => {
    it("возврат на вкладку с выделением: событие после смены активного, kind undefined", () => {
        const { log, events, showInGroup, activate } = setup();
        showInGroup(1, B, INITIAL);
        activate(B);
        log.length = 0;

        showInGroup(1, A, LINES_2_3);
        activate(A);

        expect(log).toEqual([`active ${A}`, `selection ${A} active`]);
        expect(events.at(-1)?.kind).toBeUndefined();
        expect(events.at(-1)?.selections.map((s) => [s.anchor.line, s.active.line])).toEqual([[1, 3]]);
    });

    it("вкладка с кареткой в начале документа события не даёт", () => {
        const { log, showInGroup, activate } = setup();
        showInGroup(1, A, LINES_2_3);
        activate(A);
        log.length = 0;

        showInGroup(1, B, INITIAL);
        activate(B);

        expect(log).toEqual([`active ${B}`]);
    });

    it("уже видимый редактор (фокус между группами) — не событие", () => {
        const { stub, log, activate } = setup();
        const twoGroups = (activeGroup: number) => {
            stub.fire("editor.layoutChanged", {
                groups: [
                    { groupId: 1, viewColumn: 1, isActive: activeGroup === 1, tabs: [tab(A, true, LINES_2_3)] },
                    { groupId: 2, viewColumn: 2, isActive: activeGroup === 2, tabs: [tab(B, true, LINES_2_3)] },
                ],
            });
        };
        twoGroups(1);
        activate(A, 1);
        log.length = 0;

        twoGroups(2);
        activate(B, 2);

        expect(log).toEqual([`active ${B}`]);
    });

    it("вкладка неактивной группы стала видимой — событие сразу, без смены активного", () => {
        const { stub, log, activate } = setup();
        const layout = (inactiveActive: string, selections: IWireSelection[]) => {
            stub.fire("editor.layoutChanged", {
                groups: [
                    { groupId: 1, viewColumn: 1, isActive: true, tabs: [tab(A, true, INITIAL)] },
                    {
                        groupId: 2,
                        viewColumn: 2,
                        isActive: false,
                        tabs: [tab(A, inactiveActive === A), tab(B, inactiveActive === B, selections)],
                    },
                ],
            });
        };
        layout(A, INITIAL);
        activate(A, 1);
        log.length = 0;

        layout(B, LINES_2_3);

        expect(log).toEqual([`selection ${B} other`]);
    });

    it("ожидание не переживает следующий снимок: мета другого редактора событие не тянет", () => {
        const { log, showInGroup, activate } = setup();
        showInGroup(1, B, INITIAL);
        activate(B);
        log.length = 0;

        showInGroup(1, A, LINES_2_3);
        showInGroup(1, A, LINES_2_3);
        activate(A);
        activate(B);

        expect(log).toEqual([`active ${A}`, `active ${B}`]);
    });

    it("ожидание снимает и мета другого редактора: позже пришедшая мета вкладки события не тянет", () => {
        const { log, showInGroup, activate } = setup();
        showInGroup(1, B, INITIAL);
        activate(B);
        log.length = 0;

        showInGroup(1, A, LINES_2_3);
        activate(B);
        activate(A);

        expect(log).toEqual([`active ${B}`, `active ${A}`]);
    });

    // 1:1 is exactly one empty cursor at the start; a difference in any field or
    // a second cursor makes it a restored selection.
    const sel = (anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number) => ({
        anchorLine,
        anchorCharacter,
        activeLine,
        activeCharacter,
    });
    it.each([
        ["anchorLine", [sel(2, 0, 0, 0)]],
        ["anchorCharacter", [sel(0, 3, 0, 0)]],
        ["activeLine", [sel(0, 0, 2, 0)]],
        ["activeCharacter", [sel(0, 0, 0, 3)]],
        ["вторая каретка", [sel(0, 0, 0, 0), sel(1, 0, 1, 0)]],
    ])("не 1:1 (%s) — событие есть", (_name, selections) => {
        const { log, showInGroup, activate } = setup();
        showInGroup(1, B, INITIAL);
        activate(B);
        log.length = 0;

        showInGroup(1, A, selections);
        activate(A);

        expect(log).toEqual([`active ${A}`, `selection ${A} active`]);
    });
});

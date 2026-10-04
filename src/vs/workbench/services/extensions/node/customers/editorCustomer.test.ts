import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../../base/common/event.ts";
import type { IEditorLayoutService } from "../../../../api/common/iEditorLayoutService.ts";
import type {
    IActiveEditorMeta,
    IActiveEditorSelections,
    IEditorOptionsService,
} from "../../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import type { IWireEditorLayout } from "../../../../api/common/wireTypes.ts";

import { EditorCustomer } from "./editorCustomer.ts";

const META: IActiveEditorMeta = {
    uri: "file:///a.ts",
    languageId: "typescript",
    isDirty: false,
    encoding: "utf8",
    eol: 1,
    selection: null,
};
const LAYOUT: IWireEditorLayout = { groups: [] };
const SELECTION = { anchorLine: 1, anchorCharacter: 2, activeLine: 3, activeCharacter: 4 };
const RANGE = { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 };

/** Журнал: и вызовы ядра, и нотификации, дошедшие до субпроцесса, — в одном порядке. */
function setup() {
    const log: unknown[] = [];
    const activeEditor = new Emitter<IActiveEditorMeta>();
    const selection = new Emitter<IActiveEditorSelections>();
    const layout = new Emitter<IWireEditorLayout>();
    const editorOptions = {
        getActiveEditorOptions: () => ({ tabSize: 4, insertSpaces: true }),
        setActiveEditorOptions: vi.fn(),
        getActiveEditorMeta: () => META,
        onActiveEditorChanged: (cb: (meta: IActiveEditorMeta) => void) => activeEditor.event(cb),
        onActiveEditorSelectionChanged: (cb: (s: IActiveEditorSelections) => void) => selection.event(cb),
        setActiveEditorSelections: vi.fn(),
        applyActiveEditorEdits: vi.fn(() => true),
        applyWorkspaceEdit: vi.fn(() => Promise.resolve(true)),
    } as unknown as IEditorOptionsService;
    const editorLayout: IEditorLayoutService = {
        getLayoutSnapshot: () => LAYOUT,
        onDidChangeLayout: (cb) => layout.event(cb),
        flushPendingLayout: () => log.push("flush"),
        showTextDocument: (params) => {
            log.push(["show", params]);
            return Promise.resolve({ viewColumn: 1 } as never);
        },
        closeTabs: (params) => {
            log.push(["closeTabs", params]);
            return Promise.resolve(true);
        },
        closeGroups: (params) => {
            log.push(["closeGroups", params]);
            return Promise.resolve(false);
        },
    };
    const customer = new EditorCustomer(editorOptions, editorLayout);
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    for (const method of ["editor.layoutChanged", "editor.activeEditorChanged", "editor.selectionChanged"]) {
        peer.handleNotification(method, (params) => log.push([method, params]));
    }
    const attachTo = () => customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { customer, editorOptions, log, peer, attachTo, activeEditor, selection, layout };
}

describe("EditorCustomer — семена и события редактора", () => {
    it("семена: полоса групп, затем активный редактор — только живому спавну", async () => {
        const h = setup();
        h.customer.pushInitialState();
        const attached = h.attachTo();
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.log).toEqual([
            ["editor.layoutChanged", LAYOUT],
            ["editor.activeEditorChanged", META],
        ]);

        attached.dispose();
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.log).toHaveLength(2);
    });

    it("события ядра уходят субпроцессу; мета активного редактора сперва флашит полосу", async () => {
        const h = setup();
        const attached = h.attachTo();
        h.layout.fire(LAYOUT);
        h.activeEditor.fire(META);
        const selections = { uri: "file:///a.ts", selections: [SELECTION] } as unknown as IActiveEditorSelections;
        h.selection.fire(selections);
        await flushMicrotasks();
        // Флаш синхронный, нотификации доезжают позже — но в порядке отправки.
        expect(h.log).toEqual([
            "flush",
            ["editor.layoutChanged", LAYOUT],
            ["editor.activeEditorChanged", META],
            ["editor.selectionChanged", selections],
        ]);

        attached.dispose();
        h.layout.fire(LAYOUT);
        h.activeEditor.fire(META);
        h.selection.fire(selections);
        await flushMicrotasks();
        expect(h.log).toHaveLength(4);
    });
});

describe("EditorCustomer — запросы субпроцесса", () => {
    // Без it.each: имена с `{}`/`"` мутационный раннер не находит по фильтру имени.
    it("editor.setOptions чистит патч: целые положительные размеры, indentSize — алиас, мусор отброшен", async () => {
        const cases: readonly (readonly [unknown, object])[] = [
            [
                { tabSize: 4.7, insertSpaces: false },
                { tabSize: 4, insertSpaces: false },
            ],
            [{ indentSize: 2.5 }, { tabSize: 2 }],
            [{ tabSize: 3, indentSize: 8 }, { tabSize: 3 }],
            [{ tabSize: 0, indentSize: 0, insertSpaces: "yes" }, {}],
            [{ tabSize: -1, indentSize: -1 }, {}],
            [{ tabSize: Infinity }, {}],
            [{ tabSize: Infinity, indentSize: 6 }, { tabSize: 6 }],
            [{ indentSize: Infinity }, {}],
            [{ tabSize: "4", indentSize: "2" }, {}],
            [null, {}],
            [undefined, {}],
            ["4", {}],
        ];
        const h = setup();
        h.attachTo();
        // Infinity по JSON-каналу не доехал бы; канал in-process отдаёт значения как есть.
        for (const [params] of cases) {
            await expect(h.peer.request("editor.setOptions", params)).resolves.toBeNull();
        }
        expect(vi.mocked(h.editorOptions.setActiveEditorOptions).mock.calls).toEqual(cases.map(([, patch]) => [patch]));
    });

    it("editor.getOptions отдаёт опции активного редактора", async () => {
        const h = setup();
        h.attachTo();
        await expect(h.peer.request("editor.getOptions", undefined)).resolves.toEqual({
            tabSize: 4,
            insertSpaces: true,
        });
    });

    it("editor.setSelection: выделения и группа доезжают; без строкового uri — игнор", async () => {
        const h = setup();
        h.attachTo();
        h.peer.notify("editor.setSelection", { uri: 7, selections: [SELECTION] });
        h.peer.notify("editor.setSelection", { uri: "file:///a.ts", selections: [SELECTION, 5], groupId: 2 });
        h.peer.notify("editor.setSelection", { uri: "file:///a.ts", selections: [], groupId: "2" });
        await flushMicrotasks();
        expect(vi.mocked(h.editorOptions.setActiveEditorSelections).mock.calls).toEqual([
            ["file:///a.ts", [SELECTION], 2],
            ["file:///a.ts", [], undefined],
        ]);
    });

    it("editor.applyEdit: без строкового uri — false; иначе вердикт ядра с разобранными правками", async () => {
        const h = setup();
        h.attachTo();
        await expect(h.peer.request("editor.applyEdit", { uri: null, edits: [] })).resolves.toBe(false);
        expect(h.editorOptions.applyActiveEditorEdits).not.toHaveBeenCalled();
        await expect(
            h.peer.request("editor.applyEdit", { uri: "file:///a.ts", edits: [{ range: RANGE, text: "x" }, 1] }),
        ).resolves.toBe(true);
        expect(h.editorOptions.applyActiveEditorEdits).toHaveBeenCalledWith("file:///a.ts", [
            { range: RANGE, text: "x" },
        ]);
    });

    it("workspace.applyEdit: мусор — false без порта; валидный набор — вердикт порта", async () => {
        const h = setup();
        h.attachTo();
        await expect(h.peer.request("workspace.applyEdit", { ops: "x" })).resolves.toBe(false);
        expect(h.editorOptions.applyWorkspaceEdit).not.toHaveBeenCalled();
        const ops = [{ kind: "delete", resource: "file:///b.ts" }];
        await expect(h.peer.request("workspace.applyEdit", { ops })).resolves.toBe(true);
        expect(h.editorOptions.applyWorkspaceEdit).toHaveBeenCalledWith(ops);
    });

    async function expectFlushedReply(method: string, params: object, call: string, result: unknown): Promise<void> {
        const h = setup();
        h.attachTo();
        await expect(h.peer.request(method, params)).resolves.toEqual(result);
        expect(h.log).toEqual([[call, params], "flush"]);
        await expect(h.peer.request(method, null)).rejects.toThrow(`${method}: malformed params`);
        expect(h.log).toHaveLength(2);
    }

    it("editor.showTextDocument отвечает после флаша полосы; мусор — отказ", async () => {
        await expectFlushedReply("editor.showTextDocument", { uri: "file:///a.ts" }, "show", { viewColumn: 1 });
    });

    it("editor.closeTabs отвечает после флаша полосы; мусор — отказ", async () => {
        await expectFlushedReply(
            "editor.closeTabs",
            { tabs: [{ groupId: 1, uri: "file:///a.ts" }] },
            "closeTabs",
            true,
        );
    });

    it("editor.closeGroups отвечает после флаша полосы; мусор — отказ", async () => {
        await expectFlushedReply("editor.closeGroups", { groupIds: [1] }, "closeGroups", false);
    });
});

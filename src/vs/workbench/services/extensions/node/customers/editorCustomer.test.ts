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
const RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

function setup() {
    const log: unknown[] = [];
    const activeEditor = new Emitter<IActiveEditorMeta>();
    const selection = new Emitter<IActiveEditorSelections>();
    const layout = new Emitter<IWireEditorLayout>();
    const editorOptions = {
        getActiveEditorOptions: () => ({ tabSize: 4, insertSpaces: true }),
        setActiveEditorOptions: vi.fn(),
        setEditorCursorStyle: vi.fn(),
        getActiveEditorMeta: () => META,
        onActiveEditorChanged: (cb: (meta: IActiveEditorMeta) => void) => activeEditor.event(cb),
        onActiveEditorSelectionChanged: (cb: (s: IActiveEditorSelections) => void) => selection.event(cb),
        setActiveEditorSelections: vi.fn(),
        applyActiveEditorEdits: vi.fn(() => true),
        applyWorkspaceEdit: vi.fn(() => Promise.resolve(true)),
        saveAll: vi.fn(() => Promise.resolve(true)),
        save: vi.fn((uri: string) => Promise.resolve(uri === "file:///open.go" ? uri : null)),
    } as unknown as IEditorOptionsService;
    const editorLayout: IEditorLayoutService = {
        getLayoutSnapshot: () => LAYOUT,
        onDidChangeLayout: (cb) => layout.event(cb),
        flushPendingLayout: () => log.push("flush"),
        openTextDocument: () => Promise.resolve(null),
        showTextDocument: (params) => {
            log.push(["show", params]);
            return Promise.resolve({ viewColumn: 1 } as never);
        },
        closeTabs: (params) => {
            log.push(["closeTabs", params]);
            return Promise.resolve(true);
        },
        createUntitledDocument: (params) => {
            log.push(["createUntitled", params]);
            return { uri: "untitled:Untitled-1" };
        },
        getLanguages: () => [],
        getLanguageOfDocument: () => null,
        changeDocumentLanguage: () => ({ applied: false }),
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

describe("EditorCustomer — editor seeds and events", () => {
    it("seeds: the group strip, then the active editor — only to a live spawn", async () => {
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

    it("core events go to the subprocess; active editor meta flushes the strip first", async () => {
        const h = setup();
        const attached = h.attachTo();
        h.layout.fire(LAYOUT);
        h.activeEditor.fire(META);
        const selections = { uri: "file:///a.ts", selections: [SELECTION] } as unknown as IActiveEditorSelections;
        h.selection.fire(selections);
        await flushMicrotasks();
        // The flush is synchronous, notifications arrive later — but in send order.
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

describe("EditorCustomer — subprocess requests", () => {
    // No it.each: the mutation runner can't find names with `{}`/`"` by the name filter.
    it("editor.setOptions sanitizes the patch: positive integer sizes, indentSize is an alias, junk is dropped", async () => {
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
        // Infinity wouldn't survive a JSON channel; the in-process channel passes values as is.
        for (const [params] of cases) {
            await expect(h.peer.request("editor.setOptions", params)).resolves.toBeNull();
        }
        expect(vi.mocked(h.editorOptions.setActiveEditorOptions).mock.calls).toEqual(cases.map(([, patch]) => [patch]));
    });

    it("editor.setOptions: a cursorStyle of 1..6 goes to the editor at uri + groupId; junk is dropped", async () => {
        const h = setup();
        h.attachTo();
        const cases: readonly unknown[] = [
            { cursorStyle: 2, uri: "file:///a.ts", groupId: 7 },
            { cursorStyle: 6, uri: "file:///b.ts", groupId: 1, tabSize: 2 },
            { cursorStyle: 7, uri: "file:///a.ts", groupId: 7 },
            { cursorStyle: "2", uri: "file:///a.ts", groupId: 7 },
            { cursorStyle: 2, groupId: 7 },
            { cursorStyle: 2, uri: "file:///a.ts", groupId: "7" },
            { cursorStyle: 2, uri: "file:///a.ts" },
            null,
        ];
        for (const params of cases) {
            await expect(h.peer.request("editor.setOptions", params)).resolves.toBeNull();
        }
        expect(vi.mocked(h.editorOptions.setEditorCursorStyle).mock.calls).toEqual([
            ["file:///a.ts", 7, "block"],
            ["file:///b.ts", 1, "underline-thin"],
        ]);
    });

    it("editor.getOptions returns the active editor's options", async () => {
        const h = setup();
        h.attachTo();
        await expect(h.peer.request("editor.getOptions", undefined)).resolves.toEqual({
            tabSize: 4,
            insertSpaces: true,
        });
    });

    it("editor.setSelection: selections and group get through; without a string uri — ignored", async () => {
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

    it("editor.applyEdit: without a string uri — false; otherwise the core verdict with parsed edits", async () => {
        const h = setup();
        h.attachTo();
        await expect(h.peer.request("editor.applyEdit", { uri: null, edits: [] })).resolves.toBe(false);
        expect(h.editorOptions.applyActiveEditorEdits).not.toHaveBeenCalled();
        await expect(
            h.peer.request("editor.applyEdit", { uri: "file:///a.ts", edits: [{ range: RANGE, text: "x" }, 1] }),
        ).resolves.toBe(true);
        expect(h.editorOptions.applyActiveEditorEdits).toHaveBeenCalledWith(
            "file:///a.ts",
            [{ range: RANGE, text: "x" }],
            {},
        );
        await h.peer.request("editor.applyEdit", { uri: "file:///a.ts", edits: [], version: 4, setEndOfLine: 2 });
        expect(h.editorOptions.applyActiveEditorEdits).toHaveBeenLastCalledWith("file:///a.ts", [], {
            version: 4,
            setEndOfLine: 2,
        });
    });

    it("editor.applyEdit: what isn't a version or a line ending stays out of the options", async () => {
        const h = setup();
        h.attachTo();
        const options = async (params: Record<string, unknown>): Promise<unknown> => {
            await h.peer.request("editor.applyEdit", { uri: "file:///a.ts", edits: [], ...params });
            return vi.mocked(h.editorOptions.applyActiveEditorEdits).mock.lastCall?.[2];
        };
        await expect(options({ version: "4" })).resolves.toStrictEqual({});
        await expect(options({ setEndOfLine: 3 })).resolves.toStrictEqual({});
        await expect(options({ setEndOfLine: 1 })).resolves.toStrictEqual({ setEndOfLine: 1 });
        await expect(options({ setEndOfLine: 2 })).resolves.toStrictEqual({ setEndOfLine: 2 });
    });

    it("workspace.applyEdit: junk — false without the port; a valid set — the port verdict", async () => {
        const h = setup();
        h.attachTo();
        await expect(h.peer.request("workspace.applyEdit", { ops: "x" })).resolves.toBe(false);
        expect(h.editorOptions.applyWorkspaceEdit).not.toHaveBeenCalled();
        const ops = [{ kind: "delete", resource: "file:///b.ts" }];
        await expect(h.peer.request("workspace.applyEdit", { ops })).resolves.toBe(true);
        expect(h.editorOptions.applyWorkspaceEdit).toHaveBeenCalledWith(ops, { isRefactoring: false });
    });

    it("workspace.applyEdit: isRefactoring reaches the port; non-true is not a refactoring", async () => {
        const h = setup();
        h.attachTo();
        const ops = [{ kind: "delete", resource: "file:///b.ts" }];
        await h.peer.request("workspace.applyEdit", { ops, isRefactoring: true });
        expect(h.editorOptions.applyWorkspaceEdit).toHaveBeenLastCalledWith(ops, { isRefactoring: true });
        await h.peer.request("workspace.applyEdit", { ops, isRefactoring: "yes" } as never);
        expect(h.editorOptions.applyWorkspaceEdit).toHaveBeenLastCalledWith(ops, { isRefactoring: false });
    });

    it("workspace.saveAll: includeUntitled reaches the port only as true, the reply is the port verdict", async () => {
        const h = setup();
        h.attachTo();
        await expect(h.peer.request("workspace.saveAll", {})).resolves.toBe(true);
        expect(h.editorOptions.saveAll).toHaveBeenLastCalledWith(false);
        await h.peer.request("workspace.saveAll", { includeUntitled: true });
        expect(h.editorOptions.saveAll).toHaveBeenLastCalledWith(true);
        await h.peer.request("workspace.saveAll", { includeUntitled: "yes" } as never);
        expect(h.editorOptions.saveAll).toHaveBeenLastCalledWith(false);
    });

    it("workspace.save: the saved document's resource or null; junk — null without the port", async () => {
        const h = setup();
        h.attachTo();
        await expect(h.peer.request("workspace.save", { uri: "file:///open.go" })).resolves.toStrictEqual({
            uri: "file:///open.go",
        });
        await expect(h.peer.request("workspace.save", { uri: "file:///closed.go" })).resolves.toBeNull();
        expect(h.editorOptions.save).toHaveBeenCalledTimes(2);
        await expect(h.peer.request("workspace.save", { uri: 1 } as never)).resolves.toBeNull();
        expect(h.editorOptions.save).toHaveBeenCalledTimes(2);
    });

    async function expectFlushedReply(method: string, params: object, call: string, result: unknown): Promise<void> {
        const h = setup();
        h.attachTo();
        await expect(h.peer.request(method, params)).resolves.toEqual(result);
        expect(h.log).toEqual([[call, params], "flush"]);
        await expect(h.peer.request(method, null)).rejects.toThrow(`${method}: malformed params`);
        expect(h.log).toHaveLength(2);
    }

    it("editor.showTextDocument replies after the strip flush; junk — rejected", async () => {
        await expectFlushedReply("editor.showTextDocument", { uri: "file:///a.ts" }, "show", { viewColumn: 1 });
    });

    it("editor.closeTabs replies after the strip flush; junk — rejected", async () => {
        await expectFlushedReply(
            "editor.closeTabs",
            { tabs: [{ groupId: 1, uri: "file:///a.ts" }] },
            "closeTabs",
            true,
        );
    });

    it("editor.closeGroups replies after the strip flush; junk — rejected", async () => {
        await expectFlushedReply("editor.closeGroups", { groupIds: [1] }, "closeGroups", false);
    });

    it("workspace.createUntitledDocument: options reach the port, a malformed field is dropped", async () => {
        const h = setup();
        h.attachTo();
        await expect(
            h.peer.request("workspace.createUntitledDocument", {
                content: "x",
                language: 42,
                encoding: "utf8",
            } as never),
        ).resolves.toEqual({ uri: "untitled:Untitled-1" });
        await h.peer.request("workspace.createUntitledDocument", null as never);
        expect(h.log).toEqual([
            ["createUntitled", { content: "x", encoding: "utf8" }],
            ["createUntitled", {}],
        ]);
    });
});

describe("EditorCustomer — languages", () => {
    function attach() {
        const layout = {
            getLanguages: () => ["plaintext", "json"],
            getLanguageOfDocument: vi.fn(() => "json"),
            changeDocumentLanguage: vi.fn(() => ({ applied: true })),
            onDidChangeLayout: () => ({ dispose: () => undefined }),
        };
        const options = {
            onActiveEditorChanged: () => ({ dispose: () => undefined }),
            onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
        };
        const [hostChannel, peerChannel] = createInProcessChannelPair();
        new EditorCustomer(
            options as unknown as IEditorOptionsService,
            layout as unknown as IEditorLayoutService,
        ).attach({ rpc: new RpcEndpoint(hostChannel) } as never);
        return {
            layout,
            peer: new RpcEndpoint(peerChannel) as unknown as { request(m: string, p?: unknown): Promise<unknown> },
        };
    }

    it("languages.getLanguages answers with the layout service's list", async () => {
        const { peer } = attach();

        await expect(peer.request("languages.getLanguages")).resolves.toEqual(["plaintext", "json"]);
    });

    it("languages.getLanguageOfDocument wraps the answer", async () => {
        const { peer, layout } = attach();

        await expect(peer.request("languages.getLanguageOfDocument", { uri: "file:///a" })).resolves.toEqual({
            languageId: "json",
        });
        expect(layout.getLanguageOfDocument).toHaveBeenCalledWith("file:///a");
    });

    it("languages.changeLanguage passes uri and language on and returns the result", async () => {
        const { peer, layout } = attach();

        await expect(
            peer.request("languages.changeLanguage", { uri: "file:///a", languageId: "json" }),
        ).resolves.toEqual({ applied: true });
        expect(layout.changeDocumentLanguage).toHaveBeenCalledWith({ uri: "file:///a", languageId: "json" });
    });

    it.each([
        ["languages.getLanguageOfDocument", { uri: 1 }],
        ["languages.changeLanguage", { uri: 1, languageId: "json" }],
        ["languages.changeLanguage", { uri: "file:///a", languageId: 1 }],
    ])("%s refuses malformed params %#", async (method, params) => {
        const { peer, layout } = attach();

        await expect(peer.request(method, params)).rejects.toThrow("malformed params");
        expect(layout.changeDocumentLanguage).not.toHaveBeenCalled();
    });
});

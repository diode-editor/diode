import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import type { IBulkEditService } from "../../contrib/bulkEdit/common/iBulkEditService.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";

import { EditorOptionsServiceAdapter } from "./editorOptionsServiceAdapter.ts";
const NO_BULK_EDITS: IBulkEditService = { applyWorkspaceEdit: () => Promise.resolve(false) };

const GROUP_SURFACE = {
    groupOf: () => ({ id: 1 }),
    activeGroup: { id: 1 },
    viewColumnOf: () => 1,
    groups: [] as unknown[],
    getEditors: () => [] as unknown[],
};

function groupWithNoActiveEditor(): IEditorService {
    return {
        ...GROUP_SURFACE,
        getActiveTabEditor: () => null,
    } as unknown as IEditorService;
}

function createAdapter(fake: IEditorService, workspaceEdits: IBulkEditService): EditorOptionsServiceAdapter {
    return new EditorOptionsServiceAdapter(fake, fake as unknown as IEditorGroupsService, workspaceEdits);
}

describe("EditorOptionsServiceAdapter", () => {
    it("getActiveEditorOptions() returns null when there is no active editor (line 20)", () => {
        const adapter = createAdapter(groupWithNoActiveEditor(), NO_BULK_EDITS);
        expect(adapter.getActiveEditorOptions()).toBeNull();
    });

    it("getActiveEditorOptions() reads tabSize/insertSpaces from the active editor", () => {
        const group = {
            getActiveTabEditor: () => ({
                viewState: { tabSize: 4, insertSpaces: true },
            }),
        } as unknown as IEditorService;
        const adapter = createAdapter(group, NO_BULK_EDITS);
        expect(adapter.getActiveEditorOptions()).toEqual({ tabSize: 4, insertSpaces: true });
    });

    it("setActiveEditorOptions() is a no-op when there is no active editor", () => {
        const adapter = createAdapter(groupWithNoActiveEditor(), NO_BULK_EDITS);
        expect(() => {
            adapter.setActiveEditorOptions({ tabSize: 2 });
        }).not.toThrow();
    });

    it("setActiveEditorOptions() forwards the patch to the active editor", () => {
        const setIndentOptions = vi.fn();
        const group = {
            getActiveTabEditor: () => ({ setIndentOptions }),
        } as unknown as IEditorService;
        const adapter = createAdapter(group, NO_BULK_EDITS);
        adapter.setActiveEditorOptions({ tabSize: 8 });
        expect(setIndentOptions).toHaveBeenCalledWith({ tabSize: 8 });
    });

    it("getActiveEditorFilePath() returns null when there is no active editor", () => {
        const adapter = createAdapter(groupWithNoActiveEditor(), NO_BULK_EDITS);
        expect(adapter.getActiveEditorFilePath()).toBeNull();
    });

    it("getActiveEditorFilePath() returns the path for a file: resource", () => {
        const group = {
            getActiveTabEditor: () => ({ uri: Uri.file("/a/b.ts"), languageId: "typescript", isModified: false }),
        } as unknown as IEditorService;
        expect(createAdapter(group, NO_BULK_EDITS).getActiveEditorFilePath()).toBe("/a/b.ts");
    });

    it("getActiveEditorFilePath() returns null for an untitled buffer, not a garbage path", () => {
        const group = {
            getActiveTabEditor: () => ({
                uri: Uri.parse("untitled:Untitled-1"),
                languageId: "plaintext",
                isModified: false,
                isDirtyForExtensions: false,
            }),
        } as unknown as IEditorService;
        expect(createAdapter(group, NO_BULK_EDITS).getActiveEditorFilePath()).toBeNull();
    });

    it("getActiveEditorMeta() reports uri/languageId/isDirty (nulls when no editor)", () => {
        const withEditor = {
            ...GROUP_SURFACE,
            getActiveTabEditor: () => ({
                uri: Uri.file("/a/b.ts"),
                languageId: "typescript",
                isModified: true,
                isDirtyForExtensions: true,
                encoding: "windows1251",
                eol: 2,
                viewState: { selections: [] },
            }),
        } as unknown as IEditorService;
        expect(createAdapter(withEditor, NO_BULK_EDITS).getActiveEditorMeta()).toEqual({
            uri: Uri.file("/a/b.ts").toString(),
            languageId: "typescript",
            isDirty: true,
            encoding: "windows1251",
            eol: 2,
            selection: null,
            groupId: 1,
            viewColumn: 1,
        });
        expect(createAdapter(groupWithNoActiveEditor(), NO_BULK_EDITS).getActiveEditorMeta()).toEqual({
            uri: null,
            languageId: null,
            isDirty: false,
            encoding: null,
            eol: null,
            selection: null,
        });
    });

    it("onActiveEditorChanged() forwards active-editor meta, and nulls when there is no editor", () => {
        let registered: ((editor: unknown) => void) | undefined;
        const groupDisposable = { dispose: vi.fn() };
        const group = {
            ...GROUP_SURFACE,
            onActiveEditorChanged: (cb: (editor: unknown) => void) => {
                registered = cb;
                return groupDisposable;
            },
        } as unknown as IEditorService;
        const adapter = createAdapter(group, NO_BULK_EDITS);

        const received: unknown[] = [];
        const subscription = adapter.onActiveEditorChanged((meta) => received.push(meta));

        expect(subscription).toBe(groupDisposable);
        expect(registered).toBeDefined();

        registered!({
            uri: Uri.file("/a/b.ts"),
            languageId: "typescript",
            isModified: false,
            isDirtyForExtensions: false,
            encoding: "utf8",
            eol: 1,
            viewState: {
                selections: [{ anchor: { line: 0, character: 2 }, active: { line: 1, character: 4 } }],
            },
        });
        registered!(null);

        expect(received).toEqual([
            {
                uri: Uri.file("/a/b.ts").toString(),
                languageId: "typescript",
                isDirty: false,
                encoding: "utf8",
                eol: 1,
                selection: { anchorLine: 0, anchorCharacter: 2, activeLine: 1, activeCharacter: 4 },
                groupId: 1,
                viewColumn: 1,
            },
            { uri: null, languageId: null, isDirty: false, encoding: null, eol: null, selection: null },
        ]);
    });

    it("setActiveEditorSelections() is a no-op on uri mismatch", () => {
        const setSelections = vi.fn();
        const group = {
            getActiveTabEditor: () => ({
                uri: Uri.file("/a/b.ts"),
                get viewState() {
                    return {
                        get selections() {
                            return [];
                        },
                        set selections(v: unknown) {
                            setSelections(v);
                        },
                    };
                },
                focusEditor: vi.fn(),
            }),
        } as unknown as IEditorService;
        const adapter = createAdapter(group, NO_BULK_EDITS);
        adapter.setActiveEditorSelections(Uri.file("/other.ts").toString(), [
            { anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 1 },
        ]);
        expect(setSelections).not.toHaveBeenCalled();
    });

    it("applyActiveEditorEdits() with only a line ending changes it and makes no edit step", () => {
        const applyExternalEdits = vi.fn();
        const setEol = vi.fn();
        const editor = {
            uri: Uri.file("/a/b.ts"),
            model: { document: { lineCount: 3, getLineLength: () => 10, versionId: 1 } },
            applyExternalEdits,
            setEol,
        };
        const group = { ...GROUP_SURFACE, getActiveTabEditor: () => editor } as unknown as IEditorService;
        const adapter = createAdapter(group, NO_BULK_EDITS);

        expect(adapter.applyActiveEditorEdits(Uri.file("/a/b.ts").toString(), [], { setEndOfLine: 2 })).toBe(true);

        expect(applyExternalEdits).not.toHaveBeenCalled();
        expect(setEol).toHaveBeenCalledExactlyOnceWith(2);
    });

    it("applyActiveEditorEdits() returns false on uri mismatch, true when applied", () => {
        const applyExternalEdits = vi.fn();
        const editor = {
            uri: Uri.file("/a/b.ts"),
            model: { document: { lineCount: 3, getLineLength: () => 10 } },
            applyExternalEdits,
        };
        const group = { ...GROUP_SURFACE, getActiveTabEditor: () => editor } as unknown as IEditorService;
        const adapter = createAdapter(group, NO_BULK_EDITS);

        const edit = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "hi" };
        expect(adapter.applyActiveEditorEdits(Uri.file("/other.ts").toString(), [edit])).toBe(false);
        expect(applyExternalEdits).not.toHaveBeenCalled();

        expect(adapter.applyActiveEditorEdits(Uri.file("/a/b.ts").toString(), [edit])).toBe(true);
        expect(applyExternalEdits).toHaveBeenCalledExactlyOnceWith(
            [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "hi" }],
            "extension edit",
            undefined,
            {},
        );
    });

    it("applyActiveEditorEdits() returns false on overlapping edits, document untouched", () => {
        const applyExternalEdits = vi.fn();
        const editor = {
            uri: Uri.file("/a/b.ts"),
            model: { document: { lineCount: 3, getLineLength: () => 10 } },
            applyExternalEdits,
        };
        const group = { ...GROUP_SURFACE, getActiveTabEditor: () => editor } as unknown as IEditorService;
        const adapter = createAdapter(group, NO_BULK_EDITS);

        const overlapping = [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, text: "x" },
            { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 8 } }, text: "y" },
        ];
        expect(adapter.applyActiveEditorEdits(Uri.file("/a/b.ts").toString(), overlapping)).toBe(false);
        expect(applyExternalEdits).not.toHaveBeenCalled();
    });

    it("applyActiveEditorEdits() returns false with no active editor or an empty list", () => {
        const editor = {
            uri: Uri.file("/a/b.ts"),
            model: { document: { lineCount: 3, getLineLength: () => 10 } },
            applyExternalEdits: vi.fn(),
        };
        const group = { ...GROUP_SURFACE, getActiveTabEditor: () => editor } as unknown as IEditorService;
        const adapter = createAdapter(group, NO_BULK_EDITS);
        expect(adapter.applyActiveEditorEdits(Uri.file("/a/b.ts").toString(), [])).toBe(false);
        expect(() => {
            createAdapter(groupWithNoActiveEditor(), NO_BULK_EDITS).setActiveEditorSelections("x", []);
        }).not.toThrow();
    });

    it("clamps selections and edits to document bounds", () => {
        let setSel: unknown;
        const applyExternalEdits = vi.fn();
        const editor = {
            uri: Uri.file("/a/b.ts"),
            model: { document: { lineCount: 3, getLineLength: () => 10 } },
            get viewState() {
                return {
                    get selections() {
                        return [];
                    },
                    set selections(v: unknown) {
                        setSel = v;
                    },
                };
            },
            focusEditor: vi.fn(),
            applyExternalEdits,
        };
        const group = { ...GROUP_SURFACE, getActiveTabEditor: () => editor } as unknown as IEditorService;
        const adapter = createAdapter(group, NO_BULK_EDITS);
        const uri = Uri.file("/a/b.ts").toString();

        // anchor out of bounds below/left, active out of bounds above/right.
        adapter.setActiveEditorSelections(uri, [
            { anchorLine: -5, anchorCharacter: -3, activeLine: 99, activeCharacter: 999 },
        ]);
        expect(setSel).toEqual([
            { anchor: { line: 0, character: 0 }, active: { line: 2, character: 10 }, idealColumn: undefined },
        ]);

        adapter.applyActiveEditorEdits(uri, [
            { range: { start: { line: -1, character: -1 }, end: { line: 50, character: 50 } }, text: "z" },
        ]);
        const applied: unknown = applyExternalEdits.mock.calls[0][0];
        expect(applied).toEqual([
            { range: { start: { line: 0, character: 0 }, end: { line: 2, character: 10 } }, text: "z" },
        ]);
    });

    // #194: without a producer of `editor.selectionChanged`, the extension's `activeTextEditor.selection`
    // stays stuck forever at the moment the file was opened.

    /** Assigning `viewState.selections` fires the event, like the live IEditorService, for the echo guard. */
    function groupWithLiveSelections(): { group: IEditorService; selections: () => unknown[] } {
        const listeners: (() => void)[] = [];
        let current: unknown[] = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }];
        const editor = {
            uri: Uri.file("/a/b.ts"),
            model: { document: { lineCount: 10, getLineLength: () => 20 } },
            focusEditor: vi.fn(),
            viewState: {
                get selections(): unknown[] {
                    return current;
                },
                set selections(v: unknown[]) {
                    current = v;
                    for (const cb of [...listeners]) cb();
                },
            },
        };
        const group = {
            ...GROUP_SURFACE,
            getActiveTabEditor: () => editor,
            onDidChangeInactiveEditorSelection: () => ({ dispose: () => undefined }),
            onDidChangeActiveEditorSelection: (cb: (e: unknown) => void) => {
                const wrapped = (): void => {
                    cb(editor);
                };
                listeners.push(wrapped);
                return {
                    dispose: () => {
                        listeners.splice(listeners.indexOf(wrapped), 1);
                    },
                };
            },
        } as unknown as IEditorService;
        return { group, selections: () => current };
    }

    it("onActiveEditorSelectionChanged() sends the active editor's selections", async () => {
        const { group } = groupWithLiveSelections();
        const adapter = createAdapter(group, NO_BULK_EDITS);
        const seen: unknown[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        group.getActiveTabEditor()!.viewState.selections = [
            { anchor: { line: 3, character: 1 }, active: { line: 3, character: 5 } },
        ] as never;
        await Promise.resolve();

        expect(seen).toEqual([
            {
                uri: Uri.file("/a/b.ts").toString(),
                selections: [{ anchorLine: 3, anchorCharacter: 1, activeLine: 3, activeCharacter: 5 }],
                groupId: 1,
            },
        ]);
    });

    it("onActiveEditorSelectionChanged() coalesces several changes into one notification", async () => {
        const { group } = groupWithLiveSelections();
        const adapter = createAdapter(group, NO_BULK_EDITS);
        const seen: unknown[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        const viewState = group.getActiveTabEditor()!.viewState;
        viewState.selections = [{ anchor: { line: 1, character: 0 }, active: { line: 1, character: 0 } }] as never;
        viewState.selections = [{ anchor: { line: 2, character: 0 }, active: { line: 2, character: 0 } }] as never;
        viewState.selections = [{ anchor: { line: 4, character: 0 }, active: { line: 4, character: 2 } }] as never;
        await Promise.resolve();

        expect(seen).toHaveLength(1);
        expect((seen[0] as { selections: { activeLine: number }[] }).selections[0].activeLine).toBe(4);
    });

    it("a selection set by the extension itself comes back as a Command change, as upstream", async () => {
        const { group, selections } = groupWithLiveSelections();
        const adapter = createAdapter(group, NO_BULK_EDITS);
        const seen: { kind?: number }[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        adapter.setActiveEditorSelections(Uri.file("/a/b.ts").toString(), [
            { anchorLine: 1, anchorCharacter: 0, activeLine: 1, activeCharacter: 3 },
        ]);
        await Promise.resolve();

        expect(selections()).toHaveLength(1);
        expect(seen.map((s) => s.kind)).toEqual([3]);
    });

    it("if the active editor vanished within the tick, sends the selections of the event's source", async () => {
        const { group } = groupWithLiveSelections();
        const editor = group.getActiveTabEditor()!;
        const adapter = createAdapter(group, NO_BULK_EDITS);
        const seen: { uri: string }[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        editor.viewState.selections = [
            { anchor: { line: 2, character: 0 }, active: { line: 2, character: 1 } },
        ] as never;
        // The tab was closed within the same tick while the notification waited for the flush.
        (group as unknown as { getActiveTabEditor: () => null }).getActiveTabEditor = () => null;
        await Promise.resolve();

        expect(seen).toHaveLength(1);
        expect(seen[0].uri).toBe(Uri.file("/a/b.ts").toString());
    });

    it("onActiveEditorSelectionChanged() is removed on dispose", async () => {
        const { group } = groupWithLiveSelections();
        const adapter = createAdapter(group, NO_BULK_EDITS);
        const seen: unknown[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s)).dispose();

        group.getActiveTabEditor()!.viewState.selections = [
            { anchor: { line: 3, character: 1 }, active: { line: 3, character: 5 } },
        ] as never;
        await Promise.resolve();

        expect(seen).toHaveLength(0);
    });

    it("tab outside the strip (groupOf -> null): groupId falls back to the active group", async () => {
        // The tab got closed while the notification waited for the microtask flush: its
        // group is gone, and the meta/notification carry the active group's coordinate.
        const listeners: (() => void)[] = [];
        const editor = {
            uri: Uri.file("/a/b.ts"),
            languageId: "typescript",
            isModified: false,
            isDirtyForExtensions: false,
            encoding: "utf8",
            eol: 1,
            viewState: { selections: [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 1 } }] },
        };
        const group = {
            ...GROUP_SURFACE,
            groupOf: () => null,
            activeGroup: { id: 7 },
            viewColumnOf: () => 2,
            getActiveTabEditor: () => editor,
            onDidChangeInactiveEditorSelection: () => ({ dispose: () => undefined }),
            onDidChangeActiveEditorSelection: (cb: (e: unknown) => void) => {
                listeners.push(() => {
                    cb(editor);
                });
                return { dispose: () => undefined };
            },
        } as unknown as IEditorService;
        const adapter = createAdapter(group, NO_BULK_EDITS);

        expect(adapter.getActiveEditorMeta()).toMatchObject({ groupId: 7, viewColumn: 2 });

        const seen: { groupId?: number }[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));
        for (const fire of listeners) fire();
        await Promise.resolve();
        expect(seen).toEqual([
            {
                uri: Uri.file("/a/b.ts").toString(),
                selections: [{ anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 1 }],
                groupId: 7,
            },
        ]);
    });

    it("getActiveEditorMeta(): selection is null when there are no selections", () => {
        const group = {
            ...GROUP_SURFACE,
            getActiveTabEditor: () => ({
                uri: Uri.file("/a/b.ts"),
                languageId: "typescript",
                isModified: false,
                isDirtyForExtensions: false,
                encoding: "utf8",
                eol: 1,
                viewState: { selections: [] },
            }),
        } as unknown as IEditorService;
        expect(createAdapter(group, NO_BULK_EDITS).getActiveEditorMeta().selection).toBeNull();
    });
});

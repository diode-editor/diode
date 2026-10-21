import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { type CursorChangeSource, withCursorChangeSource } from "../../../editor/common/core/cursorChangeSource.ts";
import type { IBulkEditService } from "../../contrib/bulkEdit/common/iBulkEditService.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IActiveEditorSelections } from "../common/iEditorOptionsService.ts";

import { EditorOptionsServiceAdapter } from "./editorOptionsServiceAdapter.ts";
const NO_BULK_EDITS: IBulkEditService = { applyWorkspaceEdit: () => Promise.resolve(false) };

// `kind` is captured synchronously in the handler, while the notification goes out on the tick:
// without synchronous capture it would always be undefined.

function liveGroup(): { group: IEditorService; move: (character: number) => void } {
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
        groupOf: () => ({ id: 1 }),
        activeGroup: { id: 1 },
        viewColumnOf: () => 1,
        groups: [] as unknown[],
        getEditors: () => [] as unknown[],
        getActiveTabEditor: () => editor,
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
    return {
        group,
        move: (character) => {
            editor.viewState.selections = [{ anchor: { line: 0, character }, active: { line: 0, character } }] as never;
        },
    };
}

async function notifiedFor(source: CursorChangeSource | undefined): Promise<IActiveEditorSelections> {
    const { group, move } = liveGroup();
    const adapter = createAdapter(group, NO_BULK_EDITS);
    const seen: IActiveEditorSelections[] = [];
    adapter.onActiveEditorSelectionChanged((s) => seen.push(s));
    if (source === undefined) move(3);
    else
        withCursorChangeSource(source, () => {
            move(3);
        });
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    return seen[0];
}

function createAdapter(fake: IEditorService, workspaceEdits: IBulkEditService): EditorOptionsServiceAdapter {
    return new EditorOptionsServiceAdapter(fake, fake as unknown as IEditorGroupsService, workspaceEdits);
}

describe("EditorOptionsServiceAdapter — kind in editor.selectionChanged", () => {
    it("keyboard gesture is sent as kind 1", async () => {
        expect((await notifiedFor("keyboard")).kind).toBe(1);
    });

    it("mouse gesture is sent as kind 2", async () => {
        expect((await notifiedFor("mouse")).kind).toBe(2);
    });

    it("command is sent as kind 3", async () => {
        expect((await notifiedFor("command")).kind).toBe(3);
    });

    it("untagged gesture (undo, find) is sent without a kind field", async () => {
        const payload = await notifiedFor(undefined);
        expect(payload.kind).toBeUndefined();
        expect("kind" in payload).toBe(false);
    });

    it("source is cleared synchronously: the scope is closed by the deferred flush", async () => {
        const { group, move } = liveGroup();
        const adapter = createAdapter(group, NO_BULK_EDITS);
        const seen: IActiveEditorSelections[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        withCursorChangeSource("mouse", () => {
            move(2);
        });
        // The scope closes right here; the notification has not gone out yet.
        expect(seen).toHaveLength(0);
        await Promise.resolve();
        expect(seen[0]?.kind).toBe(2);
    });

    it("in a coalesced tick the LAST source wins, as it authored the final selections", async () => {
        const { group, move } = liveGroup();
        const adapter = createAdapter(group, NO_BULK_EDITS);
        const seen: IActiveEditorSelections[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        withCursorChangeSource("keyboard", () => {
            move(2);
        });
        withCursorChangeSource("mouse", () => {
            move(5);
        });
        await Promise.resolve();

        expect(seen).toHaveLength(1);
        expect(seen[0].kind).toBe(2);
        expect(seen[0].selections[0].activeCharacter).toBe(5);
    });

    it("source does not leak into the next tick", async () => {
        const { group, move } = liveGroup();
        const adapter = createAdapter(group, NO_BULK_EDITS);
        const seen: IActiveEditorSelections[] = [];
        adapter.onActiveEditorSelectionChanged((s) => seen.push(s));

        withCursorChangeSource("mouse", () => {
            move(1);
        });
        await Promise.resolve();
        move(4);
        await Promise.resolve();

        expect(seen.map((s) => s.kind)).toEqual([2, undefined]);
    });
});

import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit, type ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { TrashService } from "../../../../platform/files/node/trashService.ts";
import type { IUndoRedoElement } from "../../../../platform/undoRedo/common/iUndoRedoElement.ts";
import { UndoRedoService, WORKSPACE_UNDO_CONTEXT } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { BulkEditTarget, IBulkEditBuffers } from "../common/iBulkEditBuffers.ts";
import { NULL_BULK_EDIT_BUFFERS } from "../common/iBulkEditBuffers.ts";
import type { BulkEditOperation } from "../common/workspaceEdit.ts";

import { WorkspaceEditService } from "./workspaceEditService.ts";

let tmpDir: string;
let ws: ITempWorkspace;
let savedXdg: string | undefined;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-wes-bulk-" });
    tmpDir = ws.dir;
    savedXdg = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = path.join(tmpDir, "data");
});

afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    ws.dispose();
});

const NO_TRASH: IConfigurationService = {
    ...NULL_CONFIGURATION_SERVICE,
    get<T>(key: string, def?: T): T | undefined {
        return key === "files.enableTrash" ? (false as unknown as T) : def;
    },
};

interface IFakeBuffer {
    text: string;
    readonly applied: ITextEdit[][];
    step: IUndoRedoElement | null;
}

function makeBuffers(open: Map<string, IFakeBuffer>, readOnly = new Set<string>()): IBulkEditBuffers {
    return {
        get: (resource): BulkEditTarget => {
            if (readOnly.has(resource)) return "read-only";
            const buffer = open.get(resource);
            if (buffer === undefined) return null;
            return {
                text: () => buffer.text,
                applyEdits: (edits) => {
                    buffer.applied.push([...edits]);
                    buffer.text = applyToText(buffer.text, edits);
                    return buffer.step;
                },
                save: () => Promise.resolve(),
            };
        },
        // Only the first touched buffer is a participant: this tests the edit itself;
        // a history step across several buffers — workspaceEditService.undoAcrossFiles.test.ts.
        undoParticipants: (touched) =>
            touched.length > 0 ? [{ context: `buffer:${touched[0]}`, label: touched[0], owner: true }] : [],
        didDelete: NULL_BULK_EDIT_BUFFERS.didDelete,
    };
}

function applyToText(text: string, edits: readonly ITextEdit[]): string {
    const lines = text.split("\n");
    for (const edit of [...edits].reverse()) {
        const before = lines[edit.range.start.line].slice(0, edit.range.start.character);
        const after = lines[edit.range.end.line].slice(edit.range.end.character);
        lines.splice(
            edit.range.start.line,
            edit.range.end.line - edit.range.start.line + 1,
            before + edit.text + after,
        );
    }
    return lines.join("\n");
}

function makeService(buffers: IBulkEditBuffers = NULL_BULK_EDIT_BUFFERS): {
    service: WorkspaceEditService;
    undoRedo: UndoRedoService;
} {
    const undoRedo = new UndoRedoService();
    return {
        service: new WorkspaceEditService(undoRedo, new TrashService(), NO_TRASH, buffers, diskFileService()),
        undoRedo,
    };
}

/** With a working trash (moved to tmp via `XDG_DATA_HOME`): deleting a nonexistent file is an error. */
function makeServiceWithTrash(): { service: WorkspaceEditService; undoRedo: UndoRedoService } {
    const undoRedo = new UndoRedoService();
    const config: IConfigurationService = {
        ...NULL_CONFIGURATION_SERVICE,
        get<T>(key: string, def?: T): T | undefined {
            return key === "files.enableTrash" ? (true as unknown as T) : def;
        },
    };
    return {
        service: new WorkspaceEditService(
            undoRedo,
            new TrashService(),
            config,
            NULL_BULK_EDIT_BUFFERS,
            diskFileService(),
        ),
        undoRedo,
    };
}

function write(rel: string, content: string): string {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
}

function read(full: string): string {
    return fs.readFileSync(full, "utf8");
}

function resourceOf(full: string): string {
    return Uri.file(full).toString();
}

function textEdit(full: string, ...edits: ITextEdit[]): BulkEditOperation {
    return { resource: resourceOf(full), edits };
}

const replaceFirstLine = (text: string): ITextEdit => createTextEdit(createRange(0, 0, 0, 0), text);

describe("WorkspaceEditService.applyWorkspaceEdit — closed files", () => {
    it("edits a file not open in any tab directly on disk", async () => {
        const { service } = makeService();
        const closed = write("b.ts", "export class B {}\n");

        const applied = await service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("// head\n"))], "Edit");

        expect(applied).toBe(true);
        expect(read(closed)).toBe("// head\nexport class B {}\n");
    });

    it("clamps extension coordinates to the closed file's contents", async () => {
        const { service } = makeService();
        const closed = write("b.ts", "one\ntwo\n");

        // The extension knows nothing about our text: a position past the end of the document
        // must be clamped to its boundary, not crash the apply.
        await service.applyWorkspaceEdit([textEdit(closed, createTextEdit(createRange(99, 99, 99, 99), "!"))], "Edit");

        expect(read(closed)).toBe("one\ntwo\n!");
    });

    it("keeps the closed file's EOL (the edit does not turn CRLF into LF)", async () => {
        const { service } = makeService();
        const closed = write("b.ts", "one\r\ntwo\r\n");

        // Edit text comes in document lines (`\n`); back to disk
        // the document is written with its own EOL.
        await service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("zero\n"))], "Edit");

        expect(read(closed)).toBe("zero\r\none\r\ntwo\r\n");
    });

    it("edits of one resource from DIFFERENT operations combine in the original coordinates", async () => {
        const { service } = makeService();
        const closed = write("b.ts", "alpha\nbeta\n");

        const applied = await service.applyWorkspaceEdit(
            [
                textEdit(closed, createTextEdit(createRange(0, 0, 0, 5), "ALPHA")),
                textEdit(closed, createTextEdit(createRange(1, 0, 1, 4), "BETA")),
            ],
            "Edit",
        );

        expect(applied).toBe(true);
        expect(read(closed)).toBe("ALPHA\nBETA\n");
    });

    it("undo restores the closed file's previous contents, redo the new ones", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");

        await service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("after\n"))], "Edit");
        expect(read(closed)).toBe("after\nbefore\n");

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(closed)).toBe("before\n");
        expect(await undoRedo.redo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(closed)).toBe("after\nbefore\n");
    });

    it("undo refuses if the file was changed externally: someone else's edit is not overwritten", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");
        await service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("after\n"))], "Edit");

        fs.writeFileSync(closed, "written by someone else\n");

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(read(closed)).toBe("written by someone else\n");
        // The step stays on the stack: it becomes undoable again if the contents are restored.
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
    });

    it("the history step lists the touched paths", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");

        await service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("after\n"))], "Edit");

        expect(undoRedo.peekUndo(WORKSPACE_UNDO_CONTEXT)?.resources).toEqual([closed]);
    });

    it("undo refuses (rather than crashing) if the file was deleted externally", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");
        await service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("after\n"))], "Edit");

        fs.rmSync(closed);

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(fs.existsSync(closed)).toBe(false);
    });

    it("redo refuses if the file was changed externally after undo", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");
        await service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("after\n"))], "Edit");
        await undoRedo.undo(WORKSPACE_UNDO_CONTEXT);

        fs.writeFileSync(closed, "someone else\n");

        expect(await undoRedo.redo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(read(closed)).toBe("someone else\n");
    });

    it("redo refuses (rather than crashing) if the file was deleted externally after undo", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");
        await service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("after\n"))], "Edit");
        await undoRedo.undo(WORKSPACE_UNDO_CONTEXT);

        fs.rmSync(closed);

        expect(await undoRedo.redo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(fs.existsSync(closed)).toBe(false);
    });

    it("an unreadable resource refuses the WHOLE edit — the sibling file is untouched", async () => {
        const { service, undoRedo } = makeService();
        const existing = write("a.ts", "keep\n");

        const applied = await service.applyWorkspaceEdit(
            [
                textEdit(existing, replaceFirstLine("changed\n")),
                textEdit(path.join(tmpDir, "missing.ts"), replaceFirstLine("x\n")),
            ],
            "Edit",
        );

        expect(applied).toBe(false);
        expect(read(existing)).toBe("keep\n");
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });

    it("a closed resource with a non-disk scheme refuses the edit (nowhere to write it)", async () => {
        const { service } = makeService();
        const applied = await service.applyWorkspaceEdit(
            [{ resource: "output:extensions", edits: [replaceFirstLine("x")] }],
            "Edit",
        );
        expect(applied).toBe(false);
    });

    it("a foreign scheme is not turned into a path: the file at the same path is untouched", async () => {
        const { service } = makeService();
        const victim = write("victim.ts", "mine\n");

        // `probe:/tmp/.../victim.ts` has a path pointing to a REAL file. The scheme
        // decides, not the derived path — otherwise the edit would go to an unrelated file.
        const applied = await service.applyWorkspaceEdit(
            [{ resource: `probe:${victim}`, edits: [replaceFirstLine("theirs\n")] }],
            "Edit",
        );

        expect(applied).toBe(false);
        expect(read(victim)).toBe("mine\n");
    });

    it("overlapping edits of one resource refuse the whole edit", async () => {
        const { service } = makeService();
        const a = write("a.ts", "keep\n");
        const b = write("b.ts", "0123456789\n");

        const applied = await service.applyWorkspaceEdit(
            [
                textEdit(a, replaceFirstLine("changed\n")),
                textEdit(b, createTextEdit(createRange(0, 0, 0, 4), "x"), createTextEdit(createRange(0, 2, 0, 6), "y")),
            ],
            "Edit",
        );

        expect(applied).toBe(false);
        expect(read(a)).toBe("keep\n");
        expect(read(b)).toBe("0123456789\n");
    });

    it("adjacent edits and two inserts at one point do not count as overlapping", async () => {
        const { service } = makeService();
        const b = write("b.ts", "0123456789\n");

        const applied = await service.applyWorkspaceEdit(
            [
                textEdit(
                    b,
                    createTextEdit(createRange(0, 0, 0, 2), "x"),
                    createTextEdit(createRange(0, 2, 0, 4), "y"),
                    createTextEdit(createRange(0, 6, 0, 6), "p"),
                    createTextEdit(createRange(0, 6, 0, 6), "q"),
                ),
            ],
            "Edit",
        );

        expect(applied).toBe(true);
        expect(read(b)).toBe("xy45pq6789\n");
    });

    it("an empty list is false: vacuous success is the caller's call", async () => {
        const { service } = makeService();
        expect(await service.applyWorkspaceEdit([], "Edit")).toBe(false);
    });

    it("operations without a single edit succeed without changes (nothing to change, but no refusal)", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "x\n");
        expect(await service.applyWorkspaceEdit([{ resource: resourceOf(closed), edits: [] }], "Edit")).toBe(true);
        expect(read(closed)).toBe("x\n");
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });
});

describe("WorkspaceEditService.applyWorkspaceEdit — open buffers", async () => {
    it("an open resource is edited through the buffer, not by writing to disk", async () => {
        const open = new Map<string, IFakeBuffer>();
        const file = write("a.ts", "disk\n");
        const step: IUndoRedoElement = { label: "buffer", resources: [], undo: vi.fn(), redo: vi.fn() };
        open.set(resourceOf(file), { text: "buffer\n", applied: [], step });
        const { service, undoRedo } = makeService(makeBuffers(open));

        const applied = await service.applyWorkspaceEdit([textEdit(file, replaceFirstLine("head\n"))], "Edit");

        expect(applied).toBe(true);
        // Disk untouched: the edit lives in a "dirty" buffer, as in VS Code.
        expect(read(file)).toBe("disk\n");
        expect(open.get(resourceOf(file))?.applied).toEqual([
            [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "head\n" }],
        ]);
        expect(undoRedo.canUndo(`buffer:${resourceOf(file)}`)).toBe(true);
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });

    it("coordinates are clamped to the BUFFER text, not the file on disk", async () => {
        const open = new Map<string, IFakeBuffer>();
        const file = write("a.ts", "0123456789\n");
        open.set(resourceOf(file), { text: "ab", applied: [], step: null });
        const { service } = makeService(makeBuffers(open));

        await service.applyWorkspaceEdit([textEdit(file, createTextEdit(createRange(0, 9, 0, 9), "!"))], "Edit");

        expect(open.get(resourceOf(file))?.applied[0][0].range.start).toEqual({ line: 0, character: 2 });
    });

    it("a read-only resource refuses the whole edit — the sibling buffer is untouched", async () => {
        const open = new Map<string, IFakeBuffer>();
        const a = write("a.ts", "a\n");
        const ro = write("ro.ts", "ro\n");
        open.set(resourceOf(a), { text: "a\n", applied: [], step: null });
        const { service } = makeService(makeBuffers(open, new Set([resourceOf(ro)])));

        const applied = await service.applyWorkspaceEdit(
            [textEdit(a, replaceFirstLine("x")), textEdit(ro, replaceFirstLine("y"))],
            "Edit",
        );

        expect(applied).toBe(false);
        expect(open.get(resourceOf(a))?.applied).toEqual([]);
        expect(read(ro)).toBe("ro\n");
    });

    it("a buffer whose edits changed nothing does not cancel the edit — there is just no step", async () => {
        const open = new Map<string, IFakeBuffer>();
        const a = write("a.ts", "a\n");
        open.set(resourceOf(a), { text: "a\n", applied: [], step: null });
        const { service, undoRedo } = makeService(makeBuffers(open));

        expect(await service.applyWorkspaceEdit([textEdit(a, replaceFirstLine(""))], "Edit")).toBe(true);
        expect(undoRedo.canUndo(`buffer:${resourceOf(a)}`)).toBe(false);
    });

    it("a mixed edit: open buffer + closed file is ONE undo step for both", async () => {
        const open = new Map<string, IFakeBuffer>();
        const a = write("a.ts", "disk-a\n");
        const closed = write("b.ts", "before\n");
        const undo = vi.fn();
        const redo = vi.fn();
        open.set(resourceOf(a), { text: "buf-a\n", applied: [], step: { label: "b", resources: [], undo, redo } });
        const { service, undoRedo } = makeService(makeBuffers(open));

        const applied = await service.applyWorkspaceEdit(
            [textEdit(a, replaceFirstLine("head\n")), textEdit(closed, replaceFirstLine("after\n"))],
            "Refactor",
        );

        expect(applied).toBe(true);
        expect(read(closed)).toBe("after\nbefore\n");
        const context = `buffer:${resourceOf(a)}`;
        expect(undoRedo.peekUndo(context)?.label).toBe("Refactor");

        expect(await undoRedo.undo(context)).toBe(true);
        expect(undo).toHaveBeenCalledOnce();
        expect(read(closed)).toBe("before\n");
        expect(undoRedo.canUndo(context)).toBe(false);

        expect(await undoRedo.redo(context)).toBe(true);
        expect(redo).toHaveBeenCalledOnce();
        expect(read(closed)).toBe("after\nbefore\n");
    });

    it("a refusal from one participant cancels the WHOLE undo step, not part of it", async () => {
        const open = new Map<string, IFakeBuffer>();
        const a = write("a.ts", "disk-a\n");
        const closed = write("b.ts", "before\n");
        const undo = vi.fn();
        // The buffer says "my step can't be undone now" (text was typed in it
        // after the edit) — the file on disk must stay as is too.
        open.set(resourceOf(a), {
            text: "buf-a\n",
            applied: [],
            step: { label: "b", resources: [], canUndo: () => false, undo, redo: vi.fn() },
        });
        const { service, undoRedo } = makeService(makeBuffers(open));
        await service.applyWorkspaceEdit(
            [textEdit(a, replaceFirstLine("head\n")), textEdit(closed, replaceFirstLine("after\n"))],
            "Refactor",
        );

        const context = `buffer:${resourceOf(a)}`;
        expect(await undoRedo.undo(context)).toBe(false);
        expect(undo).not.toHaveBeenCalled();
        expect(read(closed)).toBe("after\nbefore\n");
    });

    it("a disk refusal while the buffer agrees also cancels the whole step", async () => {
        const open = new Map<string, IFakeBuffer>();
        const a = write("a.ts", "disk-a\n");
        const closed = write("b.ts", "before\n");
        const undo = vi.fn();
        open.set(resourceOf(a), {
            text: "buf-a\n",
            applied: [],
            step: { label: "b", resources: [], canUndo: () => true, undo, redo: vi.fn() },
        });
        const { service, undoRedo } = makeService(makeBuffers(open));
        await service.applyWorkspaceEdit(
            [textEdit(a, replaceFirstLine("head\n")), textEdit(closed, replaceFirstLine("after\n"))],
            "Refactor",
        );
        // The file on disk was changed outside the editor — it must not be undone.
        fs.writeFileSync(closed, "someone else\n");

        expect(await undoRedo.undo(`buffer:${resourceOf(a)}`)).toBe(false);
        expect(undo).not.toHaveBeenCalled();
        expect(read(closed)).toBe("someone else\n");
    });

    it("open buffers only: one refusal is resolved synchronously and cancels the whole step", async () => {
        const open = new Map<string, IFakeBuffer>();
        const a = write("a.ts", "disk-a\n");
        const b = write("b.ts", "disk-b\n");
        const undoA = vi.fn();
        const undoB = vi.fn();
        open.set(resourceOf(a), {
            text: "buf-a\n",
            applied: [],
            step: { label: "a", resources: [], canUndo: () => true, undo: undoA, redo: vi.fn() },
        });
        open.set(resourceOf(b), {
            text: "buf-b\n",
            applied: [],
            step: { label: "b", resources: [], canUndo: () => false, undo: undoB, redo: vi.fn() },
        });
        const { service, undoRedo } = makeService(makeBuffers(open));
        await service.applyWorkspaceEdit(
            [textEdit(a, replaceFirstLine("head\n")), textEdit(b, replaceFirstLine("head\n"))],
            "Refactor",
        );

        const context = `buffer:${resourceOf(a)}`;
        expect(undoRedo.peekUndo(context)?.canUndo?.()).toBe(false);
        expect(await undoRedo.undo(context)).toBe(false);
        expect(undoA).not.toHaveBeenCalled();
        expect(undoB).not.toHaveBeenCalled();
    });

    it("an untitled buffer is edited without a path on disk", async () => {
        const open = new Map<string, IFakeBuffer>();
        const undo = vi.fn();
        open.set("untitled:Untitled-1", {
            text: "draft\n",
            applied: [],
            step: { label: "b", resources: [], undo, redo: vi.fn() },
        });
        const { service, undoRedo } = makeService(makeBuffers(open));

        const applied = await service.applyWorkspaceEdit(
            [{ resource: "untitled:Untitled-1", edits: [replaceFirstLine("head\n")] }],
            "Edit",
        );

        expect(applied).toBe(true);
        expect(open.get("untitled:Untitled-1")?.text).toBe("head\ndraft\n");
        // The history step has no paths — the resource didn't exist on disk yet.
        expect(undoRedo.peekUndo("buffer:untitled:Untitled-1")?.resources).toEqual([]);
    });

    it("the history step lists the buffer's path when it has one", async () => {
        const open = new Map<string, IFakeBuffer>();
        const file = write("a.ts", "disk\n");
        open.set(resourceOf(file), {
            text: "buffer\n",
            applied: [],
            step: { label: "b", resources: [], undo: vi.fn(), redo: vi.fn() },
        });
        const { service, undoRedo } = makeService(makeBuffers(open));

        await service.applyWorkspaceEdit([textEdit(file, replaceFirstLine("head\n"))], "Edit");

        expect(undoRedo.peekUndo(`buffer:${resourceOf(file)}`)?.resources).toEqual([file]);
    });

    it("the bucket is chosen by touched BUFFERS — file operations do not go into that list", async () => {
        const open = new Map<string, IFakeBuffer>();
        const file = write("a.ts", "disk\n");
        open.set(resourceOf(file), {
            text: "buffer\n",
            applied: [],
            step: { label: "b", resources: [], undo: vi.fn(), redo: vi.fn() },
        });
        const { service, undoRedo } = makeService(makeBuffers(open));

        await service.applyWorkspaceEdit(
            [
                { kind: "create", to: path.join(tmpDir, "created.ts"), contents: "x" },
                textEdit(file, replaceFirstLine("head\n")),
            ],
            "Edit",
        );

        // The double returns the bucket of the FIRST touched resource: it must be the buffer,
        // not the path of the created file.
        expect(undoRedo.canUndo(`buffer:${resourceOf(file)}`)).toBe(true);
    });

    it("a refusal from one participant on REDO cancels the redo of the whole step", async () => {
        const open = new Map<string, IFakeBuffer>();
        const file = write("a.ts", "disk\n");
        const closed = write("b.ts", "before\n");
        const redo = vi.fn();
        open.set(resourceOf(file), {
            text: "buffer\n",
            applied: [],
            step: { label: "b", resources: [], canRedo: () => false, undo: vi.fn(), redo },
        });
        const { service, undoRedo } = makeService(makeBuffers(open));
        await service.applyWorkspaceEdit(
            [textEdit(file, replaceFirstLine("head\n")), textEdit(closed, replaceFirstLine("after\n"))],
            "Refactor",
        );
        const context = `buffer:${resourceOf(file)}`;
        await undoRedo.undo(context);

        expect(await undoRedo.redo(context)).toBe(false);
        expect(redo).not.toHaveBeenCalled();
        expect(read(closed)).toBe("before\n");
    });

    it("without touched buffers the step goes to the shared workspace operations bucket", async () => {
        const { service, undoRedo } = makeService(makeBuffers(new Map()));
        const closed = write("b.ts", "x\n");

        await service.applyWorkspaceEdit([textEdit(closed, replaceFirstLine("y\n"))], "Edit");

        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
    });
});

describe("WorkspaceEditService.applyWorkspaceEdit — file operations", async () => {
    it("creates a file and writes to it right away: operation order is kept", async () => {
        const { service, undoRedo } = makeService();
        const created = path.join(tmpDir, "new", "moved.ts");

        const applied = await service.applyWorkspaceEdit(
            [
                { kind: "create", to: created, contents: "export const a = 1;\n" },
                { resource: resourceOf(created), edits: [replaceFirstLine("// moved\n")] },
            ],
            "Move to a new file",
        );

        expect(applied).toBe(true);
        expect(read(created)).toBe("// moved\nexport const a = 1;\n");

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(fs.existsSync(created)).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, "new"))).toBe(false);

        // Redo: an edit of a file that doesn't exist yet before redo is not a refusal:
        // the create that precedes it in the step brings it back.
        expect(await undoRedo.redo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(created)).toBe("// moved\nexport const a = 1;\n");
    });

    it("a create WITHOUT contents gives an empty file — the edit is its only content", async () => {
        const { service } = makeService();
        const created = path.join(tmpDir, "empty.ts");

        const applied = await service.applyWorkspaceEdit(
            [
                { kind: "create", to: created },
                { resource: resourceOf(created), edits: [replaceFirstLine("hello")] },
            ],
            "Create",
        );

        expect(applied).toBe(true);
        expect(read(created)).toBe("hello");
    });

    it("rename + edit at the NEW path in one edit", async () => {
        const { service, undoRedo } = makeService();
        const from = write("old.ts", "content\n");
        const to = path.join(tmpDir, "new.ts");

        const applied = await service.applyWorkspaceEdit(
            [
                { kind: "rename", from, to },
                { resource: resourceOf(to), edits: [replaceFirstLine("// renamed\n")] },
            ],
            "Rename",
        );

        expect(applied).toBe(true);
        expect(fs.existsSync(from)).toBe(false);
        expect(read(to)).toBe("// renamed\ncontent\n");

        // Undo and redo: before redo the new path doesn't exist yet — the move
        // that precedes the edit in the step brings it back.
        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(from)).toBe("content\n");
        expect(await undoRedo.redo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(to)).toBe("// renamed\ncontent\n");
    });

    it("an edit of a file absent from the edit, redone without the file, is refused", async () => {
        const { service, undoRedo } = makeService();
        const file = write("a.ts", "before\n");
        await service.applyWorkspaceEdit(
            [{ resource: resourceOf(file), edits: [replaceFirstLine("after\n")] }],
            "Edit",
        );
        await undoRedo.undo(WORKSPACE_UNDO_CONTEXT);
        fs.rmSync(file);

        expect(await undoRedo.redo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(fs.existsSync(file)).toBe(false);
    });

    it("a file operation on a resource ALREADY edited as text refuses the edit", async () => {
        const { service } = makeService();
        const source = write("a.ts", "content\n");
        const target = path.join(tmpDir, "b.ts");

        // Edits, then move: the edits' base is taken from the old path — an honest refusal instead of corruption.
        expect(
            await service.applyWorkspaceEdit(
                [textEdit(source, replaceFirstLine("// head\n")), { kind: "rename", from: source, to: target }],
                "Edit",
            ),
        ).toBe(false);
        expect(read(source)).toBe("content\n");
        expect(fs.existsSync(target)).toBe(false);

        // Reverse order (file operation, then edits on the new path) —
        // works: this is exactly what extensions send.
        expect(
            await service.applyWorkspaceEdit(
                [{ kind: "rename", from: source, to: target }, textEdit(target, replaceFirstLine("// head\n"))],
                "Edit",
            ),
        ).toBe(true);
        expect(read(target)).toBe("// head\ncontent\n");
    });

    it("edit + delete of the SAME resource in one edit is refused", async () => {
        const { service } = makeService();
        const victim = write("victim.ts", "content\n");

        expect(
            await service.applyWorkspaceEdit(
                [textEdit(victim, replaceFirstLine("// head\n")), { kind: "delete", from: victim }],
                "Edit",
            ),
        ).toBe(false);
        expect(read(victim)).toBe("content\n");
    });

    it("delete + edit of the deleted resource in one edit is refused (nowhere to write)", async () => {
        const { service } = makeService();
        const victim = write("victim.ts", "content\n");

        const applied = await service.applyWorkspaceEdit(
            [
                { kind: "delete", from: victim },
                { resource: resourceOf(victim), edits: [replaceFirstLine("x")] },
            ],
            "Edit",
        );

        expect(applied).toBe(false);
        expect(read(victim)).toBe("content\n");
    });

    it("create over an existing file without options refuses the whole edit", async () => {
        const { service } = makeService();
        const existing = write("taken.ts", "mine\n");

        expect(await service.applyWorkspaceEdit([{ kind: "create", to: existing }], "Create")).toBe(false);
        expect(read(existing)).toBe("mine\n");
    });

    it("ignoreIfExists turns a create over an existing file into a no-op", async () => {
        const { service } = makeService();
        const existing = write("taken.ts", "mine\n");

        expect(
            await service.applyWorkspaceEdit(
                [
                    { kind: "create", to: existing, contents: "other", ignoreIfExists: true },
                    { kind: "create", to: path.join(tmpDir, "fresh.ts"), contents: "fresh" },
                ],
                "Create",
            ),
        ).toBe(true);
        expect(read(existing)).toBe("mine\n");
        expect(read(path.join(tmpDir, "fresh.ts"))).toBe("fresh");
    });

    it("an edit of only skipped operations succeeds without an undo step", async () => {
        const { service, undoRedo } = makeService();
        const existing = write("taken.ts", "mine\n");

        expect(
            await service.applyWorkspaceEdit([{ kind: "create", to: existing, ignoreIfExists: true }], "Create"),
        ).toBe(true);
        expect(read(existing)).toBe("mine\n");
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });

    it("overwrite replaces an existing file, undo restores the previous contents", async () => {
        const { service, undoRedo } = makeService();
        const existing = write("taken.ts", "mine\n");

        expect(
            await service.applyWorkspaceEdit(
                [{ kind: "create", to: existing, contents: "theirs", overwrite: true }],
                "Create",
            ),
        ).toBe(true);
        expect(read(existing)).toBe("theirs");

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(existing)).toBe("mine\n");
    });

    it("overwrite at a path with no file simply creates it", async () => {
        const { service, undoRedo } = makeService();
        const fresh = path.join(tmpDir, "fresh.ts");

        expect(
            await service.applyWorkspaceEdit(
                [{ kind: "create", to: fresh, contents: "new", overwrite: true }],
                "Create",
            ),
        ).toBe(true);
        expect(read(fresh)).toBe("new");

        // Nothing to put back — undo just removes the created file.
        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(fs.existsSync(fresh)).toBe(false);
    });

    it("a resource deleted by the same edit can be created again", async () => {
        const { service } = makeService();
        const victim = write("victim.ts", "old\n");

        expect(
            await service.applyWorkspaceEdit(
                [
                    { kind: "delete", from: victim },
                    { kind: "create", to: victim, contents: "new\n" },
                ],
                "Replace",
            ),
        ).toBe(true);
        expect(read(victim)).toBe("new\n");
    });

    it("overwrite beats ignoreIfExists (as in the vscode API)", async () => {
        const { service } = makeService();
        const existing = write("taken.ts", "mine\n");

        await service.applyWorkspaceEdit(
            [{ kind: "create", to: existing, contents: "theirs", overwrite: true, ignoreIfExists: true }],
            "Create",
        );

        expect(read(existing)).toBe("theirs");
    });

    it("overwrite over a file created by THIS SAME edit (not yet on disk)", async () => {
        const { service } = makeService();
        const target = path.join(tmpDir, "twice.ts");

        const applied = await service.applyWorkspaceEdit(
            [
                { kind: "create", to: target, contents: "first" },
                { kind: "create", to: target, contents: "second", overwrite: true },
            ],
            "Create",
        );

        expect(applied).toBe(true);
        expect(read(target)).toBe("second");
    });

    it("overwrite on a directory refuses the edit (we do not wipe a tree)", async () => {
        const { service } = makeService();
        const dir = path.join(tmpDir, "dir");
        fs.mkdirSync(dir);

        expect(await service.applyWorkspaceEdit([{ kind: "create", to: dir, overwrite: true }], "Create")).toBe(false);
        expect(fs.existsSync(dir)).toBe(true);
    });

    it("deleting a missing resource is refused, and with ignoreIfNotExists is a no-op", async () => {
        const { service } = makeService();
        const missing = path.join(tmpDir, "ghost.ts");

        expect(await service.applyWorkspaceEdit([{ kind: "delete", from: missing }], "Delete")).toBe(false);
        expect(
            await service.applyWorkspaceEdit(
                [
                    { kind: "delete", from: missing, ignoreIfNotExists: true },
                    { kind: "create", to: path.join(tmpDir, "fresh.ts") },
                ],
                "Delete",
            ),
        ).toBe(true);
    });

    it("ignoreIfNotExists does not prevent deleting an EXISTING resource", async () => {
        const { service } = makeService();
        const victim = write("victim.ts", "bye\n");

        expect(
            await service.applyWorkspaceEdit([{ kind: "delete", from: victim, ignoreIfNotExists: true }], "Delete"),
        ).toBe(true);
        expect(fs.existsSync(victim)).toBe(false);
    });

    it("a skipped delete does not reach the trash (otherwise it would refuse the whole edit)", async () => {
        const { service } = makeServiceWithTrash();
        const missing = path.join(tmpDir, "ghost.ts");
        const fresh = path.join(tmpDir, "fresh.ts");

        // With a working trash, deleting a nonexistent file is an error, and if
        // the operation were NOT skipped, the whole edit would be rolled back.
        expect(
            await service.applyWorkspaceEdit(
                [
                    { kind: "delete", from: missing, ignoreIfNotExists: true },
                    { kind: "create", to: fresh, contents: "x" },
                ],
                "Delete",
            ),
        ).toBe(true);
        expect(read(fresh)).toBe("x");
    });

    it("a delete to trash is undoable in one step together with the rest of the edit", async () => {
        const { service, undoRedo } = makeServiceWithTrash();
        const victim = write("victim.ts", "bye\n");
        const closed = write("b.ts", "before\n");

        expect(
            await service.applyWorkspaceEdit(
                [{ kind: "delete", from: victim }, textEdit(closed, replaceFirstLine("after\n"))],
                "Refactor",
            ),
        ).toBe(true);
        expect(fs.existsSync(victim)).toBe(false);

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(victim)).toBe("bye\n");
        expect(read(closed)).toBe("before\n");
    });

    it("renaming a missing source refuses the edit even with ignoreIfExists", async () => {
        const { service } = makeService();
        const ghost = path.join(tmpDir, "ghost.ts");
        const taken = write("taken.ts", "mine\n");

        // `ignoreIfExists` is about the TARGET; a missing source is still
        // a refusal, not "silently do nothing".
        expect(
            await service.applyWorkspaceEdit(
                [{ kind: "rename", from: ghost, to: taken, ignoreIfExists: true }],
                "Rename",
            ),
        ).toBe(false);
        expect(read(taken)).toBe("mine\n");
    });

    it("renaming a missing source refuses the edit", async () => {
        const { service } = makeService();
        expect(
            await service.applyWorkspaceEdit(
                [{ kind: "rename", from: path.join(tmpDir, "ghost.ts"), to: path.join(tmpDir, "x.ts") }],
                "Rename",
            ),
        ).toBe(false);
    });

    it("renaming onto a taken name: refused without options, no-op with ignoreIfExists, replaced with overwrite", async () => {
        const { service, undoRedo } = makeService();
        const from = write("from.ts", "source\n");
        const to = write("to.ts", "target\n");

        expect(await service.applyWorkspaceEdit([{ kind: "rename", from, to }], "Rename")).toBe(false);
        expect(read(from)).toBe("source\n");

        expect(
            await service.applyWorkspaceEdit(
                [
                    { kind: "rename", from, to, ignoreIfExists: true },
                    { kind: "create", to: path.join(tmpDir, "f.ts") },
                ],
                "Rename",
            ),
        ).toBe(true);
        expect(read(from)).toBe("source\n");
        expect(read(to)).toBe("target\n");

        expect(await service.applyWorkspaceEdit([{ kind: "rename", from, to, overwrite: true }], "Rename")).toBe(true);
        expect(fs.existsSync(from)).toBe(false);
        expect(read(to)).toBe("source\n");

        expect(await undoRedo.undo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
        expect(read(from)).toBe("source\n");
        expect(read(to)).toBe("target\n");
    });

    it("a file created by THIS SAME edit already 'exists' for the following operations", async () => {
        const { service } = makeService();
        const fresh = path.join(tmpDir, "generated.ts");

        // Delete sees a file that isn't on disk yet: the edit itself created it.
        expect(
            await service.applyWorkspaceEdit(
                [
                    { kind: "create", to: fresh, contents: "temp" },
                    { kind: "delete", from: fresh },
                ],
                "Create and drop",
            ),
        ).toBe(true);
        expect(fs.existsSync(fresh)).toBe(false);
    });

    it("a resource renamed by THIS SAME edit frees the old path", async () => {
        const { service } = makeService();
        const from = write("a.ts", "payload\n");
        const to = path.join(tmpDir, "b.ts");

        expect(
            await service.applyWorkspaceEdit(
                [
                    { kind: "rename", from, to },
                    { kind: "create", to: from, contents: "fresh\n" },
                ],
                "Rename",
            ),
        ).toBe(true);
        expect(read(to)).toBe("payload\n");
        expect(read(from)).toBe("fresh\n");
    });

    it("a write failure after validation rolls back what was applied and returns a refusal", async () => {
        const { service, undoRedo } = makeService();
        const closed = write("b.ts", "before\n");
        // A directory in place of the target file: validation sees "no resource"
        // (`existsSync` on a nonexistent nested path), and the write fails.
        const blocked = path.join(tmpDir, "blocked.ts");
        fs.mkdirSync(blocked);

        const applied = await service.applyWorkspaceEdit(
            [
                { resource: resourceOf(closed), edits: [replaceFirstLine("after\n")] },
                { kind: "create", to: path.join(blocked, "x", "y") },
                { kind: "rename", from: blocked, to: path.join(tmpDir, "dst", "deep", "x") },
            ],
            "Edit",
        );

        expect(applied).toBe(false);
        expect(read(closed)).toBe("before\n");
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });
});

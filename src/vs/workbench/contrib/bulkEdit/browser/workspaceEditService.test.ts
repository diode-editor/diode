import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { IFileService } from "../../../../platform/files/common/files.ts";
import { TrashService } from "../../../../platform/files/node/trashService.ts";
import { UndoRedoService, WORKSPACE_UNDO_CONTEXT } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { NULL_BULK_EDIT_BUFFERS } from "../common/iBulkEditBuffers.ts";

import { WorkspaceEditService } from "./workspaceEditService.ts";

let tmpDir: string;
let ws: ITempWorkspace;
let savedXdg: string | undefined;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-wes-" });
    tmpDir = ws.dir;
    savedXdg = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = path.join(tmpDir, "data");
});

afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    ws.dispose();
});

function configWith(enableTrash: boolean): IConfigurationService {
    return createTestConfigurationService({ "files.enableTrash": enableTrash });
}

function makeService(
    enableTrash = true,
    files: IFileService = diskFileService(),
): { service: WorkspaceEditService; undoRedo: UndoRedoService } {
    const undoRedo = new UndoRedoService();
    const service = new WorkspaceEditService(
        undoRedo,
        new TrashService(),
        configWith(enableTrash),
        NULL_BULK_EDIT_BUFFERS,
        files,
    );
    return { service, undoRedo };
}

function write(rel: string, content = "x"): string {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
}

describe("WorkspaceEditService — undo confirmation", () => {
    it("is taken from the operation that asks for it, not the first one in the set", async () => {
        const { service } = makeService();
        const src = write("copied.txt", "payload");
        const targetDir = path.join(tmpDir, "dest");
        fs.mkdirSync(targetDir);

        // Create needs no confirmation, insert does: the step must carry
        // exactly its message.
        const element = await service.applyFileEdits(
            [
                { kind: "create", to: path.join(tmpDir, "fresh.txt") },
                { kind: "copy", from: src, to: targetDir },
            ],
            "Paste",
        );

        expect(element?.confirmBeforeUndo).toBe("Are you sure you want to delete 'copied.txt'?");
    });
});

describe("WorkspaceEditService — paste: names and nesting", () => {
    it("copy next to the original picks a name: 'copy', then 'copy 2', keeping the extension", async () => {
        const { service } = makeService();
        const src = write("a.txt", "A");
        write("a copy.txt", "taken");

        await service.applyFileEdits([{ kind: "copy", from: src, to: tmpDir }], "Paste");

        expect(fs.readFileSync(path.join(tmpDir, "a copy 2.txt"), "utf8")).toBe("A");
        expect(fs.readFileSync(path.join(tmpDir, "a copy.txt"), "utf8")).toBe("taken");
    });

    it("a directory without an extension is copied recursively under the name 'copy'", async () => {
        const { service } = makeService();
        write("dir/inner/f.txt", "F");

        await service.applyFileEdits([{ kind: "copy", from: path.join(tmpDir, "dir"), to: tmpDir }], "Paste");

        expect(fs.readFileSync(path.join(tmpDir, "dir copy", "inner", "f.txt"), "utf8")).toBe("F");
    });

    it("a directory cannot be copied or moved into itself — no step is recorded", async () => {
        const { service, undoRedo } = makeService();
        const dir = path.join(tmpDir, "dir");
        write("dir/sub/f.txt");
        const inside = path.join(dir, "sub");

        expect(await service.applyFileEdits([{ kind: "copy", from: dir, to: inside }], "Paste")).toBeNull();
        expect(await service.applyFileEdits([{ kind: "move", from: dir, to: dir }], "Move")).toBeNull();

        expect(fs.readdirSync(inside)).toEqual(["f.txt"]);
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });

    it("moving into the directory the file is already in moves nothing", async () => {
        const { service } = makeService();
        const src = write("a.txt", "A");

        await service.applyFileEdits([{ kind: "move", from: src, to: tmpDir }], "Move");

        expect(fs.readdirSync(tmpDir).filter((name) => name.startsWith("a"))).toEqual(["a.txt"]);
    });
});

describe("WorkspaceEditService — undoing a create", () => {
    it("a created file that is already gone does not break undo", async () => {
        const { service } = makeService();
        const created = path.join(tmpDir, "fresh.txt");
        const element = await service.applyFileEdits([{ kind: "create", to: created }], "New File");
        fs.rmSync(created);

        await element!.undo();

        expect(fs.existsSync(created)).toBe(false);
    });

    it("a delete error other than 'not found' reaches undo", async () => {
        const disk = diskFileService();
        const failingDel: IFileService = Object.assign(Object.create(disk) as IFileService, {
            del: () => Promise.reject(new Error("EACCES")),
        });
        const { service } = makeService(true, failingDel);
        const created = path.join(tmpDir, "fresh.txt");
        const element = await service.applyFileEdits([{ kind: "create", to: created }], "New File");

        await expect(element!.undo()).rejects.toThrow("EACCES");
        expect(fs.existsSync(created)).toBe(true);
    });
});

describe("WorkspaceEditService — move", () => {
    it("moves a file and undo/redo round-trips it", async () => {
        const { service } = makeService();
        const src = write("a.txt", "hi");
        const dstDir = path.join(tmpDir, "dst");
        fs.mkdirSync(dstDir);

        const element = await service.applyFileEdits([{ kind: "move", from: src, to: dstDir }], "Move");
        expect(element).not.toBeNull();
        expect(fs.existsSync(src)).toBe(false);
        expect(fs.readFileSync(path.join(dstDir, "a.txt"), "utf8")).toBe("hi");

        await element!.undo();
        expect(fs.readFileSync(src, "utf8")).toBe("hi");
        expect(fs.existsSync(path.join(dstDir, "a.txt"))).toBe(false);

        await element!.redo();
        expect(fs.existsSync(src)).toBe(false);
        expect(fs.existsSync(path.join(dstDir, "a.txt"))).toBe(true);
    });
});

describe("WorkspaceEditService — rename", () => {
    it("renames a file in place (exact target path) and undo/redo round-trips it", async () => {
        const { service } = makeService();
        const src = write("old.txt", "hi");
        const dest = path.join(tmpDir, "new.txt");

        const element = await service.applyFileEdits([{ kind: "rename", from: src, to: dest }], "Rename");
        expect(element).not.toBeNull();
        expect(fs.existsSync(src)).toBe(false);
        expect(fs.readFileSync(dest, "utf8")).toBe("hi");

        await element!.undo();
        expect(fs.readFileSync(src, "utf8")).toBe("hi");
        expect(fs.existsSync(dest)).toBe(false);

        await element!.redo();
        expect(fs.existsSync(src)).toBe(false);
        expect(fs.readFileSync(dest, "utf8")).toBe("hi");
    });

    it("renames a directory in place", async () => {
        const { service } = makeService();
        write("dir/a.txt", "inside");
        const src = path.join(tmpDir, "dir");
        const dest = path.join(tmpDir, "renamed");

        const element = await service.applyFileEdits([{ kind: "rename", from: src, to: dest }], "Rename");
        expect(element).not.toBeNull();
        expect(fs.existsSync(src)).toBe(false);
        expect(fs.readFileSync(path.join(dest, "a.txt"), "utf8")).toBe("inside");

        await element!.undo();
        expect(fs.readFileSync(path.join(src, "a.txt"), "utf8")).toBe("inside");
    });
});

describe("WorkspaceEditService — copy", () => {
    it("copies a file; undo deletes the copy and is marked destructive", async () => {
        const { service } = makeService();
        const src = write("a.txt", "hi");
        const dstDir = path.join(tmpDir, "dst");
        fs.mkdirSync(dstDir);

        const element = await service.applyFileEdits([{ kind: "copy", from: src, to: dstDir }], "Paste");
        expect(element!.confirmBeforeUndo).toBeDefined();
        const copy = path.join(dstDir, "a.txt");
        expect(fs.existsSync(copy)).toBe(true);
        expect(fs.existsSync(src)).toBe(true);

        await element!.undo();
        expect(fs.existsSync(copy)).toBe(false);
        expect(fs.existsSync(src)).toBe(true);

        await element!.redo();
        expect(fs.existsSync(copy)).toBe(true);
    });
});

describe("WorkspaceEditService — create", () => {
    it("creates an empty file; undo removes it, redo recreates it", async () => {
        const { service, undoRedo } = makeService();
        const dest = path.join(tmpDir, "new.txt");

        const element = await service.applyFileEdits([{ kind: "create", to: dest }], "New File");
        expect(element).not.toBeNull();
        expect(fs.readFileSync(dest, "utf8")).toBe("");
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(true);

        await element!.undo();
        expect(fs.existsSync(dest)).toBe(false);

        await element!.redo();
        expect(fs.existsSync(dest)).toBe(true);
    });

    it("creates a directory when directory:true; undo removes it", async () => {
        const { service } = makeService();
        const dest = path.join(tmpDir, "newdir");

        const element = await service.applyFileEdits([{ kind: "create", to: dest, directory: true }], "New Folder");
        expect(element).not.toBeNull();
        expect(fs.statSync(dest).isDirectory()).toBe(true);

        await element!.undo();
        expect(fs.existsSync(dest)).toBe(false);
    });

    it("creates intermediate dirs and undo removes only what it created", async () => {
        const { service } = makeService();
        const dest = path.join(tmpDir, "foo", "bar", "baz.txt");

        const element = await service.applyFileEdits([{ kind: "create", to: dest }], "New File");
        expect(fs.existsSync(dest)).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, "foo"))).toBe(true);

        await element!.undo();
        expect(fs.existsSync(path.join(tmpDir, "foo"))).toBe(false);
        expect(fs.existsSync(tmpDir)).toBe(true);
    });

    it("no-ops on collision: existing file untouched, nothing recorded", async () => {
        const { service, undoRedo } = makeService();
        const dest = write("exists.txt", "keep");

        const element = await service.applyFileEdits([{ kind: "create", to: dest }], "New File");
        expect(element).toBeNull();
        expect(fs.readFileSync(dest, "utf8")).toBe("keep");
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });
});

describe("WorkspaceEditService — delete (permanent)", () => {
    it("deletes permanently and records nothing undoable when trash is disabled", async () => {
        const { service, undoRedo } = makeService(false);
        const src = write("a.txt");

        const element = await service.applyFileEdits([{ kind: "delete", from: src }], "Delete");
        expect(element).toBeNull();
        expect(fs.existsSync(src)).toBe(false);
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(service.willMoveToTrash()).toBe(false);
    });
});

describe("WorkspaceEditService — edge cases", () => {
    it("ignores an unsupported edit kind (returns null, records nothing)", async () => {
        const { service, undoRedo } = makeService();
        // Force a deliberately unknown kind — applyOne throws, the error is swallowed.
        const element = await service.applyFileEdits(
            [{ kind: "bogus" as unknown as "create", to: path.join(tmpDir, "x.txt") }],
            "Bogus",
        );
        expect(element).toBeNull();
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });

    it.skipIf(process.platform !== "linux")("treats a missing files.enableTrash setting as enabled", () => {
        const config = createTestConfigurationService(); // setting not set at all — schema default
        const service = new WorkspaceEditService(
            new UndoRedoService(),
            new TrashService(),
            config,
            NULL_BULK_EDIT_BUFFERS,
            diskFileService(),
        );
        expect(service.willMoveToTrash()).toBe(true);
    });
});

describe.skipIf(process.platform !== "linux")("WorkspaceEditService — delete (trash)", () => {
    it("moves to trash, pushes an undoable element, and restores on undo", async () => {
        const { service, undoRedo } = makeService(true);
        const src = write("secret.txt", "pw");
        expect(service.willMoveToTrash()).toBe(true);

        const element = await service.applyFileEdits([{ kind: "delete", from: src }], "Delete");
        expect(element).not.toBeNull();
        expect(fs.existsSync(src)).toBe(false);
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(true);

        await element!.undo();
        expect(fs.readFileSync(src, "utf8")).toBe("pw");

        await element!.redo();
        expect(fs.existsSync(src)).toBe(false);
    });

    it("trash bypasses the file service, so it notifies the buffers of the delete (and of redo) itself", async () => {
        const deleted: string[] = [];
        const service = new WorkspaceEditService(
            new UndoRedoService(),
            new TrashService(),
            configWith(true),
            { ...NULL_BULK_EDIT_BUFFERS, didDelete: (resource) => deleted.push(resource) },
            diskFileService(),
        );
        const src = write("dir/a.txt");
        const dir = path.dirname(src);

        const element = await service.applyFileEdits([{ kind: "delete", from: dir }], "Delete");
        expect(deleted).toEqual([Uri.file(dir).toString()]);

        await element!.undo();
        expect(deleted).toHaveLength(1);
        await element!.redo();
        expect(deleted).toEqual([Uri.file(dir).toString(), Uri.file(dir).toString()]);
    });
});

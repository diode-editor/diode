import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { TrashService } from "../../../../platform/files/node/trashService.ts";
import { UndoRedoService, WORKSPACE_UNDO_CONTEXT } from "../../../../platform/undoRedo/common/undoRedoService.ts";

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
    return {
        ...NULL_CONFIGURATION_SERVICE,
        get<T>(key: string, def?: T): T | undefined {
            return key === "files.enableTrash" ? (enableTrash as unknown as T) : def;
        },
    };
}

function makeService(enableTrash = true): { service: WorkspaceEditService; undoRedo: UndoRedoService } {
    const undoRedo = new UndoRedoService();
    const service = new WorkspaceEditService(undoRedo, new TrashService(), configWith(enableTrash));
    return { service, undoRedo };
}

function write(rel: string, content = "x"): string {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
}

describe("WorkspaceEditService — move", () => {
    it("moves a file and undo/redo round-trips it", async () => {
        const { service } = makeService();
        const src = write("a.txt", "hi");
        const dstDir = path.join(tmpDir, "dst");
        fs.mkdirSync(dstDir);

        const element = service.applyFileEdits([{ kind: "move", from: src, to: dstDir }], "Move");
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

        const element = service.applyFileEdits([{ kind: "rename", from: src, to: dest }], "Rename");
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

        const element = service.applyFileEdits([{ kind: "rename", from: src, to: dest }], "Rename");
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

        const element = service.applyFileEdits([{ kind: "copy", from: src, to: dstDir }], "Paste");
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

        const element = service.applyFileEdits([{ kind: "create", to: dest }], "New File");
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

        const element = service.applyFileEdits([{ kind: "create", to: dest, directory: true }], "New Folder");
        expect(element).not.toBeNull();
        expect(fs.statSync(dest).isDirectory()).toBe(true);

        await element!.undo();
        expect(fs.existsSync(dest)).toBe(false);
    });

    it("creates intermediate dirs and undo removes only what it created", async () => {
        const { service } = makeService();
        const dest = path.join(tmpDir, "foo", "bar", "baz.txt");

        const element = service.applyFileEdits([{ kind: "create", to: dest }], "New File");
        expect(fs.existsSync(dest)).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, "foo"))).toBe(true);

        // undo вычищает самый верхний созданный предок (`foo/`), не трогая tmpDir.
        await element!.undo();
        expect(fs.existsSync(path.join(tmpDir, "foo"))).toBe(false);
        expect(fs.existsSync(tmpDir)).toBe(true);
    });

    it("no-ops on collision: existing file untouched, nothing recorded", () => {
        const { service, undoRedo } = makeService();
        const dest = write("exists.txt", "keep");

        const element = service.applyFileEdits([{ kind: "create", to: dest }], "New File");
        expect(element).toBeNull();
        expect(fs.readFileSync(dest, "utf8")).toBe("keep");
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });
});

describe("WorkspaceEditService — delete (permanent)", () => {
    it("deletes permanently and records nothing undoable when trash is disabled", () => {
        const { service, undoRedo } = makeService(false);
        const src = write("a.txt");

        const element = service.applyFileEdits([{ kind: "delete", from: src }], "Delete");
        expect(element).toBeNull();
        expect(fs.existsSync(src)).toBe(false);
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
        expect(service.willMoveToTrash()).toBe(false);
    });
});

describe("WorkspaceEditService — edge cases", () => {
    it("ignores an unsupported edit kind (returns null, records nothing)", () => {
        const { service, undoRedo } = makeService();
        // Приводим заведомо неизвестный вид — applyOne бросит, ошибка проглотится.
        const element = service.applyFileEdits(
            [{ kind: "bogus" as unknown as "create", to: path.join(tmpDir, "x.txt") }],
            "Bogus",
        );
        expect(element).toBeNull();
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });

    it.skipIf(process.platform !== "linux")("treats a missing files.enableTrash setting as enabled", () => {
        const config: IConfigurationService = {
            ...NULL_CONFIGURATION_SERVICE,
            get: () => undefined, // настройка не задана вовсе
        };
        const service = new WorkspaceEditService(new UndoRedoService(), new TrashService(), config);
        expect(service.willMoveToTrash()).toBe(true);
    });
});

describe.skipIf(process.platform !== "linux")("WorkspaceEditService — delete (trash)", () => {
    it("moves to trash, pushes an undoable element, and restores on undo", async () => {
        const { service, undoRedo } = makeService(true);
        const src = write("secret.txt", "pw");
        expect(service.willMoveToTrash()).toBe(true);

        const element = service.applyFileEdits([{ kind: "delete", from: src }], "Delete");
        expect(element).not.toBeNull();
        expect(fs.existsSync(src)).toBe(false);
        expect(undoRedo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(true);

        await element!.undo();
        expect(fs.readFileSync(src, "utf8")).toBe("pw");

        await element!.redo();
        expect(fs.existsSync(src)).toBe(false);
    });
});

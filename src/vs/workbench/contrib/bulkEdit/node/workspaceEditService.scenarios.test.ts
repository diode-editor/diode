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
    ws = createTempWorkspace({ prefix: "diode-wes-scen-" });
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

function mkdir(rel: string): string {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(full, { recursive: true });
    return full;
}

describe("WorkspaceEditService scenarios — copy", () => {
    it("undo deletes the copy even after it was modified on disk", async () => {
        // Ключевой сценарий: «скопировал, поменял копию, отменил — копия должна удалиться».
        const { service } = makeService();
        const src = write("a.txt", "orig");
        const dst = mkdir("dst");

        const el = service.applyFileEdits([{ kind: "copy", from: src, to: dst }], "Paste");
        const copy = path.join(dst, "a.txt");
        fs.writeFileSync(copy, "MODIFIED"); // правим копию на диске

        await el!.undo();

        expect(fs.existsSync(copy)).toBe(false);
        expect(fs.readFileSync(src, "utf8")).toBe("orig"); // оригинал не тронут
    });

    it("copy into the same dir auto-renames; undo removes only the copy", async () => {
        const { service } = makeService();
        const src = write("a.txt", "orig");

        const el = service.applyFileEdits([{ kind: "copy", from: src, to: tmpDir }], "Paste");
        const copy = path.join(tmpDir, "a copy.txt");
        expect(fs.existsSync(copy)).toBe(true);

        await el!.undo();
        expect(fs.existsSync(copy)).toBe(false);
        expect(fs.existsSync(src)).toBe(true);
    });

    it("copies a directory tree; undo removes the whole tree", async () => {
        const { service } = makeService();
        write("tree/inner/f.txt", "deep");
        const dst = mkdir("dst");

        const el = service.applyFileEdits([{ kind: "copy", from: path.join(tmpDir, "tree"), to: dst }], "Paste");
        expect(fs.readFileSync(path.join(dst, "tree", "inner", "f.txt"), "utf8")).toBe("deep");

        await el!.undo();
        expect(fs.existsSync(path.join(dst, "tree"))).toBe(false);
    });
});

describe("WorkspaceEditService scenarios — move", () => {
    it("undo restores the original name even when the move auto-renamed on collision", async () => {
        const { service } = makeService();
        const src = write("a.txt", "v");
        const dst = mkdir("dst");
        fs.writeFileSync(path.join(dst, "a.txt"), "existing");

        const el = service.applyFileEdits([{ kind: "move", from: src, to: dst }], "Move");
        expect(fs.existsSync(path.join(dst, "a copy.txt"))).toBe(true); // renamed on move
        expect(fs.existsSync(src)).toBe(false);

        await el!.undo();
        expect(fs.readFileSync(src, "utf8")).toBe("v");
        expect(fs.readFileSync(path.join(dst, "a.txt"), "utf8")).toBe("existing"); // collision target untouched
    });

    it("undo restores next to the original when its location was re-occupied", async () => {
        const { service } = makeService();
        const src = write("a.txt", "v");
        const dst = mkdir("dst");

        const el = service.applyFileEdits([{ kind: "move", from: src, to: dst }], "Move");
        fs.writeFileSync(src, "new"); // что-то заняло исходный путь

        await el!.undo();
        expect(fs.readFileSync(src, "utf8")).toBe("new"); // занявший файл не тронут
        const restored = path.join(tmpDir, "a copy.txt");
        expect(fs.readFileSync(restored, "utf8")).toBe("v"); // вернулось рядом
    });
});

describe("WorkspaceEditService scenarios — multi-edit & ordering", () => {
    it("undo/redo a multi-file paste as one step", async () => {
        const { service } = makeService();
        const a = write("a.txt", "A");
        const b = write("b.txt", "B");
        const dst = mkdir("dst");

        const el = service.applyFileEdits(
            [
                { kind: "copy", from: a, to: dst },
                { kind: "copy", from: b, to: dst },
            ],
            "Paste",
        );
        expect(fs.existsSync(path.join(dst, "a.txt"))).toBe(true);
        expect(fs.existsSync(path.join(dst, "b.txt"))).toBe(true);

        await el!.undo();
        expect(fs.existsSync(path.join(dst, "a.txt"))).toBe(false);
        expect(fs.existsSync(path.join(dst, "b.txt"))).toBe(false);

        await el!.redo();
        expect(fs.existsSync(path.join(dst, "a.txt"))).toBe(true);
        expect(fs.existsSync(path.join(dst, "b.txt"))).toBe(true);
    });

    it("undoes separate operations in strict LIFO order via the workspace stack", async () => {
        const { service, undoRedo } = makeService();
        const a = write("a.txt", "A");
        const dstCopy = mkdir("copydst");
        service.applyFileEdits([{ kind: "copy", from: a, to: dstCopy }], "Paste"); // op #1

        const b = write("b.txt", "B");
        const dstMove = mkdir("movedst");
        service.applyFileEdits([{ kind: "move", from: b, to: dstMove }], "Move"); // op #2

        // LIFO: сначала откатывается последняя операция (move), потом первая (copy).
        await undoRedo.undo(WORKSPACE_UNDO_CONTEXT);
        expect(fs.existsSync(path.join(tmpDir, "b.txt"))).toBe(true); // move откатан
        expect(fs.existsSync(path.join(dstCopy, "a.txt"))).toBe(true); // copy ещё на месте

        await undoRedo.undo(WORKSPACE_UNDO_CONTEXT);
        expect(fs.existsSync(path.join(dstCopy, "a.txt"))).toBe(false); // copy откатан
    });
});

describe.skipIf(process.platform !== "linux")("WorkspaceEditService scenarios — delete (trash)", () => {
    it("deletes a directory tree to trash and undo restores it whole", async () => {
        const { service } = makeService(true);
        write("d/sub/f.txt", "deep");

        const el = service.applyFileEdits([{ kind: "delete", from: path.join(tmpDir, "d") }], "Delete");
        expect(el).not.toBeNull();
        expect(fs.existsSync(path.join(tmpDir, "d"))).toBe(false);

        await el!.undo();
        expect(fs.readFileSync(path.join(tmpDir, "d", "sub", "f.txt"), "utf8")).toBe("deep");

        await el!.redo();
        expect(fs.existsSync(path.join(tmpDir, "d"))).toBe(false);
    });
});

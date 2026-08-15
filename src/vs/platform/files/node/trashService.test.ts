import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";

import { TrashService } from "./trashService.ts";

let tmpDir: string;
let ws: ITempWorkspace;
let dataHome: string;
let workDir: string;
let savedXdg: string | undefined;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-trash-" });
    tmpDir = ws.dir;
    dataHome = path.join(tmpDir, "data");
    workDir = path.join(tmpDir, "work");
    fs.mkdirSync(workDir, { recursive: true });
    savedXdg = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = dataHome;
});

afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    ws.dispose();
});

function writeFile(name: string, content = "secret"): string {
    const full = path.join(workDir, name);
    fs.writeFileSync(full, content);
    return full;
}

// Бэкенд freedesktop поддерживается только на Linux.
describe.skipIf(process.platform !== "linux")("TrashService (freedesktop)", () => {
    it("reports availability and creates the trash dirs", () => {
        const trash = new TrashService();
        expect(trash.isAvailable()).toBe(true);
        expect(fs.existsSync(path.join(dataHome, "Trash", "files"))).toBe(true);
        expect(fs.existsSync(path.join(dataHome, "Trash", "info"))).toBe(true);
    });

    it("moves a file into Trash/files and writes a .trashinfo", () => {
        const trash = new TrashService();
        const src = writeFile("pass.txt", "hunter2");

        const entry = trash.trash(src);

        expect(fs.existsSync(src)).toBe(false);
        expect(fs.readFileSync(entry.trashedPath, "utf8")).toBe("hunter2");
        expect(path.dirname(entry.trashedPath)).toBe(path.join(dataHome, "Trash", "files"));
        const info = fs.readFileSync(entry.infoPath, "utf8");
        expect(info).toContain("[Trash Info]");
        expect(info).toContain(`Path=${src}`);
        expect(info).toMatch(/DeletionDate=\d{4}-\d{2}-\d{2}T/);
    });

    it("restores a trashed file to its original path and clears the info", () => {
        const trash = new TrashService();
        const src = writeFile("note.md", "data");
        const entry = trash.trash(src);

        const restored = trash.restore(entry);

        expect(restored).toBe(src);
        expect(fs.readFileSync(src, "utf8")).toBe("data");
        expect(fs.existsSync(entry.trashedPath)).toBe(false);
        expect(fs.existsSync(entry.infoPath)).toBe(false);
    });

    it("auto-renames when a same-named file is already in the trash", () => {
        const trash = new TrashService();
        const e1 = trash.trash(writeFile("dup.txt", "one"));
        const e2 = trash.trash(writeFile("dup.txt", "two"));
        expect(e1.trashedPath).not.toBe(e2.trashedPath);
        expect(fs.readFileSync(e1.trashedPath, "utf8")).toBe("one");
        expect(fs.readFileSync(e2.trashedPath, "utf8")).toBe("two");
    });

    it("restores next to the original when the original path is occupied", () => {
        const trash = new TrashService();
        const src = writeFile("x.txt", "old");
        const entry = trash.trash(src);
        fs.writeFileSync(src, "new"); // что-то заняло путь

        const restored = trash.restore(entry);
        expect(restored).not.toBe(src);
        expect(fs.existsSync(src)).toBe(true);
        expect(fs.readFileSync(restored, "utf8")).toBe("old");
    });

    it("falls back to ~/.local/share when XDG_DATA_HOME is not set", () => {
        const savedHome = process.env.HOME;
        delete process.env.XDG_DATA_HOME;
        process.env.HOME = path.join(tmpDir, "home");
        fs.mkdirSync(process.env.HOME, { recursive: true });
        try {
            const trash = new TrashService();
            expect(trash.isAvailable()).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, "home", ".local", "share", "Trash", "files"))).toBe(true);
        } finally {
            process.env.HOME = savedHome;
        }
    });

    it("reports unavailable when the trash directories cannot be created", () => {
        const blocker = path.join(tmpDir, "blocker");
        fs.writeFileSync(blocker, ""); // файл на месте каталога → mkdir упадёт
        process.env.XDG_DATA_HOME = path.join(blocker, "data");

        expect(new TrashService().isAvailable()).toBe(false);
    });

    it("trash() throws when the trash is unavailable", () => {
        const blocker = path.join(tmpDir, "blocker");
        fs.writeFileSync(blocker, "");
        process.env.XDG_DATA_HOME = path.join(blocker, "data");

        const src = writeFile("doomed.txt");
        expect(() => new TrashService().trash(src)).toThrow();
        expect(fs.existsSync(src)).toBe(true); // файл не тронут
    });
});

describe("TrashService — platform gate", () => {
    it("is unavailable on non-linux platforms", () => {
        const original = Object.getOwnPropertyDescriptor(process, "platform")!;
        Object.defineProperty(process, "platform", { value: "darwin" });
        try {
            expect(new TrashService().isAvailable()).toBe(false);
        } finally {
            Object.defineProperty(process, "platform", original);
        }
    });
});

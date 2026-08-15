import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";

import { moveToPath } from "./fileClipboardFs.ts";

// Мокаем renameSync обёрткой над реальной реализацией, чтобы в одном тесте
// детерминированно сымитировать cross-device (EXDEV) — настоящие две ФС в юнит-тесте
// не поднять. Остальные функции fs — настоящие.
vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof fs>();
    return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

let ws: ITempWorkspace;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-movetopath-" });
});

afterEach(() => {
    vi.mocked(fs.renameSync).mockClear();
    ws.dispose();
});

function write(rel: string, content = "x"): string {
    return ws.writeFile(rel, content);
}

describe("moveToPath", () => {
    it("moves a file to the exact destination path", () => {
        const src = write("a.txt", "v1");
        const dest = ws.path("b.txt");

        moveToPath(src, dest);

        expect(fs.readFileSync(dest, "utf8")).toBe("v1");
        expect(fs.existsSync(src)).toBe(false);
    });

    it("falls back to copy+delete on cross-device rename (EXDEV)", () => {
        const src = write("dir/inner.txt", "deep");
        const srcDir = ws.path("dir");
        const dest = ws.path("moved");
        vi.mocked(fs.renameSync).mockImplementationOnce(() => {
            const error = new Error("cross-device link") as NodeJS.ErrnoException;
            error.code = "EXDEV";
            throw error;
        });

        moveToPath(srcDir, dest);

        expect(fs.readFileSync(path.join(dest, "inner.txt"), "utf8")).toBe("deep");
        expect(fs.existsSync(srcDir)).toBe(false);
        expect(fs.existsSync(src)).toBe(false);
    });

    it("rethrows non-EXDEV errors", () => {
        const src = write("a.txt");
        const dest = path.join(ws.dir, "no-such-dir", "a.txt");

        expect(() => {
            moveToPath(src, dest);
        }).toThrow();
        expect(fs.existsSync(src)).toBe(true); // источник не тронут
    });
});

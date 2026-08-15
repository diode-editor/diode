import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createTempWorkspace } from "./TempWorkspace.ts";

describe("createTempWorkspace", () => {
    it("создаёт каталог в os.tmpdir() с дефолтным префиксом", () => {
        const ws = createTempWorkspace();
        try {
            expect(fs.existsSync(ws.dir)).toBe(true);
            expect(path.basename(ws.dir).startsWith("diode-test-")).toBe(true);
            expect(path.dirname(ws.dir)).toBe(os.tmpdir());
        } finally {
            ws.dispose();
        }
    });

    it("уважает кастомный префикс", () => {
        const ws = createTempWorkspace({ prefix: "diode-custom-" });
        try {
            expect(path.basename(ws.dir).startsWith("diode-custom-")).toBe(true);
        } finally {
            ws.dispose();
        }
    });

    it("сеет файлы из options.files, включая вложенные пути", () => {
        const ws = createTempWorkspace({
            files: {
                "alpha.txt": "Alpha content",
                "nested/dir/beta.txt": "Beta content",
            },
        });
        try {
            expect(fs.readFileSync(ws.path("alpha.txt"), "utf-8")).toBe("Alpha content");
            expect(fs.readFileSync(ws.path("nested/dir/beta.txt"), "utf-8")).toBe("Beta content");
        } finally {
            ws.dispose();
        }
    });

    it("writeFile создаёт родительские каталоги и возвращает абсолютный путь", () => {
        const ws = createTempWorkspace();
        try {
            const filePath = ws.writeFile("sub/gamma.txt", "Gamma");
            expect(filePath).toBe(path.join(ws.dir, "sub/gamma.txt"));
            expect(fs.readFileSync(filePath, "utf-8")).toBe("Gamma");
        } finally {
            ws.dispose();
        }
    });

    it("path() резолвит запись внутри воркспейса без обращения к fs", () => {
        const ws = createTempWorkspace();
        try {
            expect(ws.path("missing.txt")).toBe(path.join(ws.dir, "missing.txt"));
            expect(fs.existsSync(ws.path("missing.txt"))).toBe(false);
        } finally {
            ws.dispose();
        }
    });

    it("dispose удаляет каталог рекурсивно и безопасен при повторном вызове", () => {
        const ws = createTempWorkspace({ files: { "a/b/c.txt": "x" } });
        ws.dispose();
        expect(fs.existsSync(ws.dir)).toBe(false);
        expect(() => {
            ws.dispose();
        }).not.toThrow();
    });
});

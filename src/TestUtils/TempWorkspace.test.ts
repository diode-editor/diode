import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createTempWorkspace } from "./TempWorkspace.ts";

describe("createTempWorkspace", () => {
    it("creates a directory in os.tmpdir() with the default prefix", () => {
        const ws = createTempWorkspace();
        try {
            expect(fs.existsSync(ws.dir)).toBe(true);
            expect(path.basename(ws.dir).startsWith("diode-test-")).toBe(true);
            expect(path.dirname(ws.dir)).toBe(os.tmpdir());
        } finally {
            ws.dispose();
        }
    });

    it("honors a custom prefix", () => {
        const ws = createTempWorkspace({ prefix: "diode-custom-" });
        try {
            expect(path.basename(ws.dir).startsWith("diode-custom-")).toBe(true);
        } finally {
            ws.dispose();
        }
    });

    it("seeds files from options.files, including nested paths", () => {
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

    it("writeFile creates parent directories and returns the absolute path", () => {
        const ws = createTempWorkspace();
        try {
            const filePath = ws.writeFile("sub/gamma.txt", "Gamma");
            expect(filePath).toBe(path.join(ws.dir, "sub/gamma.txt"));
            expect(fs.readFileSync(filePath, "utf-8")).toBe("Gamma");
        } finally {
            ws.dispose();
        }
    });

    it("path() resolves an entry inside the workspace without touching fs", () => {
        const ws = createTempWorkspace();
        try {
            expect(ws.path("missing.txt")).toBe(path.join(ws.dir, "missing.txt"));
            expect(fs.existsSync(ws.path("missing.txt"))).toBe(false);
        } finally {
            ws.dispose();
        }
    });

    it("dispose removes the directory recursively and is safe to call twice", () => {
        const ws = createTempWorkspace({ files: { "a/b/c.txt": "x" } });
        ws.dispose();
        expect(fs.existsSync(ws.dir)).toBe(false);
        expect(() => {
            ws.dispose();
        }).not.toThrow();
    });
});

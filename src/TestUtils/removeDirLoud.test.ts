import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { removeDirLoud } from "./removeDirLoud.ts";

describe("removeDirLoud", () => {
    let parent: string;

    beforeEach(() => {
        parent = fs.mkdtempSync(path.join(os.tmpdir(), "rmloud-case-"));
    });

    afterEach(() => {
        fs.chmodSync(parent, 0o700);
        fs.rmSync(parent, { recursive: true, force: true });
    });

    it("removes the directory with its contents", () => {
        const dir = path.join(parent, "doomed");
        fs.mkdirSync(path.join(dir, "nested"), { recursive: true });
        fs.writeFileSync(path.join(dir, "nested", "file.txt"), "junk");

        removeDirLoud(dir, "case");

        expect(fs.existsSync(dir)).toBe(false);
    });

    it("directory already gone — not an error and nothing to warn about", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        removeDirLoud(path.join(parent, "no-such"), "case");

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it.skipIf(process.platform === "win32")("removal failed — warns but does not fail the run", () => {
        const dir = path.join(parent, "stubborn");
        fs.mkdirSync(dir);
        // A real EACCES instead of mocking fs: an ESM module can't be reconfigured.
        fs.chmodSync(parent, 0o500);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        expect(() => {
            removeDirLoud(dir, "ExtensionTestHarness");
        }).not.toThrow();

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("[ExtensionTestHarness] failed to remove temp directory"),
            expect.anything(),
        );
        expect(fs.existsSync(dir)).toBe(true);
        warn.mockRestore();
    });
});

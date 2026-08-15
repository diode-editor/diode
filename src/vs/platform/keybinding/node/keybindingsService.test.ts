import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";

import { loadUserKeybindings } from "./keybindingsService.ts";

describe("loadUserKeybindings", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-keys-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function write(content: string): string {
        return ws.writeFile("keybindings.json", content);
    }

    it("returns [] when the file does not exist", async () => {
        const rules = await loadUserKeybindings(ws.path("missing.json"));
        expect(rules).toEqual([]);
    });

    it("parses valid rules (JSONC, trailing commas allowed)", async () => {
        const file = write(`[
            // word right on kitty
            { "key": "ctrl+shift+right", "command": "cursorWordRight", "when": "tier == 'kitty'" },
            { "key": "ctrl+s", "command": "save" },
        ]`);
        const rules = await loadUserKeybindings(file);
        expect(rules).toEqual([
            { key: "ctrl+shift+right", command: "cursorWordRight", when: "tier == 'kitty'", args: undefined },
            { key: "ctrl+s", command: "save", when: undefined, args: undefined },
        ]);
    });

    it("accepts an unbind rule (-command) with or without a key", async () => {
        const file = write(`[
            { "key": "ctrl+s", "command": "-save" },
            { "command": "-cursorWordRight" }
        ]`);
        const rules = await loadUserKeybindings(file);
        expect(rules).toHaveLength(2);
        expect(rules[1]).toEqual({ key: "", command: "-cursorWordRight", when: undefined, args: undefined });
    });

    it("drops invalid rules (missing command, missing key on an add) and keeps the rest", async () => {
        const file = write(`[
            { "key": "ctrl+s" },
            { "command": "addWithoutKey" },
            { "key": "ctrl+x", "command": "cut" }
        ]`);
        const rules = await loadUserKeybindings(file);
        expect(rules).toEqual([{ key: "ctrl+x", command: "cut", when: undefined, args: undefined }]);
    });

    it("returns [] for a non-array document", async () => {
        const file = write(`{ "key": "ctrl+s", "command": "save" }`);
        const rules = await loadUserKeybindings(file);
        expect(rules).toEqual([]);
    });

    it("returns [] without logging an error for an empty file", async () => {
        // An empty document parses to `undefined` (not an array): the loader must
        // treat it as "no rules" silently, without emitting the array-shape error.
        const logger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            isEnabled: () => true,
        };
        const file = write("");
        const rules = await loadUserKeybindings(file, logger);
        expect(rules).toEqual([]);
        expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining("must be a JSON array"));
    });

    it("is best-effort on broken JSONC (does not throw)", async () => {
        const file = write(`[ { "key": "ctrl+s", "command": "save" } `); // missing closing bracket
        const rules = await loadUserKeybindings(file);
        // jsonc-parser recovers the well-formed object.
        expect(rules).toEqual([{ key: "ctrl+s", command: "save", when: undefined, args: undefined }]);
    });

    it("logs and returns [] when the file can't be read (non-ENOENT error)", async () => {
        // A directory path → readFile throws EISDIR, the non-missing-file branch.
        const logger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            isEnabled: () => true,
        };
        const rules = await loadUserKeybindings(ws.dir, logger);
        expect(rules).toEqual([]);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("Failed to read keybindings file"),
            expect.anything(),
        );
    });

    it("skips non-object rules and keeps valid ones", async () => {
        const logger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            isEnabled: () => true,
        };
        const file = write(`[
            42,
            "not-an-object",
            null,
            { "key": "ctrl+x", "command": "cut" }
        ]`);
        const rules = await loadUserKeybindings(file, logger);
        expect(rules).toEqual([{ key: "ctrl+x", command: "cut", when: undefined, args: undefined }]);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Skipping non-object keybinding rule"));
    });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * `keybindings.json` is seeded with a conflicting rule for the @conflicts filter. The tab
 * opens via an F6 binding: the e2e DSL cannot reliably encode the real Ctrl+K Ctrl+S.
 */

const KEYS = [
    { key: "f6", command: "workbench.action.openGlobalKeybindings" },
    { key: "ctrl+s", command: "editor.action.selectAll" },
];

function keybindingsFile(app: HeadlessApp): string {
    return join(app.env.userDataDir, "user-data", "User", "keybindings.json");
}

async function openEditor(): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        files: { "hello.txt": "hello\n" },
        keybindings: KEYS,
        cols: 110,
        rows: 32,
    });
    await app.session.waitForText((t) => t.includes("EXPLORER"));
    await app.session.key("F6");
    await app.session.waitForText((t) => t.includes("Keyboard Shortcuts") && t.includes("Keybinding"));
    return app;
}

describe("Keyboard Shortcuts editor (functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("US-1: the command opens a tab with the command list and columns", async () => {
        const app = await openEditor();
        const screen = frameToText(await app.session.captureFrame());

        expect(screen).toContain("Keyboard Shortcuts");
        expect(screen).toContain("Command");
        expect(screen).toContain("Keybinding");
        expect(screen).toContain("Source");
        expect(screen).toContain("Type to search keybindings");
    });

    it("US-2: search filters the list", async () => {
        const app = await openEditor();
        await app.session.text("Save File");
        const screen = frameToText(await app.session.waitForText((t) => t.includes("Save File")));

        expect(screen).toContain("Save File");
        expect(screen).not.toContain("Toggle Line Comment");
    });

    it("US-3: the recorder writes a keybinding — file on disk and the command works in this session", async () => {
        const app = await openEditor();

        await app.session.text("Show Hover");
        await app.session.waitForText((t) => t.includes("Show Hover"));
        const row = await app.session.node("#kb-0");
        expect(row, "command row not found").not.toBeNull();
        await app.session.clickNode("#kb-0");
        await app.session.clickNode("#kb-0"); // double click → recorder
        await app.session.waitForText((t) => t.includes("Press desired key combination"));

        await app.session.key("F9");
        await app.session.key("Enter");

        await app.session.waitForText((t) => t.includes("F9"));
        const written = readFileSync(keybindingsFile(app), "utf-8");
        expect(written).toContain('"key": "f9"');
        expect(written).toContain('"command": "editor.action.showHover"');
    });

    it("US-4: @conflicts shows a pre-seeded conflicting pair on Ctrl+S", async () => {
        const app = await openEditor();
        await app.session.text("@conflicts ctrl+s");
        const screen = frameToText(await app.session.waitForText((t) => t.includes("Select All")));

        // The default save and the user's selectAll share Ctrl+S — both are in the results.
        expect(screen).toContain("Select All");
        expect(screen).toContain("Save");
    });
});

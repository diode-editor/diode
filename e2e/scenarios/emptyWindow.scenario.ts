import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";

import { explorerTitle } from "../helpers/explorerTitle.ts";

import { defineScenario } from "./framework.ts";

const MARKER = "demo-assets";

/** Small, so the whole file list fits in the frame. */
function makeFolder(): string {
    const dir = mkdtempSync(join(tmpdir(), "diode-empty-window-"));
    // Marker folder: the folders-only dialog lists only directories, so it shows the folder has finished loading.
    mkdirSync(join(dir, MARKER));
    writeFileSync(join(dir, "greeting.ts"), 'export const greeting = "hello";\n');
    writeFileSync(join(dir, "README.md"), "# Demo\n");
    return dir;
}

const folder = makeFolder();

export default defineScenario({
    name: "empty-window",
    title: "Launch without arguments: empty window and leaving it via Open Folder",
    open: [],
    cols: 120,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes(explorerTitle("No Folder Opened")) && t.includes("You have not yet opened a"));
        await editor.capture("empty");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+O");
        // The dialog starts in the home directory: replace the path entirely; a trailing separator enters the folder,
        // and Enter with no highlighted row selects it.
        await editor.waitForText((t) => t.includes("Open Folder") && t.includes(".."));
        await editor.capture("prompt");

        await editor.sendKey("Ctrl+A");
        await editor.sendText(folder + sep);
        // A long path (the temp directory on Windows) is scrolled, so only its tail is visible.
        await editor.waitForText((t) => t.includes(basename(folder) + sep) && t.includes(MARKER));
        await editor.sendKey("Enter");
        // The tree must fill in, not just lose the hint: a new root loads only on refresh.
        // The sidebar header is renamed after the opened folder at once.
        await editor.waitForText(
            (t) =>
                t.includes("greeting.ts") && t.includes(explorerTitle(folder)) && !t.includes("You have not yet opened a"),
        );
        await editor.capture("folder-opened");
    },
});

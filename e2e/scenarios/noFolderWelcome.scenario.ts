import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The editor starts on a single file with no folder; the way out is Enter on the welcome button,
// which has focus at once.

function makeLonelyFile(): string {
    const dir = mkdtempSync(join(tmpdir(), "diode-lonely-"));
    const file = join(dir, "lonely.txt");
    writeFileSync(file, "hello from a lonely file\n");
    return file;
}

const MARKER = "demo-assets";

/** The folder the demo ends with: its whole file list fits in the frame. */
function makeFolder(): string {
    const dir = mkdtempSync(join(tmpdir(), "diode-no-folder-"));
    // Marker: the folders-only dialog lists only directories, so it shows the folder has loaded.
    mkdirSync(join(dir, MARKER));
    writeFileSync(join(dir, "greeting.ts"), 'export const greeting = "hello";\n');
    writeFileSync(join(dir, "README.md"), "# Demo\n");
    return dir;
}

const lonelyFile = makeLonelyFile();
const folder = makeFolder();
// A fixture registry instead of the public marketplace: the demo must not depend on the network.
const registry = resolve(repoRoot, "e2e", "fixtures", "registry");

export default defineScenario({
    name: "no-folder-welcome",
    title: "Папка не открыта: welcome в сайдбаре и выход из состояния",
    open: [lonelyFile],
    extraArgs: [`--registry=${registry}`],
    cols: 120,
    rows: 26,
    async run(editor) {
        // 1. Explorer: text and a button instead of a flat line.
        await editor.waitForText((t) => t.includes("You have not yet opened a") && t.includes("[ Open Folder ]"));
        await editor.capture("explorer-welcome");

        // 2. Search without a folder doesn't pretend to work.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("f");
        await editor.waitForText((t) => t.includes("Search needs an open folder."));
        await editor.capture("search-welcome");

        // 3. Source Control: the same, instead of the commit input.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("g");
        await editor.waitForText((t) => t.includes("To use source control, open a"));
        await editor.capture("scm-welcome");

        // 4. The extensions marketplace needs no folder and fully works: the catalog
        //    renders and search filters it.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("x");
        await editor.waitForText((t) => t.includes("MARKETPLACE") && t.includes("Acme Sample"));
        await editor.sendText("tab");
        await editor.waitForText((t) => t.includes("Tab Setter") && !t.includes("Acme Sample"));
        await editor.capture("extensions-without-folder");

        // 5. Leaving the state: Explorer → focus already on the button → Enter.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("e");
        await editor.waitForText((t) => t.includes("[ Open Folder ]"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Open Folder") && t.includes(".."));
        await editor.sendKey("Ctrl+A");
        await editor.sendText(folder + sep);
        // A long path (the temp directory on Windows) is scrolled in the input, so only
        // its tail is visible.
        await editor.waitForText((t) => t.includes(basename(folder) + sep) && t.includes(MARKER));
        await editor.sendKey("Enter");
        // The tree must FILL, not just lose the welcome.
        await editor.waitForText((t) => t.includes("greeting.ts") && !t.includes("You have not yet opened a"));
        await editor.capture("folder-opened");

        // 6. After that, search and SCM work instead of showing welcome.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("f");
        await editor.waitForText((t) => !t.includes("Search needs an open folder.") && t.includes("SEARCH"));
        await editor.sendText("greeting");
        await editor.waitForText((t) => t.includes("greeting.ts"));
        await editor.capture("search-works");
    },
});

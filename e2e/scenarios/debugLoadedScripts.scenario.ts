import { resolve } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// LOADED SCRIPTS with the Debug Demo extension: its `./scripts` program has loaded sources (`loadedSources`), so the
// section comes in Run and Debug, collapsed; a click opens it with `hello.c` and the system headers under their
// folder, the one the `loadedSource` event added among them. Debug: Open Loaded Script... lists them in the quick
// input with the session's name; Enter opens the picked one.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-provider");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");

export default defineScenario({
    name: "debug-loaded-scripts",
    title: "LOADED SCRIPTS: the sources of the session in Run and Debug and Debug: Open Loaded Script...",
    seedUserData: userData,
    open: [folder],
    cols: 120,
    rows: 34,
    async run(editor) {
        await editor.waitForText((t) => t.includes(".diode"));
        await editor.waitForReady();

        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Pick the program to debug") && t.includes("./scripts"));
        await editor.sendText("scripts");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Hello from ./scripts"));
        await editor.sendKey("Ctrl+k");
        await editor.sendKey("b");
        await editor.waitForText((t) => t.includes("LOADED SCRIPTS"));

        const header = findTextCell(await editor.captureFrame(), "LOADED SCRIPTS");
        if (header === null) throw new Error("no LOADED SCRIPTS");
        await editor.click(header.x, header.y);
        await editor.waitForText((t) => t.includes("hello.c") && t.includes("/usr/include"));
        const include = findTextCell(await editor.captureFrame(), "/usr/include");
        if (include === null) throw new Error("no /usr/include");
        await editor.click(include.x + 2, include.y);
        await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("stdio.h") && t.includes("stdlib.h"));
        // The pane shows three rows: walk down to string.h (from the `loadedSource` event) so the tree scrolls to it.
        for (let i = 0; i < 3; i++) await editor.sendKey("ArrowDown");
        await editor.waitForText((t) => t.includes("string.h"));
        await editor.capture("view");

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Debug: Open Loaded Script");
        await editor.waitForText((t) => t.includes("Debug: Open Loaded Script..."));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Search loaded scripts by name") && t.includes("stdlib.h"));
        await editor.capture("picker");
        await editor.sendText("hello");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("hello.c ×"));

        await editor.sendKey("Shift+F5");
        await editor.waitForText((t) => !t.includes("LOADED SCRIPTS"));
    },
});

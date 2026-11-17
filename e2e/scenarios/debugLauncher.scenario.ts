import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Starting a debugger extension from Run and Debug: without launch.json the welcome's link asks for the debugger
// (the active file is C, the Debug Demo debugger names C++ only) and fills launch.json with its initial
// configurations; the launcher in the title then starts the selected one, and the extension's dynamic
// configurations are a row of the dropdown. launch.json is written, so the folder is a copy made in prepare.

const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");
const folder = mkdtempSync(join(tmpdir(), "diode-debug-launcher-"));
const helloC = join(folder, "hello.c");

/** The Run and Debug title: the second row; in the default sidebar the launcher's label is cut to 8 columns. */
function title(text: string): string {
    return text.split("\n")[1] ?? "";
}

export default defineScenario({
    name: "debug-launcher",
    title: "Run and Debug: create launch.json for a picked debugger, the launcher in the title, dynamic configurations",
    seedUserData: userData,
    open: [folder, helloC],
    cols: 120,
    rows: 32,
    async prepare() {
        copyFileSync(resolve(repoRoot, "e2e", "fixtures", "debug-provider", "hello.c"), helloC);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("int main"));
        await editor.waitForReady();

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("View: Show Run and Debug");
        await editor.waitForText((t) => t.includes("View: Show Run and Debug"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("create a launch.json"));
        await editor.capture("welcome");

        const link = findTextCell(await editor.captureFrame(), "create a launch.json");
        await editor.click(link.x + 2, link.y);
        await editor.waitForText((t) => t.includes("Select debugger") && t.includes("More Debug Demo options..."));
        await editor.capture("select-debugger");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes('"name": "Debug Demo"') && t.includes("${command:pickProgram}"));
        // The title's launcher: ▶, the configuration of the new launch.json, the gear.
        await editor.waitForText((t) => title(t).includes("Debug De"));
        await editor.capture("launch-json-created");

        // The dropdown: the configuration, the type with dynamic configurations, Add Configuration.
        const dropdown = findTextCell(await editor.captureFrame(), "Debug De");
        await editor.click(dropdown.x, dropdown.y);
        await editor.waitForText((t) => t.includes("Debug Demo...") && t.includes("Add Configuration..."));
        await editor.capture("dropdown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        // The extension is activated only now; its configurations of each launch come into the picker.
        await editor.waitForText((t) => t.includes("Select Launch Configuration") && t.includes("Demo: ./world"));
        await editor.capture("dynamic-configurations");
        await editor.sendText("world");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => title(t).includes("Demo: ./"));

        // ▶ before the configuration starts it: the adapter greets in the Debug Console and stops on entry.
        const selected = findTextCell(await editor.captureFrame(), "Demo: ./");
        await editor.click(selected.x - 2, selected.y);
        await editor.waitForText((t) => t.includes("Hello from ./world") && t.includes('program: "./world"'));
        await editor.capture("started");
    },
});

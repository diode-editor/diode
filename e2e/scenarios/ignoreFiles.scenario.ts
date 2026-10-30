import { resolve } from "node:path";

import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The fixture's `.gitignore`: `generated/` and `*.log`. Ignored files show in the tree (`explorer.excludeGitIgnore`
// is `false` upstream) but are not searched. The fixture files are added with `git add -f` since its own
// `.gitignore` ignores them.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "ignoreFiles");

export default defineScenario({
    name: "ignore-files",
    title: "search.useIgnoreFiles: .gitignore in Quick Open and search",
    open: [sampleDir],
    cols: 110,
    rows: 26,
    // The key DSL cannot express Ctrl+Shift+F, so the command is bound to F6.
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(editor) {
        await editor.waitForText(
            (t) => t.includes(explorerTitle(sampleDir)) && t.includes("generated") && t.includes("server.log") && t.includes("src"),
        );
        await editor.capture("tree");

        // An empty query lists only recently opened files: `.` matches every file of the fixture.
        await editor.sendKey("Ctrl+P");
        const picker = await editor.waitForNode("#quickInput");
        await editor.sendText(".");
        await editor.waitForText((t) => {
            const list = quickOpenText(t, picker.box);
            return (
                list.includes("app.ts") &&
                list.includes(".gitignore") &&
                !list.includes("client.ts") &&
                !list.includes("server.log")
            );
        });
        await editor.capture("quick-open");
        await editor.sendKey("Escape");

        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("SEARCH"));
        for (const ch of "quietHarborLamp") {
            await editor.sendKey(ch);
        }
        await editor.waitForText((t) => t.includes("1 results in 1 file") && t.includes("app.ts"));
        await editor.capture("search");
    },
});

/** The popup's columns from its top row down (it grows with the list): the tree beside it shows `server.log` too. */
function quickOpenText(frame: string, box: { x: number; y: number; width: number }): string {
    return frame
        .split("\n")
        .slice(box.y)
        .map((line) => line.slice(box.x, box.x + box.width))
        .join("\n");
}

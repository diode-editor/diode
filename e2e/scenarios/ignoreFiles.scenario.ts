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

        await editor.sendKey("Ctrl+P");
        await editor.waitForText((t) => {
            const list = quickOpenText(t);
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

/** Right of the popup's left border and below its title: the tree on the left shows `server.log` on the same rows. */
function quickOpenText(frame: string): string {
    const lines = frame.split("\n");
    const top = lines.findIndex((line) => line.includes("Go to File"));
    if (top === -1) return "";
    const left = lines[top].lastIndexOf("│", lines[top].indexOf("Go to File"));
    return lines
        .slice(top)
        .map((line) => line.slice(left))
        .join("\n");
}

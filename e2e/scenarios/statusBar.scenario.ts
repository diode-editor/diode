import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const sampleFile = resolve(repoRoot, "AGENTS.md");

export default defineScenario({
    name: "statusBar",
    title: "Status bar composed from tuidom primitives",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("Ln 1, Col 1") && t.includes("UTF-8"));
        await editor.capture("normal-width");

        const branch = await editor.waitForNode("#statusBarItem-status-scm-branch");
        await editor.sendMouse({ action: "move", button: "none", x: branch.box.x + 2, y: branch.box.y });
        await editor.capture("segment-hover");

        // The menu flips upward: the bar is the bottom row.
        await editor.sendMouse({ action: "press", button: "right", x: branch.box.x + 2, y: branch.box.y });
        await editor.sendMouse({ action: "release", button: "right", x: branch.box.x + 2, y: branch.box.y });
        await editor.waitForText((t) => t.includes("Hide 'Source Control'"));
        await editor.capture("visibility-menu");
        await editor.sendKey("Escape");

        // 30 columns, not 40: on CI the branch `main` is short, and at 40 both groups fit edge to edge — UTF-8 was not
        // pushed out and the wait hung until the timeout. Assert the push-out itself, not truncation: the left group's
        // width varies with the branch name.
        await editor.resize(30, 16);
        await editor.waitForText((t) => !t.includes("UTF-8"));
        await editor.capture("narrow-overflow");
    },
});

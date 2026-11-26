import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The sash between the TEST RESULTS output and its tree: invisible at rest, lit on hover, dragged to the left; Toggle
// Tree Position keeps the output's width and moves the sash to the new boundary.

const workspace = mkdtempSync(join(tmpdir(), "diode-testing-results-sash-"));
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-test-controller");

const MATH = `describe("math", () => {
    it("adds", () => {});
    it("fails", () => {});
});
`;

export default defineScenario({
    name: "testing-results-sash",
    title: "TEST RESULTS sash: hover, drag the boundary between the output and the tree, Toggle Tree Position",
    seedUserData: userData,
    open: [workspace],
    cols: 120,
    rows: 30,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    userKeybindings: [
        { key: "alt+j", command: "workbench.view.extension.test" },
        { key: "alt+k", command: "demoTests.discover" },
        { key: "alt+u", command: "testing.runSelected" },
        { key: "alt+w", command: "testing.toggleResultsViewLayout" },
    ],
    async prepare() {
        mkdirSync(join(workspace, "src"), { recursive: true });
        writeFileSync(join(workspace, "src", "math.test.js"), MATH);
    },
    async run(editor) {
        await editor.waitForReady();
        await editor.sendKey("Alt+j");
        await editor.waitForText((t) => t.includes("No tests have been found"), { timeoutMs: 20_000 });
        await editor.sendKey("Alt+k");
        await editor.waitForText((t) => t.includes(" src") && t.includes("No test results yet."));
        await editor.sendKey("Alt+u");
        await editor.waitForText((t) => t.includes("done") && t.includes("expected 2 to equal 3"), {
            timeoutMs: 20_000,
        });

        const view = (await editor.waitForNode("#testResultsView")).box;
        const half = view.width - Math.floor(view.width / 2);
        const sashX = view.x + half;
        const midY = view.y + Math.floor(view.height / 2);
        await editor.capture("before: the output and the tree in halves, no line between them");

        await editor.sendMouse({ action: "move", button: "none", x: sashX, y: midY });
        await editor.capture("hover: the sash on the tree's first column lights up");

        const target = view.x + 30;
        await editor.sendMouse({ action: "press", button: "left", x: sashX, y: midY });
        await editor.sendMouse({ action: "move", button: "left", x: target, y: midY });
        await editor.sendMouse({ action: "release", button: "left", x: target, y: midY });
        const tree = (await editor.waitForNode("#testResultsTree")).box;
        if (tree.x !== target) throw new Error(`the tree at column ${tree.x}, expected ${target}`);
        await editor.capture("dragged to the left: the output is 30 columns, the tree takes the rest");

        await editor.sendKey("Alt+w");
        const output = view.x + view.width - 30;
        await editor.waitForText((t) => {
            const row = t.split("\n").find((line) => line.includes("fails math"));
            return row !== undefined && row.indexOf("fails math") < output;
        });
        const swapped = (await editor.waitForNode("#testResultsTree")).box;
        if (swapped.x !== view.x) throw new Error(`the tree at column ${swapped.x}, expected ${view.x}`);
        await editor.sendMouse({ action: "move", button: "none", x: output, y: midY });
        await editor.capture("Toggle Tree Position: the tree on the left, the output keeps its 30 columns, the sash at the new boundary");
    },
});

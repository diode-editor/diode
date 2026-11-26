import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// `demo-test-controller` writes colored output for the run and for each test. Run Tests opens the TEST RESULTS panel
// by itself (`testing.automaticallyOpenTestResults: openOnTestStart`): the run's tree on the right, its output live on
// the left. Choosing the failed test shows its own output, its message the message's text; Toggle Tree Position puts
// the tree on the left.

const workspace = mkdtempSync(join(tmpdir(), "diode-testing-results-"));
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-test-controller");

const MATH = `describe("math", () => {
    it("adds", () => {});
    it("fails", () => {});
});
`;

export default defineScenario({
    name: "testing-results",
    title: "TEST RESULTS panel: the run's tree, its colored output, a test's output, its message, the tree's position",
    seedUserData: userData,
    open: [workspace],
    cols: 120,
    rows: 30,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // J, K, U, W: F/E/S/V/G/H/T are menu bar mnemonics and O is the SS3 prefix.
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
        await editor.waitForText((t) => t.includes("TEST RESULTS") && t.includes("RUN") && t.includes("running adds"), {
            timeoutMs: 15_000,
        });
        await editor.capture("Run Tests opens TEST RESULTS: the run's output live on the left, its tree on the right");

        const done = await editor.waitForText((t) => t.includes("done") && t.includes("expected 2 to equal 3"), {
            timeoutMs: 15_000,
        });
        await editor.capture("after the run: the failed test first with its message, the whole colored output");

        const fails = findTextCell(done, "fails math");
        if (fails === null) throw new Error("no `fails` row in TEST RESULTS");
        await editor.click(fails.x, fails.y);
        await editor.waitForText((t) => t.includes("FAIL fails") && !t.includes("done"));
        await editor.capture("the failed test chosen: its own output");

        await editor.sendKey("Alt+w");
        await editor.waitForText((t) => {
            const row = t.split("\n").find((line) => line.includes("fails math"));
            const output = t.split("\n").find((line) => line.includes("FAIL fails"));
            return row !== undefined && output !== undefined && row.indexOf("fails math") < output.indexOf("FAIL");
        });
        await editor.capture("Toggle Tree Position: the tree on the left, the choice kept");
    },
});

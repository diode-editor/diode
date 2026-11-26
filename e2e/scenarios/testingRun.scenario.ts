import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `demo-test-controller`'s Run profile steps through `math.test.js` (each test ~0.7 s): Run Tests in the title spins
// the title, the summary and the running row, Cancel takes Run's place. After the run: passed, failed, errored and
// skipped in their colors with durations, the summary with the dominant state and Rerun Last Run. Rerun Failed Tests
// runs only the failed and the errored; Cancel Test Run in the middle of a run stops it.

const workspace = mkdtempSync(join(tmpdir(), "diode-testing-run-"));
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-test-controller");

const MATH = `describe("math", () => {
    it("adds", () => {});
    it("fails", () => {});
    it("throws", () => {});
    it("skip me", () => {});
});
`;

const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
// The state glyphs are Nerd Font codicons here: the frame is checked by its text.

export default defineScenario({
    name: "testing-run",
    title: "Testing View: Run Tests, states and durations in the tree, the summary, Rerun Failed, Cancel",
    seedUserData: userData,
    open: [workspace],
    cols: 100,
    rows: 24,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // J, K, U, Y, X: F/E/S/V/G/H/T are menu bar mnemonics and O is the SS3 prefix; the Ctrl+; chords are upstream's.
    userKeybindings: [
        { key: "alt+j", command: "workbench.view.extension.test" },
        { key: "alt+k", command: "demoTests.discover" },
        { key: "alt+u", command: "testing.runSelected" },
        { key: "alt+y", command: "testing.reRunFailTests" },
        { key: "alt+x", command: "testing.cancelRun" },
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
        // Opening the container again puts the keyboard into the filter; ArrowDown goes on to the first row.
        await editor.sendKey("Alt+j");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("math.test.js"));
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes(" math "), { timeoutMs: 10_000 });
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("skip me"));

        await editor.sendKey("Alt+u");
        await editor.waitForText((t) => SPINNER.test(t) && t.includes(" 0/"), { timeoutMs: 10_000 });
        await editor.capture("the run spins in the title, the summary and the rows; Cancel takes Run's place");

        await editor.waitForText((t) => t.includes(" 1/3 ") && t.includes("fails 20ms") && t.includes("adds 10ms"), {
            timeoutMs: 15_000,
        });
        await editor.capture("after the run: passed, failed, errored, skipped with durations; the summary and Rerun");

        await editor.sendKey("Alt+y");
        await editor.waitForText((t) => SPINNER.test(t), { timeoutMs: 10_000 });
        await editor.waitForText((t) => t.includes(" 0/2 ") && !SPINNER.test(t), { timeoutMs: 15_000 });
        await editor.capture("Rerun Failed Tests ran only the failed and the errored");

        await editor.sendKey("Alt+u");
        await editor.waitForText((t) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] adds/.test(t), { timeoutMs: 10_000 });
        await editor.sendKey("Alt+x");
        // Nothing passed or failed: the skipped do not count.
        await editor.waitForText((t) => t.includes(" 0/0 ") && !SPINNER.test(t), { timeoutMs: 15_000 });
        await editor.capture("Cancel Test Run in the middle: the unfinished tests are skipped");
    },
});

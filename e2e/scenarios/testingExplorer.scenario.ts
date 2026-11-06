import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `demo-test-controller` registers a test controller: the Testing container appears with it and shows the welcome
// until Discover Tests lists `src/*.test.js`; a file's `describe`/`it` come a second later on its expand (spinner).
// Then the filter `!fails`, Enter goes to the test, and the row's context menu runs the extension's Update Snapshot
// with the extension's own TestItem.

const workspace = mkdtempSync(join(tmpdir(), "diode-testing-explorer-"));
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-test-controller");

const MATH = `describe("math", () => {
    it("adds", () => {});
    it("fails", () => {});
    it("slow sum", () => {});
});
`;

const STRINGS = `describe("strings", () => {
    it("trims", () => {});
});
`;

export default defineScenario({
    name: "testing-explorer",
    title: "Testing View: welcome, tests from an extension's controller, lazy resolve, filter, Go to Test, row menu",
    seedUserData: userData,
    open: [workspace],
    cols: 100,
    rows: 24,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // J and K: F/E/S/V/G/H/T are menu bar mnemonics and O is the SS3 prefix.
    userKeybindings: [
        { key: "alt+j", command: "workbench.view.extension.test" },
        { key: "alt+k", command: "demoTests.discover" },
    ],
    async prepare() {
        mkdirSync(join(workspace, "src"), { recursive: true });
        writeFileSync(join(workspace, "src", "math.test.js"), MATH);
        writeFileSync(join(workspace, "src", "strings.test.js"), STRINGS);
    },
    async run(editor) {
        await editor.waitForReady();
        await editor.sendKey("Alt+j");
        await editor.waitForText((t) => t.includes("No tests have been found"), { timeoutMs: 20_000 });
        await editor.capture("welcome while the controller has no tests");

        await editor.sendKey("Alt+k");
        await editor.waitForText((t) => t.includes("src") && t.includes("Filter (e.g."));
        // Opening the container again puts the keyboard into the filter; ArrowDown goes on to the first row.
        await editor.sendKey("Alt+j");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("math.test.js") && t.includes("strings.test.js"));
        await editor.capture("the tests the controller listed");

        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => /TEST EXPLORER [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(t));
        await editor.capture("a file resolves its tests");

        await editor.waitForText((t) => t.includes(" math "), { timeoutMs: 10_000 });
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("slow sum ~2s"));
        await editor.capture("describe and it with a description");

        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Ln 2, Col 5"));
        await editor.capture("Enter goes to the test and keeps the tree focused");

        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("Update Snapshot") && t.includes("Go to Test"));
        await editor.capture("the row's menu with the extension's item");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Update Snapshot: adds"));
        await editor.capture("the extension got its TestItem");

        // From `adds` up to `src`, and one more up leaves the tree for the filter.
        for (let i = 0; i < 4; i++) await editor.sendKey("ArrowUp");
        await editor.sendText("!fails");
        await editor.waitForText((t) => t.includes("!fails") && t.includes("slow sum") && !t.includes(" fails "));
        await editor.capture("the filter excludes a test");
    },
});

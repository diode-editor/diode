import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// `demo-test-controller`'s tests from the editor: the cursor in `fails` and Ctrl+; C runs only it; its failure shows
// after its line — the failed icon and `2 != 3` (the message's actual and expected) on the error badge. A click on
// the badge opens TEST RESULTS on that message; Ctrl+; F runs the whole file.

const workspace = mkdtempSync(join(tmpdir(), "diode-testing-inline-"));
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-test-controller");
const file = join(workspace, "src", "math.test.js");

const MATH = `describe("math", () => {
    it("adds", () => {});
    it("fails", () => {});
});
`;

// Nerd Font codicons: `run`, `error`, `pass`.
const RUN = "";
const FAILED = "";
const PASSED = "";

export default defineScenario({
    name: "testing-inline-messages",
    title: "Test failures inline in the editor: run the test at the cursor, its message after the line, TEST RESULTS on a click",
    seedUserData: userData,
    open: [workspace, file],
    cols: 110,
    rows: 24,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // K: F/E/S/V/G/H/T are menu bar mnemonics and O is the SS3 prefix.
    userKeybindings: [{ key: "alt+k", command: "demoTests.discover" }],
    async prepare() {
        mkdirSync(join(workspace, "src"), { recursive: true });
        writeFileSync(file, MATH);
    },
    async run(editor) {
        await editor.waitForReady();
        await editor.waitForText((t) => t.includes('it("fails"'));
        await editor.sendKey("Alt+k");
        // The file's tests resolve a second and a half after the gutter asks for them.
        await editor.waitForText((t) => t.includes(RUN), { timeoutMs: 20_000 });

        // The cursor on `fails`' line: Down twice from the file's start.
        await editor.sendKey("Down");
        await editor.sendKey("Down");
        await editor.sendKey("Ctrl+;");
        await editor.sendKey("c");
        const failed = await editor.waitForText((t) => t.includes("2 != 3"), { timeoutMs: 15_000 });
        await editor.capture("Ctrl+; C in fails ran only it: its failure after the line, the failed icon and 2 != 3");

        const rows = frameToText(failed).split("\n");
        const y = rows.findIndex((row) => row.includes("2 != 3"));
        await editor.click(rows[y].indexOf("2 != 3"), y);
        await editor.waitForText((t) => t.includes("TEST RESULTS") && t.includes("expected 2 to equal 3"));
        await editor.capture("a click on the message: TEST RESULTS with it chosen, the keyboard still in the editor");

        await editor.sendKey("Ctrl+;");
        await editor.sendKey("f");
        await editor.waitForText(
            (t) => {
                const line = t.split("\n").find((row) => row.includes('it("adds"'));
                return line !== undefined && line.includes(PASSED) && t.includes(FAILED);
            },
            { timeoutMs: 20_000 },
        );
        await editor.capture("Ctrl+; F ran the whole file: adds passed, fails failed again with its message");
    },
});

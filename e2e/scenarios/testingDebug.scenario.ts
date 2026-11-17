import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { findTextCell, frameToText } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// `demo-test-controller`'s Debug profile, as vitest.explorer's: a right click on `fails`' glyph has Debug Test after
// Run Test; choosing it makes the extension's `runHandler` start a `demo-tests` debug session that stops on `fails`'
// line — the debug toolbar is over the editor, the test spins in the gutter. Continue ends the session and the
// extension reports the test passed.

const workspace = mkdtempSync(join(tmpdir(), "diode-testing-debug-"));
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-test-controller");
const file = join(workspace, "src", "math.test.js");

const MATH = `describe("math", () => {
    it("adds", () => {});
    it("fails", () => {});
});
`;

// Nerd Font codicons: `run-all`, `run`, `pass`.
const RUN_ALL = "\ueb9e";
const RUN = "\ueb2c";
const PASSED = "\ueba4";

export default defineScenario({
    name: "testing-debug",
    title: "Debug Test from the gutter: the extension's debug session stops on the test, Continue passes it",
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
        const failsRow = (t: string): string => t.split("\n").find((row) => row.includes('it("fails"')) ?? "";
        const before = await editor.waitForText((t) => t.includes(RUN_ALL) && failsRow(t).includes(RUN), {
            timeoutMs: 20_000,
        });
        await editor.capture("before: run-all on the suite, run on each test");
        const rows = frameToText(before).split("\n");
        const y = rows.findIndex((row) => row.includes('it("fails"'));
        const x = rows[y].indexOf(RUN);

        await editor.sendMouse({ x, y, button: "right", action: "press" });
        await editor.sendMouse({ x, y, button: "right", action: "release" });
        const menu = await editor.waitForText((t) => t.includes("Run Test") && t.includes("Debug Test"));
        await editor.capture("the glyph's menu: Debug Test after Run Test");

        const item = findTextCell(menu, "Debug Test");
        if (item === null) throw new Error("Debug Test is not on screen");
        await editor.click(item.x, item.y);
        await editor.waitForText((t) => t.includes("Continue") && t.includes("fails"), { timeoutMs: 15_000 });
        await editor.capture("the extension's debug session stopped on fails: the toolbar over the editor");

        await editor.sendKey("F5");
        await editor.waitForText((t) => !t.includes("Continue") && t.split("\n")[y].includes(PASSED), {
            timeoutMs: 15_000,
        });
        await editor.capture("Continue ended the session: the extension reported fails passed");
    },
});

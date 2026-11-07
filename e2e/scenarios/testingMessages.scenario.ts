import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// `demo-test-controller` fails three tests with three kinds of messages. In TEST RESULTS the expected/actual one is a
// diff of "Expected result" against "Actual result", the markdown one is drawn as the hover draws markdown, the one
// with a stack lists the frames under it; a click on a frame with a place opens the file there. "Copy Error" over
// the message (`testing/message/content`) runs the extension's command with the message.

const workspace = mkdtempSync(join(tmpdir(), "diode-testing-messages-"));
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-test-controller");

const MATH = `describe("math", () => {
    it("fails", () => {});
    it("fails markdown", () => {});
    it("fails stack", () => {});
});
`;

export default defineScenario({
    name: "testing-messages",
    title: "TEST RESULTS messages: the expected/actual diff, markdown, the stack's frames, Copy Error",
    seedUserData: userData,
    open: [workspace],
    cols: 120,
    rows: 30,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // J, K, U: F/E/S/V/G/H/T are menu bar mnemonics and O is the SS3 prefix.
    userKeybindings: [
        { key: "alt+j", command: "workbench.view.extension.test" },
        { key: "alt+k", command: "demoTests.discover" },
        { key: "alt+u", command: "testing.runSelected" },
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
        const done = await editor.waitForText(
            (t) => t.includes("done") && t.includes("expected 2 to equal 3") && t.includes("TypeError"),
            { timeoutMs: 20_000 },
        );

        const click = async (frame: Parameters<typeof findTextCell>[0], text: string): Promise<void> => {
            const cell = findTextCell(frame, text);
            if (cell === null) throw new Error(`no "${text}" on the screen`);
            await editor.click(cell.x, cell.y);
        };
        await click(done, "expected 2 to equal 3");
        const diff = await editor.waitForText((t) => t.includes("Expected result") && t.includes("Actual result"));
        await editor.capture("the expected/actual message: a diff, Expected result 3 against Actual result 2");

        await click(diff, "Snapshot mismatch");
        const markdown = await editor.waitForText((t) => t.includes("expected 3") && !t.includes("Expected result"));
        await editor.capture("the markdown message: the heading and the list without their markup");

        await click(markdown, "TypeError");
        const stack = await editor.waitForText((t) => t.includes("at fails stack") && t.includes("node:internal"));
        await editor.capture("the message with a stack: the test's header, the message, the frames under it");

        await click(stack, "Copy Error");
        await editor.waitForText((t) => t.includes("Copied the error of fails stack"));
        await editor.capture("Copy Error over the message: the extension's command got the test and the message");

        await click(stack, "at fails stack");
        await editor.waitForText((t) => t.includes("math.test.js") && t.includes('it("fails stack"'));
        await editor.capture("a click on the frame opened the file at its line");
    },
});

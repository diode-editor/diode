import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// `demo-test-controller`'s tests in the editor gutter: once the file's tests resolve, the suite's line has run-all,
// each test's line run, left of the line numbers. A click on `fails`' glyph runs only it and its glyph turns into the
// failed icon in red; a right click on `adds`' glyph opens its menu with the extension's `testing/item/gutter` item.

const workspace = mkdtempSync(join(tmpdir(), "diode-testing-gutter-"));
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-test-controller");
const file = join(workspace, "src", "math.test.js");

const MATH = `describe("math", () => {
    it("adds", () => {});
    it("fails", () => {});
});
`;

// Nerd Font codicons: `run-all`, `run`, `error`.
const RUN_ALL = "";
const RUN = "";
const FAILED = "";

export default defineScenario({
    name: "testing-gutter",
    title: "Test glyphs on the editor gutter: run from the gutter, the state after the run, the glyph's menu",
    seedUserData: userData,
    open: [workspace, file],
    cols: 100,
    rows: 20,
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
        const before = await editor.waitForText((t) => t.includes(RUN_ALL) && t.includes(RUN), { timeoutMs: 20_000 });
        await editor.capture("before a run: run-all on the suite's line, run on each test's");

        const rows = frameToText(before).split("\n");
        const glyphAt = (label: string): { x: number; y: number } => {
            const y = rows.findIndex((row) => row.includes(`it("${label}"`));
            return { x: rows[y].indexOf(RUN), y };
        };
        const fails = glyphAt("fails");
        await editor.click(fails.x, fails.y);
        await editor.waitForText((t) => t.split("\n")[fails.y].includes(FAILED), { timeoutMs: 15_000 });
        await editor.capture("a click on fails' glyph ran only it: the failed icon in red, adds still to run");

        const adds = glyphAt("adds");
        await editor.sendMouse({ x: adds.x, y: adds.y, button: "right", action: "press" });
        await editor.sendMouse({ x: adds.x, y: adds.y, button: "right", action: "release" });
        await editor.waitForText((t) => t.includes("Reveal in Test Explorer") && t.includes("Update Snapshot"));
        await editor.capture("a right click on adds' glyph: Run Test, Reveal in Test Explorer and the extension's item");
    },
});

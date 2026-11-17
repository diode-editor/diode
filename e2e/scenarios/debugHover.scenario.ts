import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The debug hover with the Debug Demo extension, stopped on entry in `main` of `hello.c`: Ctrl+K Ctrl+I over `argv`
// asks the extension's evaluatable expression provider (the `dbg:` item names the word it gave: the text around the
// cursor would be `**argv`), the adapter has no evaluate for hovers, so the value is found in the frame's scopes and
// its children are a tree under it; the arrows walk it, Escape closes it. Over `argc` it is the plain value.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-provider");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");
const sourceFile = resolve(folder, "hello.c");

const MAIN_LINE = "int main(int argc, char **argv) {";

export default defineScenario({
    name: "debug-hover",
    title: "Debug hover: Ctrl+K Ctrl+I over a variable — its value, the children as a tree, the extension's expression",
    seedUserData: userData,
    open: [folder, sourceFile],
    cols: 120,
    rows: 30,
    async run(editor) {
        await editor.waitForText((t) => t.includes("hello.c"));
        await editor.waitForReady();
        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Pick the program to debug"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("dap:stopped") && t.includes("frame 1 of thread 1"));

        // The stop puts the cursor on line 3, `int main(...)`: to `argv` in it.
        await editor.sendKey("Home");
        for (let i = 0; i < MAIN_LINE.indexOf("argv") + 1; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+k");
        await editor.sendKey("Ctrl+i");
        await editor.waitForText((t) => t.includes("dbg:hover argv") && t.includes('[1]: "--demo"'));
        await editor.capture("argv-tree");

        await editor.sendKey("ArrowDown");
        await editor.capture("walked");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes('[1]: "--demo"'));

        // `argc`: a plain value.
        for (let i = 0; i < "argv".length + "char **".length + 2; i++) await editor.sendKey("ArrowLeft");
        await editor.sendKey("Ctrl+k");
        await editor.sendKey("Ctrl+i");
        await editor.waitForText((t) => t.includes("dbg:hover argc") && /│2 *│/u.test(t));
        await editor.capture("argc-value");
        await editor.sendKey("Escape");
    },
});

import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The `inline-ghost` fixture is a fake "LLM" with canned completions and a ~250 ms response delay.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "ghost-sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-inline-ghost");

export default defineScenario({
    name: "inline-completion",
    title: "Ghost text from an inline completion provider (Tab to accept)",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Fibonacci demo"));

        await editor.sendKey("End");
        await editor.sendKey("Enter");
        await editor.sendText("function fib");

        // The extension activates asynchronously; on failure retype the last character (new edit → new request).
        // Esc before retyping guards against the activation race: until the provider exists, the word-based suggest
        // popup opens, and ghost text is not drawn under it.
        let ghostShown = false;
        for (let attempt = 0; attempt < 10 && !ghostShown; attempt++) {
            try {
                await editor.waitForText((t) => t.includes("return fibonacci(n - 1)"), { timeoutMs: 2000 });
                ghostShown = true;
            } catch {
                await editor.sendKey("Escape");
                await editor.sendKey("Backspace");
                await editor.sendKey("b");
            }
        }
        if (!ghostShown) throw new Error("inline-completion: ghost text did not appear in 10 attempts");
        await editor.capture("ghost");

        // While the text was ghost text the cursor stayed on Ln 2, so "Ln 5" proves the insertion.
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Ln 5"), { timeoutMs: 4000 });
        await editor.capture("accepted");

        // Request n-4: with the cursor mid-line, ghost text goes between the cursor and the line's tail, not over it.
        await editor.sendKey("End");
        await editor.sendKey("Enter");
        await editor.sendText("// greeting for the demo");
        await editor.sendKey("Home");
        await editor.sendText("const greeting");
        let midLineShown = false;
        for (let attempt = 0; attempt < 10 && !midLineShown; attempt++) {
            try {
                await editor.waitForText((t) => t.includes('greeting = "Hello from ghost text!";// greeting'), {
                    timeoutMs: 2000,
                });
                midLineShown = true;
            } catch {
                await editor.sendKey("Escape");
                await editor.sendKey("Backspace");
                await editor.sendKey("g");
            }
        }
        if (!midLineShown) throw new Error("inline-completion: mid-line ghost text did not appear in 10 attempts");
        await editor.capture("ghost-mid-line");

        // Col 43 = 14 typed + 28 inserted + 1.
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Col 43"), { timeoutMs: 4000 });
        await editor.capture("mid-line-accepted");
    },
});

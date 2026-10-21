import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const userData = resolve(here, "fixtures", "user-data-with-inline-ghost");

const FIB_BODY = "onacci(n) {\n    if (n <= 1) return n;\n    return fibonacci(n - 1) + fibonacci(n - 2);\n}";
/** Fixture provider's continuation for the `const greeting` trigger. */
const GREETING_BODY = ' = "Hello from ghost text!";';

interface IGhostState {
    line: number;
    character: number;
    lines: string[];
}

// The extension host subprocess flakes in e2e on Windows (see docs/TESTING.md).
const describeLinuxOnly = process.platform === "linux" ? describe : describe.skip;

/**
 * Retypes the trigger's last character until ghost text appears: a request sent before
 * the provider registers (activation is async) returns nothing. Escape before retyping
 * closes the buffer-word suggest popup — ghost text is not drawn under it.
 */
async function waitForGhostRetyping(
    session: {
        key(name: string): Promise<void>;
        waitForState(
            selector: string,
            predicate: (s: Record<string, unknown> | undefined) => boolean,
            opts?: { timeoutMs?: number },
        ): Promise<{ state?: Record<string, unknown> }>;
    },
    lastChar: string,
): Promise<{ state?: Record<string, unknown> }> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await session.waitForState("EditorElement", (s) => (s?.ghostText ?? null) !== null, {
                timeoutMs: 2000,
            });
        } catch (error) {
            if (attempt >= 10) throw error;
            await session.key("Escape");
            await session.key("Backspace");
            await session.key(lastChar);
        }
    }
}

describeLinuxOnly("inline completions — ghost text from a user extension", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    it("typing the trigger shows ghost text, Tab accepts in one edit, undo removes it entirely", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            files: { "sample.ts": "// Fibonacci demo\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("End");
        await session.key("Enter");
        await session.text("function fib");

        // The document is unchanged: the ghost text lives in view zones.
        const withGhost = await waitForGhostRetyping(session, "b");
        const ghost = withGhost.state?.ghostText as IGhostState;
        expect(ghost).toEqual({ line: 1, character: 12, lines: FIB_BODY.split("\n") });
        expect(withGhost.state?.viewZones).toEqual([{ afterLine: 1, size: 3 }]);
        expect(withGhost.state?.lineCount).toBe(3); // "// Fibonacci demo", "function fib", trailing empty line
        await session.waitForText((t) => t.includes("return fibonacci(n - 1)"), { timeoutMs: 5000 });

        await session.key("Tab");
        const accepted = await session.waitForState(
            "EditorElement",
            (s) => s?.ghostText === null && s?.lineCount === 6,
            { timeoutMs: 5000 },
        );
        expect(accepted.state?.viewZones).toEqual([]);
        await session.waitForText((t) => t.includes("Ln 5"), { timeoutMs: 5000 });

        // Accepting is one undo operation: Ctrl+Z removes the WHOLE insertion at once.
        await session.key("Ctrl+Z");
        await session.waitForState("EditorElement", (s) => s?.lineCount === 3, { timeoutMs: 5000 });
    }, 120_000);

    // Upstream: `editor.quickSuggestions` → `offWhenInlineCompletions` — quick suggest
    // waits for the ghost text request to settle.
    it("quick suggest yields to ghost text: with a suggestion no popup, without one the popup opens", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            // "fibber" in the buffer: without yielding, "fi"/"fib" would open the popup.
            files: { "sample.ts": "// fibber demo\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("End");
        await session.key("Enter");
        await session.text("function fib");

        await waitForGhostRetyping(session, "b");
        // Longer than the quick suggest wait window (750 ms): the popup never opened.
        await new Promise((r) => setTimeout(r, 1500));
        expect(await session.node("CompletionListElement")).toBeFalsy();
        expect(((await session.node("EditorElement"))?.state?.ghostText as IGhostState).lines[0]).toBe("onacci(n) {");

        // The provider has nothing for "fibb" — the popup opens after the empty response.
        await session.key("b");
        await session.waitForNode("CompletionListElement", { timeoutMs: 5000 });
        const editor = await session.node("EditorElement");
        expect(editor?.state?.ghostText ?? null).toBeNull();
    }, 120_000);

    it("Esc closes the suggest popup and ghost text appears without another edit", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            // The word "fibber" in the buffer keeps the word-based popup alive on "fib":
            // at the full ghost trigger the popup is guaranteed to be open.
            files: { "sample.ts": "// fibber demo\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("End");
        await session.key("Enter");
        // Open the popup EXPLICITLY (Ctrl+Space on "fi"): the edit below is guaranteed to land
        // on an open popup, with no race against auto-suggest timings.
        await session.text("function fi");
        await session.key("Ctrl+Space");
        await session.waitForNode("CompletionListElement", { timeoutMs: 5000 });

        // The ghost response is not drawn under an open popup — the popup stays.
        await session.key("b");
        await session.waitForNode("CompletionListElement", { timeoutMs: 5000 });
        const held = await session.node("EditorElement");
        expect(held?.state?.ghostText ?? null).toBeNull();

        // Ghost text appears WITHOUT a new edit: the ready response returns to screen at once.
        await session.key("Escape");
        await session.waitForNoNode("CompletionListElement", { timeoutMs: 5000 });
        const withGhost = await session.waitForState("EditorElement", (s) => (s?.ghostText ?? null) !== null, {
            timeoutMs: 5000,
        });
        expect((withGhost.state?.ghostText as IGhostState).lines[0]).toBe("onacci(n) {");
    }, 120_000);

    it("cursor mid-line: ghost text renders before the tail, Tab inserts, Esc restores the line", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            files: { "sample.ts": "// demo\n)\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("ArrowDown");
        await session.key("Home");
        await session.text("const greeting");

        const withGhost = await waitForGhostRetyping(session, "g");
        const ghost = withGhost.state?.ghostText as IGhostState;
        expect(ghost).toEqual({ line: 1, character: 14, lines: [GREETING_BODY] });
        await session.waitForText((t) => t.includes(`const greeting${GREETING_BODY})`), { timeoutMs: 5000 });
        // Ghost text does not touch the document: still 3 lines.
        expect(withGhost.state?.lineCount).toBe(3);

        // Tab inserts the suggestion mid-line: the cursor is after the insertion,
        // before the tail; the ")" tail stays in place.
        await session.key("Tab");
        const accepted = await session.waitForState("EditorElement", (s) => s?.ghostText === null, {
            timeoutMs: 5000,
        });
        expect(accepted.state?.selections).toEqual([
            {
                anchor: { line: 1, character: 14 + GREETING_BODY.length },
                active: { line: 1, character: 14 + GREETING_BODY.length },
                collapsed: true,
            },
        ]);
        await session.waitForText((t) => t.includes(`const greeting${GREETING_BODY})`), { timeoutMs: 5000 });

        // Undo — the line is `const greeting)` again, without the suggestion.
        await session.key("Ctrl+Z");
        await session.waitForText((t) => !t.includes("Hello from ghost text"), { timeoutMs: 5000 });
    }, 120_000);

    it("cursor mid-line: Esc hides ghost text and restores the original line", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            files: { "sample.ts": "// demo\n)\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("ArrowDown");
        await session.key("Home");
        await session.text("const greeting");

        await waitForGhostRetyping(session, "g");

        await session.key("Escape");
        const hidden = await session.waitForState("EditorElement", (s) => s?.ghostText === null, {
            timeoutMs: 5000,
        });
        expect(hidden.state?.lineCount).toBe(3);
        await session.waitForText((t) => !t.includes("Hello from ghost text"), { timeoutMs: 5000 });
        await session.waitForText((t) => t.includes("const greeting)"), { timeoutMs: 5000 });
    }, 120_000);

    // Manual mode: `enabled: false` gates ONLY the automatic request (as in vscode);
    // the `editor.action.inlineSuggest.trigger` command works independently.
    // The key is Alt+\ (the terminal sends it as ESC + `\`).
    it("enabled:false — typing does not trigger ghost text, Alt+\\ does", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            settings: { "editor.inlineSuggest.enabled": false },
            files: { "sample.ts": "// Fibonacci demo\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("End");
        await session.key("Enter");
        await session.text("function fib");

        // The extension activates asynchronously; wait for it with a probe Alt+\ —
        // which is also the first assertion: the manual trigger works with the setting
        // off. Retries only guard against the activation race.
        let ghost: IGhostState | null = null;
        for (let attempt = 0; attempt < 15 && ghost === null; attempt++) {
            await session.key("Alt+\\");
            try {
                const shown = await session.waitForState("EditorElement", (s) => (s?.ghostText ?? null) !== null, {
                    timeoutMs: 2000,
                });
                ghost = shown.state?.ghostText as IGhostState;
            } catch {
                // provider not registered yet — try again
            }
        }
        if (ghost === null) throw new Error("Alt+\\ did not show ghost text in 15 attempts");
        expect(ghost.lines[0]).toBe("onacci(n) {");

        // Now the main point: with the setting off, TYPING does not request ghost text.
        // Esc hides the shown one; type a new trigger and wait well past the default
        // debounce (50 ms) and the fixture's response delay (250 ms).
        await session.key("Escape");
        await session.waitForState("EditorElement", (s) => s?.ghostText === null, { timeoutMs: 5000 });
        await session.key("Enter");
        await session.text("const greeting");
        await new Promise((r) => setTimeout(r, 3000));
        const quiet = await session.node("EditorElement");
        expect(quiet?.state?.ghostText ?? null).toBeNull();

        // …and Alt+\ at the same position yields ghost text: the gate was silent, not the provider.
        await session.key("Alt+\\");
        const manual = await session.waitForState("EditorElement", (s) => (s?.ghostText ?? null) !== null, {
            timeoutMs: 5000,
        });
        expect((manual.state?.ghostText as IGhostState).lines[0]).toBe(GREETING_BODY);
    }, 120_000);

    // `requestTimeout` is read on EVERY request: with the setting raised, a provider
    // slower than the default 5000 ms is waited for.
    it("requestTimeout lets a provider slower than the default finish", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            settings: {
                // The fixture responds after 7 s — the default 5000 ms would not survive that.
                "inlineGhost.responseDelay": 7000,
                "editor.inlineSuggest.requestTimeout": 20000,
                // Quick suggest waits for ghost text at most 750 ms (as upstream), then
                // opens the buffer-word popup ("Fibonacci") and drops the ghost
                // request — this test checks the timeout, not that.
                "editor.quickSuggestions": false,
            },
            files: { "sample.ts": "// Fibonacci demo\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("End");
        await session.key("Enter");
        await session.text("function fib");

        // Wait longer than 7 s — with the default timeout there would be no ghost text at all.
        // Retries guard against the activation race: each attempt is a new edit (a new request).
        let ghost: IGhostState | null = null;
        for (let attempt = 0; attempt < 3 && ghost === null; attempt++) {
            try {
                const shown = await session.waitForState("EditorElement", (s) => (s?.ghostText ?? null) !== null, {
                    timeoutMs: 12_000,
                });
                ghost = shown.state?.ghostText as IGhostState;
            } catch {
                await session.key("Backspace");
                await session.key("b");
            }
        }
        if (ghost === null) throw new Error("the slow provider was never shown");
        expect(ghost.lines[0]).toBe("onacci(n) {");
    }, 180_000);

    it("Escape hides the suggestion without touching the document", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            files: { "sample.ts": "const x = 1\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");
        await session.key("End");
        await session.key("Enter");
        await session.text("const greeting");

        await waitForGhostRetyping(session, "g");

        await session.key("Escape");
        const hidden = await session.waitForState("EditorElement", (s) => s?.ghostText === null, {
            timeoutMs: 5000,
        });
        // The document is unchanged: single-line ghost text adds no zones, 3 lines.
        expect(hidden.state?.viewZones).toEqual([]);
        expect(hidden.state?.lineCount).toBe(3);
    }, 120_000);
});

import { beforeAll, describe, expect, it } from "vitest";

import { BASEDPYRIGHT_ID } from "../src/TestUtils/basedpyrightFixture.ts";
import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * The client inside the vsix forks the bundled server (TransportKind.ipc → fork process.execPath) —
 * which is exactly what exercises the runAsNode env fix under SEA.
 */

const DEFS_PY = 'def greet(name: str) -> str:\n    return "hi " + name\n';
// A type error — for the squiggle (readiness).
const MAIN_PY = 'from defs import greet\n\nreply: int = greet("world")\nprint(reply)\n';

const UNDERCURL = 8;

const FILES = { "defs.py": DEFS_PY, "main.py": MAIN_PY };

async function waitForServerReady(session: {
    captureFrame: () => Promise<{ cells: { style: number }[] }>;
}): Promise<void> {
    await waitUntil(
        () => session.captureFrame(),
        (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
        { describe: "undercurl squiggle from basedpyright", timeoutMs: 180_000, intervalMs: 500 },
    );
}

// Linux only: extension host + a forked language server (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin" || MARKETPLACE_OFFLINE)(
    "SEA binary — stock basedpyright.vsix (Python LSP)",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("hover: Ctrl+K Ctrl+U shows a signature from another file", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [BASEDPYRIGHT_ID],
                open: ["main.py"],
            });
            await session.waitForNode("EditorElement");
            await waitForServerReady(session);

            // Cursor on `greet` in the call (line 2, column 15) and Ctrl+K Ctrl+U.
            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 15; i++) await session.key("ArrowRight");
            await session.key("Ctrl+K");
            await session.key("Ctrl+U");

            // The signature comes from the declaration in defs.py — main.py's buffer doesn't contain it.
            await session.waitForText((text) => text.includes("greet(name: str) -> str"), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });

            await session.key("Escape");
            const frame = await waitUntil(
                () => session.captureFrame(),
                (f) => !frameToText(f).includes("greet(name: str) -> str"),
                { describe: "hover popup closed by Escape", timeoutMs: 30_000, intervalMs: 250 },
            );
            // Not the whole call: basedpyright's parameter inlay hint may stand before the argument.
            expect(frameToText(frame)).toContain("reply: int = greet(");
        });

        it("F12 jumps to the greet declaration in defs.py", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [BASEDPYRIGHT_ID],
                open: ["main.py"],
            });
            await session.waitForNode("EditorElement");
            await waitForServerReady(session);

            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 15; i++) await session.key("ArrowRight");
            await session.key("F12");

            // Cursor on the declaration (0-based 0:4).
            await session.waitForText((text) => text.includes('return "hi " + name'), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });
            await session.waitForState(
                "EditorElement",
                (state) => {
                    const selections = state?.selections as
                        | { active: { line: number; character: number } }[]
                        | undefined;
                    const active = selections?.[0]?.active;
                    return active?.line === 0 && active.character === 4;
                },
                { timeoutMs: 30_000 },
            );
        });

        it("a dot opens a popup with int members from typeshed", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [BASEDPYRIGHT_ID],
                open: ["main.py"],
            });
            await session.waitForNode("EditorElement");
            await waitForServerReady(session);

            await session.key("Ctrl+End");
            // Via keypresses: a trigger character opens the popup only when typed, not pasted.
            for (const char of "reply.") await session.key(char);

            // Items from the START of the alphabetical list: below the LSP items come word-based candidates
            // from the buffer, and the tail (bit_length, to_bytes) is beyond the visible rows.
            await session.waitForText((text) => text.includes("as_integer_ratio") && text.includes("bit_count"), {
                timeoutMs: 120_000,
                intervalMs: 500,
            });
        });

        it("'(' opens parameter hints with the greet signature", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [BASEDPYRIGHT_ID],
                open: ["main.py"],
            });
            await session.waitForNode("EditorElement");
            await waitForServerReady(session);

            await session.key("Ctrl+End");
            for (const char of "greet(") await session.key(char);

            await session.waitForText((text) => text.includes("(name: str) -> str"), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });
        });

        it("Ctrl+K Ctrl+R collects references from two files into the REFERENCES viewlet", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [BASEDPYRIGHT_ID],
                // The sidebar viewlet is built only with an open folder (see references.test.ts).
                open: [".", "main.py"],
            });
            await session.waitForNode("EditorElement");
            await waitForServerReady(session);

            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 15; i++) await session.key("ArrowRight");
            await session.key("Ctrl+K");
            await session.key("Ctrl+R");

            // The declaration line is pulled from defs.py, which isn't in an open buffer.
            await session.waitForText((text) => text.includes("results in 2") && text.includes("def greet"), {
                timeoutMs: 120_000,
                intervalMs: 500,
            });
        });
    },
);

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findTextCell } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

// The built-in Merge Conflict (extensions/merge-conflict, upstream's code as is) ships with the binary: nothing is
// installed, the lenses are there on the first open of a file with conflict markers. A click on the lens of the first
// of two conflicts resolves only it, the second keeps its lens; Compare shows both sides through the content provider,
// whose ranges survive `JSON.stringify` only in the upstream shape of `Range.toJSON`.

const conflict = (n: string): string => `<<<<<<< HEAD\nours ${n}\n=======\ntheirs ${n}\n>>>>>>> branch\n`;

// Linux only: needs the extension host.
describe.skipIf(process.platform !== "linux")("SEA binary — built-in Merge Conflict", () => {
    it("lenses, compare, accept incoming of one conflict, save", { timeout: 120_000 }, async () => {
        const app = await useHeadlessApp({
            files: { "conflict.txt": `intro\n${conflict("one")}middle\n${conflict("two")}end\n` },
            open: [".", "conflict.txt"],
        });
        const { session } = app;
        const frame = await session.waitForText((t) => t.includes("Accept Incoming Change"), { timeoutMs: 40_000 });
        const lens = findTextCell(frame, "Accept Incoming Change");
        expect(lens).not.toBeNull();
        if (lens === null) return;

        await session.executeCommand("merge-conflict.next");
        await session.executeCommand("merge-conflict.compare");
        await session.waitForText((t) => t.includes("ours one") && t.includes("theirs one") && t.includes("↔"), {
            timeoutMs: 20_000,
        });
        await session.executeCommand("workbench.action.closeActiveEditor");
        await session.waitForText((t) => !t.includes("↔"), { timeoutMs: 20_000 });

        await session.click(lens.x, lens.y);
        await session.waitForText((t) => t.includes("theirs one") && !t.includes("ours one"), { timeoutMs: 20_000 });
        await session.waitForText((t) => t.includes("Accept Incoming Change") && t.includes("ours two"), {
            timeoutMs: 20_000,
        });
        await session.key("Ctrl+S");
        const file = join(app.env.root, "workspace", "conflict.txt");
        await waitUntil(
            () => readFileSync(file, "utf8"),
            (text) => text === `intro\ntheirs one\nmiddle\n${conflict("two")}end\n`,
            { describe: "the incoming side of the first conflict in the file", timeoutMs: 20_000 },
        );
    });
});

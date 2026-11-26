import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const userData = resolve(here, "fixtures", "user-data-with-reveal-range-sequence");

const describeLinuxOnly = process.platform === "linux" ? describe : describe.skip;

/** The view must not only reach the row but stay there: there is no event for "nothing else will scroll". */
const SETTLE_MS = 1500;
const sleep = (ms: number): Promise<void> =>
    new Promise((done) => {
        setTimeout(done, ms);
    });

function numbered(prefix: string): string {
    return Array.from({ length: 500 }, (_, i) => `${prefix}-${String(i)}.`).join("\n") + "\n";
}

function topRow(text: string, prefix: string): number | undefined {
    const match = new RegExp(`${prefix}-(\\d+)\\.`).exec(text);
    return match === null ? undefined : Number(match[1]);
}

async function start() {
    const { session } = await useHeadlessApp({
        seedUserData: userData,
        files: { "main.txt": numbered("main"), "other.txt": numbered("other") },
        open: [".", "main.txt"],
        cols: 120,
        rows: 30,
    });
    await session.waitForText((text) => text.includes("main-0."));
    await session.waitForReady();
    return session;
}

/**
 * #963: `revealRange` called right after the call extensions pair it with. Only a real process shows it: the unit
 * harness renders on request and the same sequences pass there.
 */
describeLinuxOnly("extension API — TextEditor.revealRange in a sequence", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    it("holds on an editor just returned by showTextDocument", async () => {
        const session = await start();

        await session.executeCommand("revealSequence.openAndReveal");
        await session.waitForText((text) => text.includes("other-"), { timeoutMs: 20_000 });
        await session.waitForIdle();
        const right = topRow(frameToText(await session.captureFrame()), "other");
        await sleep(SETTLE_MS);

        expect({ right, later: topRow(frameToText(await session.captureFrame()), "other") }).toEqual({
            right: 250,
            later: 250,
        });
    }, 120_000);

    it("holds right after an awaited editor.edit", async () => {
        const session = await start();

        await session.executeCommand("revealSequence.editAndReveal");
        await session.waitForIdle();
        const right = topRow(frameToText(await session.captureFrame()), "main");
        await sleep(SETTLE_MS);

        expect({ right, later: topRow(frameToText(await session.captureFrame()), "main") }).toEqual({
            right: 250,
            later: 250,
        });
    }, 120_000);
});

import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

const LINE = "2026-01-01T00:00:00.000Z INFO worker request handled path=/api/v1/items";

/**
 * ~5.6 MiB: above the 1 MiB threshold set below, so the file opens on disk (docs/arch/Editor.md), and longer than
 * the first chunk of the index (4 MiB) — the reload of the new file clamps the cursor, and follow goes on with it.
 */
const LINES = 66_000;

function bigLog(tag: string, lines = LINES): string {
    return Array.from({ length: lines }, (_, i) => `${tag} ${String(i)} ${LINE}`).join("\n") + "\n";
}

const NEW_TAIL = "rotated-log-new-tail";

/**
 * Follow (OpenPerformance 4.4) on the SEA binary, on every e2e runner, Windows included: the document on disk
 * holds a descriptor on the log for as long as the tab is open (`nodeRandomAccessFile.ts`), and the logger that
 * writes the log rotates it by renaming it — `mv app.log app.log.1` and a new `app.log`. PR #802 names the risk
 * itself: "the open descriptor still blocks the rename" on Windows. Then the logger's rotation fails for as long
 * as the log is open in diode. Here the test process is the logger: the rename must succeed, and the editor
 * must move on to the new file with the cursor on its end.
 */
describe("follow on SEA: a log open in diode is rotated by rename", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("the open log can be renamed, and the new file under its name is followed", async () => {
        const { session, env } = await useHeadlessApp({
            files: { "app.log": bigLog("old") },
            settings: { "editor.largeFileSizeThreshold": 1 },
            open: ["app.log"],
        });
        const path = join(env.workspaceDir, "app.log");
        await session.waitForText((t) => t.includes("Follow: Off"), { timeoutMs: 30_000 });
        await session.executeCommand("notifications.clearAll");
        await session.sendKey("Ctrl+End");
        await session.waitForText((t) => t.includes(`Ln ${String(LINES + 1)}`) && t.includes("Follow: On"));

        let renameError: unknown = null;
        try {
            renameSync(path, join(env.workspaceDir, "app.log.1"));
        } catch (error) {
            renameError = error;
        }
        expect(renameError).toBeNull();

        // The new log is above the threshold too: this test is about the rename, not about a small new file.
        writeFileSync(path, bigLog("new") + `${NEW_TAIL}\n`);
        await session.waitForText(
            (t) => t.includes(NEW_TAIL) && t.includes(`Ln ${String(LINES + 2)}`) && t.includes("Follow: On"),
            {
                timeoutMs: 30_000,
            },
        );
    }, 120_000);
});

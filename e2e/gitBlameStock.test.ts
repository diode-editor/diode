import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, it } from "vitest";

import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Stock Git Blame (`waderyan.gitblame`) from the marketplace, version not pinned (docs/TESTING.md). The frame is the
 * oracle.
 * - It activates on `onFileSystem:file` (its `workspaceContains:**\/.git/HEAD` is hidden by `files.exclude`, as in
 *   VS Code) and finds git through `git.path`, whose default must be `null`, not an empty string.
 * - With `inlineMessageEnabled` it puts the blame after the current line: an empty range at column
 *   `MAX_SAFE_INTEGER` with an `after` text and a MarkdownString `hoverMessage`; Show Hover at the line end shows
 *   that message (with `extendedHoverInformation: "inline"` — the commit summary).
 */

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

const SUMMARY = "feat: the answer";

// Linux only: the extension host is spawned (docs/TODO/E2E.md).
describe.skipIf(process.platform !== "linux" || MARKETPLACE_OFFLINE)("SEA binary — stock Git Blame", () => {
    let repoDir = "";

    beforeAll(async () => {
        await getBinaryPath();
        repoDir = mkdtempSync(join(tmpdir(), "diode-gitblame-"));
        git(repoDir, "init", "-q");
        git(repoDir, "config", "user.email", "ann@example.com");
        git(repoDir, "config", "user.name", "Ann Blame");
        git(repoDir, "config", "commit.gpgsign", "false");
        writeFileSync(join(repoDir, "a.ts"), "const answer = 42;\nconsole.log(answer);\n");
        git(repoDir, "add", "-A");
        git(repoDir, "commit", "-qm", SUMMARY);
    }, 300_000);

    afterAll(() => {
        if (repoDir) rmSync(repoDir, { recursive: true, force: true });
    });

    it(
        "[api:DecorationOptions.hoverMessage] the blame stands after the line; Ctrl+K Ctrl+U at the line end shows the commit",
        { timeout: 180_000 },
        async () => {
            const { session } = await useHeadlessApp({
                settings: {
                    "gitblame.inlineMessageEnabled": true,
                    "gitblame.extendedHoverInformation": "inline",
                },
                installVsix: ["waderyan.gitblame"],
                open: [repoDir, join(repoDir, "a.ts")],
                cwd: repoDir,
                cols: 120,
                rows: 20,
            });
            await session.waitForReady();
            await session.key("End");
            await session.waitForText((t) => t.includes("const answer = 42;    Blame Ann Blame ("), {
                timeoutMs: 60_000,
            });

            await session.key("Ctrl+K");
            await session.key("Ctrl+U");
            await session.waitForText((t) => t.includes(`Summary: ${SUMMARY}`) && t.includes("Author: Ann Blame"), {
                timeoutMs: 20_000,
            });
        },
    );
});

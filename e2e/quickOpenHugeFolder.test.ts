import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Issue #1179: `diode .` in a home directory with 14.5M files ran the editor process out of heap ~40 s after
 * start — the Quick Open index held every path in the main process. The index lives in the extension host now
 * and stops at `MAX_INDEXED_FILES` (500 000). The fake rg (`DIODE_RIPGREP_PATH`) prints 3M paths in a second
 * instead of a real tree of millions of files.
 *
 * The cap is checked by what Quick Open finds: the needle comes first, then `module0`…, so the last path the
 * index takes is `module499998` and `module499999` is the first one dropped. Fuzzily, no path under the cap
 * matches `module499999` (it needs five nines after a 4, which only paths past the cap have).
 */

const PATHS = 3_000_000;
const LAST_INDEXED = "module499998";
const FIRST_DROPPED = "module499999";

function rssMb(pid: number): number {
    const status = fs.readFileSync(`/proc/${String(pid)}/status`, "utf8");
    return Number(/VmRSS:\s+(\d+)\s+kB/u.exec(status)?.[1]) / 1024;
}

describe.skipIf(process.platform !== "linux")("SEA binary — Quick Open on a folder with millions of files", () => {
    let dir: string;
    let fakeRg: string;

    beforeAll(async () => {
        await getBinaryPath();
        dir = fs.mkdtempSync(join(os.tmpdir(), "diode-huge-folder-"));
        fakeRg = join(dir, "rg");
        fs.writeFileSync(
            fakeRg,
            [
                "#!/bin/sh",
                // Only the file walk is huge; every other rg (workspaceContains, text search) finds nothing.
                'case "$*" in',
                `  *--files*) echo src/needle.ts; exec awk 'BEGIN { for (i = 0; i < ${String(PATHS)}; i++) print "deps/pkg" int(i / 1000) "/generated/module" i ".ts" }' ;;`,
                "esac",
                "exit 0",
                "",
            ].join("\n"),
        );
        fs.chmodSync(fakeRg, 0o755);
    }, 300_000);

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("finds files up to the cap and none past it; the editor process stays small", { timeout: 120_000 }, async () => {
        const { session } = await useHeadlessApp({
            files: { "README.md": "# notes\n" },
            open: ["."],
            env: { DIODE_RIPGREP_PATH: fakeRg },
            cols: 120,
            rows: 30,
        });
        const editorPid = session.pid;
        expect(editorPid).toBeDefined();

        await session.key("Ctrl+P");
        await session.waitForText((t) => t.includes("Go to File"));
        await session.text("needle");
        await session.waitForText((t) => t.includes("needle.ts"), { timeoutMs: 60_000 });

        // The last path under the cap shows up: the index took everything up to it.
        for (let i = 0; i < "needle".length; i++) await session.key("Backspace");
        await session.text(LAST_INDEXED);
        await session.waitForText((t) => t.includes(`${LAST_INDEXED}.ts`), { timeoutMs: 60_000 });

        // One more nine: the rows of the previous answer stay until the new one lands, and it is empty.
        await session.key("Backspace");
        await session.text("9");
        const frame = await session.waitForText((t) => t.includes(FIRST_DROPPED) && !t.includes(`${LAST_INDEXED}.ts`), {
            timeoutMs: 60_000,
        });
        expect(frame).toBeDefined();

        // The list never entered the editor process (3M paths cost it ~2 GB before the move).
        expect(rssMb(editorPid!)).toBeLessThan(800);
    });
});

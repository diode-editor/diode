import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";

import { getSelfExtractPath } from "./helpers/buildOnce.ts";
import { usePtyApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = resolve(here, "fixtures", "sample.ts");

const KEYWORD_FG = packRgb(0x56, 0x9c, 0xd6);

// ConPTY makes per-cell screen assertions unreliable outside Linux; same guard as
// in sea-*.test.ts. The stub itself is POSIX sh, so there's no binary on Windows at all.
const itLinuxOnly = process.platform === "linux" ? it : it.skip;

/**
 * #144: the replacement for the broken SEA on Intel macOS. The point is that the app really
 * starts and reads `diode.bundle` from disk via the fs loader.
 */
describe.skipIf(process.platform === "win32")("self-extract binary", () => {
    let binary = "";
    let cacheHome = "";

    beforeAll(async () => {
        binary = await getSelfExtractPath();
        // The stub must honor XDG_CACHE_HOME: the developer's ~/.cache stays untouched.
        cacheHome = mkdtempSync(join(tmpdir(), "diode-xdg-cache-"));
    }, 300_000);

    afterAll(() => {
        rmSync(cacheHome, { recursive: true, force: true });
    });

    function run(args: string[], options: { cwd?: string } = {}) {
        return spawnSync(binary, args, {
            encoding: "utf8",
            timeout: 60_000,
            env: { ...process.env, XDG_CACHE_HOME: cacheHome },
            ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        });
    }

    function unpackedDir(): string {
        const entries = readdirSync(join(cacheHome, "diode")).filter((e) => !e.startsWith("."));
        expect(entries).toHaveLength(1);
        return join(cacheHome, "diode", entries[0]);
    }

    it("extracts into XDG_CACHE_HOME and prints the version", () => {
        const result = run(["--version"]);

        expect(result.status).toBe(0);
        expect(result.signal).toBeNull();
        expect(result.stdout.trim()).not.toBe("");

        const dir = unpackedDir();
        for (const file of ["node", "main.cjs", "diode.bundle", "lazy/yauzl.cjs", ".ready"]) {
            expect(existsSync(join(dir, file)), `${file} must be extracted`).toBe(true);
        }
        // The directory is published fully ready: the marker is written before the rename.
        expect(existsSync(join(dir, ".lock"))).toBe(false);
    });

    it("a second run does not extract again", () => {
        run(["--version"]);
        const marker = join(unpackedDir(), "node");
        const before = statSync(marker).mtimeMs;

        const second = run(["--version"]);

        expect(second.status).toBe(0);
        expect(statSync(marker).mtimeMs).toBe(before);
    });

    it("propagates the application's exit code", () => {
        // Unknown flag → CliArgsError → exit 2. `exec` in the stub passes the code through as is.
        const result = run(["--definitely-not-a-flag"]);

        expect(result.status).toBe(2);
        expect(result.signal).toBeNull();
    });

    it("works from an arbitrary cwd", () => {
        const cwd = mkdtempSync(join(tmpdir(), "diode-elsewhere-"));
        try {
            const result = run(["--version"], { cwd });

            expect(result.status).toBe(0);
            expect(result.stdout.trim()).not.toBe("");
            // Production must not litter a log into the user's cwd (the isPackagedRuntime gate).
            expect(existsSync(join(cwd, "diode.log"))).toBe(false);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    itLinuxOnly("starts the editor and reads diode.bundle from disk — highlighting works", async () => {
        // user-data/HOME are isolated by usePtyApp, but XDG_CACHE_HOME stays shared
        // (warmed up by unpacking in the previous `run()` calls), so it's passed
        // explicitly: the extra env overrides the isolated cache.
        const { session } = await usePtyApp({ binary, open: [fixturePath], env: { XDG_CACHE_HOME: cacheHome } });

        // The first frame with text has no highlighting (tokenization lands in the next frame); wait for color.
        const screen = await session.waitFor((s) => {
            const pos = s.findText("const greeting");
            return pos !== null && s.cellAt(pos.x, pos.y).fg === KEYWORD_FG;
        });

        // `const` in the keyword color = the grammar + onig.wasm really loaded from
        // the appended bundle via the fs loader. This is what all of #144 was for.
        const constPos = screen.findText("const greeting");
        expect(constPos).not.toBeNull();
        expect(screen.cellAt(constPos!.x, constPos!.y).fg).toBe(KEYWORD_FG);
    });
});

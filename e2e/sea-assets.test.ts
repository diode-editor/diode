import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { usePtyApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = resolve(here, "fixtures", "sample.ts");

const KEYWORD_FG = packRgb(0x56, 0x9c, 0xd6);

const itLinuxOnly = process.platform === "linux" ? it : it.skip;

describe("SEA binary — bundled assets", () => {
    let binary = "";

    beforeAll(async () => {
        binary = await getBinaryPath();
    }, 180_000);

    it("dist/ has no Extensions/ directory after the build (everything is inside diode.bundle)", () => {
        const distDir = dirname(binary);
        const entries = readdirSync(distDir);
        expect(entries).toContain("diode.bundle");
        expect(entries).not.toContain("Extensions");
    });

    itLinuxOnly("works from an arbitrary cwd without files next to the binary — highlighting from the bundle", async () => {
        // Copy the binary into an empty directory and run it from there: the SEA carries its assets inside,
        // not in sidecar files.
        const tmp = mkdtempSync(join(tmpdir(), "diode-sea-isolated-"));
        try {
            const isolatedBinary = join(tmp, "diode");
            copyFileSync(binary, isolatedBinary);
            const isolatedFixture = join(tmp, "sample.ts");
            copyFileSync(fixturePath, isolatedFixture);

            expect(existsSync(join(tmp, "diode.bundle"))).toBe(false);
            expect(existsSync(join(tmp, "Extensions"))).toBe(false);

            const { session } = await usePtyApp({ binary: isolatedBinary, cwd: tmp, open: [isolatedFixture] });
            // The frame with text arrives before highlighting (tokenization lands in the next frame); wait for color.
            const screen = await session.waitFor((s) => {
                const pos = s.findText("const greeting");
                return pos !== null && s.cellAt(pos.x, pos.y).fg === KEYWORD_FG;
            });

            // The keyword color proves the grammar was actually loaded from the bundle.
            const constPos = screen.findText("const greeting");
            expect(constPos).not.toBeNull();
            const sample = screen.cellAt(constPos!.x, constPos!.y);
            expect(sample.fg).toBe(KEYWORD_FG);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    it("the build directory contains every bundle embedded in the SEA (build regression)", () => {
        // The directory is the one holding the binary itself: e2e builds into a cache keyed by source hash
        // (scripts/e2e-artifacts.mjs), not into the working dist/.
        for (const name of [
            "diode.bundle",
            "node-pty.bundle",
            "rg.bundle",
            "ts-server.bundle",
            "ts-server.bundle.sha256",
        ]) {
            expect(existsSync(join(dirname(binary), name)), name).toBe(true);
        }
    });
});

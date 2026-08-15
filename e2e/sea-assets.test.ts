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
const repoRoot = resolve(here, "..");

const KEYWORD_FG = packRgb(0x56, 0x9c, 0xd6);

const itLinuxOnly = process.platform === "linux" ? it : it.skip;

describe("SEA binary — bundled assets", () => {
    let binary = "";

    beforeAll(async () => {
        binary = await getBinaryPath();
    }, 180_000);

    it("dist/ не содержит каталога Extensions/ после сборки (всё внутри vexx.bundle)", () => {
        const distDir = dirname(binary);
        const entries = readdirSync(distDir);
        expect(entries).toContain("vexx.bundle");
        expect(entries).not.toContain("Extensions");
    });

    itLinuxOnly("работает из произвольного cwd без файлов рядом с бинарём — подсветка из bundle", async () => {
        // Копируем бинарь в пустой каталог (никаких vexx.bundle/Extensions рядом)
        // и запускаем ИМЕННО его из этого cwd: SEA несёт ассеты внутри себя, а не в
        // sidecar-файлах. `usePtyApp` изолирует user-data/HOME, `binary`+`cwd`
        // указывают на копию.
        const tmp = mkdtempSync(join(tmpdir(), "vexx-sea-isolated-"));
        try {
            const isolatedBinary = join(tmp, "vexx");
            copyFileSync(binary, isolatedBinary);
            const isolatedFixture = join(tmp, "sample.ts");
            copyFileSync(fixturePath, isolatedFixture);

            // Sanity: рядом с бинарём нет ассетов.
            expect(existsSync(join(tmp, "vexx.bundle"))).toBe(false);
            expect(existsSync(join(tmp, "Extensions"))).toBe(false);

            const { session } = await usePtyApp({ binary: isolatedBinary, cwd: tmp, open: [isolatedFixture] });
            const screen = await session.waitFor((s) => s.findText("const greeting") !== null);

            // Минимальная проверка подсветки — `const` должен быть keyword-цветом,
            // что доказывает что грамматика реально загрузилась из bundle.
            const constPos = screen.findText("const greeting");
            expect(constPos).not.toBeNull();
            const sample = screen.cellAt(constPos!.x, constPos!.y);
            expect(sample.fg).toBe(KEYWORD_FG);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    it("repoRoot/dist всё ещё содержит vexx.bundle (регресс на сборку)", () => {
        expect(existsSync(join(repoRoot, "dist", "vexx.bundle"))).toBe(true);
    });
});

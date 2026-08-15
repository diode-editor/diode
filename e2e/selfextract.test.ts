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

// ConPTY делает посимвольные ассерты экрана ненадёжными вне Linux — тот же гард,
// что в sea-*.test.ts. Сам стаб — POSIX sh, поэтому под Windows нет и бинаря.
const itLinuxOnly = process.platform === "linux" ? it : it.skip;

/**
 * Self-extracting бинарь (#144) — замена сломанному SEA на Intel macOS.
 *
 * Здесь проверяется контракт стаба (идемпотентная распаковка, проброс argv/кода
 * возврата, независимость от cwd) и то, ради чего всё затевалось: приложение
 * реально стартует и читает `diode.bundle` с диска fs-загрузчиком.
 */
describe.skipIf(process.platform === "win32")("self-extract binary", () => {
    let binary = "";
    let cacheHome = "";

    beforeAll(async () => {
        binary = await getSelfExtractPath();
        // Изолированный кэш: тест не должен зависеть от ~/.cache разработчика и не
        // должен его засорять. Стаб обязан уважать XDG_CACHE_HOME.
        cacheHome = mkdtempSync(join(tmpdir(), "vexx-xdg-cache-"));
    }, 300_000);

    afterAll(() => {
        rmSync(cacheHome, { recursive: true, force: true });
    });

    /** Запускает бинарь синхронно с изолированным кэшем. */
    function run(args: string[], options: { cwd?: string } = {}) {
        return spawnSync(binary, args, {
            encoding: "utf8",
            timeout: 60_000,
            env: { ...process.env, XDG_CACHE_HOME: cacheHome },
            ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        });
    }

    /** Единственный каталог распаковки внутри изолированного кэша. */
    function unpackedDir(): string {
        const entries = readdirSync(join(cacheHome, "diode")).filter((e) => !e.startsWith("."));
        expect(entries).toHaveLength(1);
        return join(cacheHome, "diode", entries[0]);
    }

    it("распаковывается в XDG_CACHE_HOME и печатает версию", () => {
        const result = run(["--version"]);

        expect(result.status).toBe(0);
        expect(result.signal).toBeNull();
        expect(result.stdout.trim()).not.toBe("");

        // Payload лёг целиком — ровно то, что кладёт build-selfextract.
        const dir = unpackedDir();
        for (const file of ["node", "main.js", "diode.bundle", ".ready"]) {
            expect(existsSync(join(dir, file)), `${file} должен быть распакован`).toBe(true);
        }
        // Каталог публикуется уже готовым — маркер ставится до rename.
        expect(existsSync(join(dir, ".lock"))).toBe(false);
    });

    it("повторный запуск не распаковывает заново", () => {
        run(["--version"]);
        const marker = join(unpackedDir(), "node");
        const before = statSync(marker).mtimeMs;

        const second = run(["--version"]);

        expect(second.status).toBe(0);
        expect(statSync(marker).mtimeMs).toBe(before);
    });

    it("пробрасывает код возврата приложения", () => {
        // Неизвестный флаг → CliArgsError → exit 2. `exec` в стабе отдаёт код как есть.
        const result = run(["--definitely-not-a-flag"]);

        expect(result.status).toBe(2);
        expect(result.signal).toBeNull();
    });

    it("работает из произвольного cwd", () => {
        const cwd = mkdtempSync(join(tmpdir(), "vexx-elsewhere-"));
        try {
            const result = run(["--version"], { cwd });

            expect(result.status).toBe(0);
            expect(result.stdout.trim()).not.toBe("");
            // Прод не должен сорить логом в cwd пользователя (гейт isPackagedRuntime).
            expect(existsSync(join(cwd, "diode.log"))).toBe(false);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    itLinuxOnly("поднимает редактор и читает diode.bundle с диска — подсветка работает", async () => {
        // user-data/HOME изолируем через usePtyApp, но XDG_CACHE_HOME оставляем
        // общим (прогретым распаковкой в предыдущих `run()`), поэтому передаём его
        // явно — extra-env перекрывает изолированный кэш.
        const { session } = await usePtyApp({ binary, open: [fixturePath], env: { XDG_CACHE_HOME: cacheHome } });

        const screen = await session.waitFor((s) => s.findText("const greeting") !== null);

        // `const` keyword-цветом = грамматика + onig.wasm реально загрузились из
        // приклеенного bundle'а через fs-загрузчик. Ради этого весь #144 и делался.
        const constPos = screen.findText("const greeting");
        expect(constPos).not.toBeNull();
        expect(screen.cellAt(constPos!.x, constPos!.y).fg).toBe(KEYWORD_FG);
    });
});

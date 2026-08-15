import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, startHeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath, getSelfExtractPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * «Батарейки вшиты»: LSP работает из коробки — typescript-language-server +
 * TypeScript приезжают с бинарём (ts-server.bundle), распаковываются в
 * XDG-кэш при первом использовании и запускаются НАШИМ node-рантаймом.
 *
 * Окружение теста агрессивно голое: PATH без node, воркспейс без node_modules,
 * никаких LSP-настроек, чистый изолированный XDG_CACHE_HOME. Ровно так diode
 * выглядит на машине пользователя без тулчейна.
 *
 * Оба формата поставки: SEA (diode-as-node, DIODE_RUN_AS_NODE) и self-extract
 * (распакованный настоящий node из payload'а).
 */

/** PATH без node (nvm/юзер-бинарей): sh/tar/gzip для selfextract-стаба есть в /usr/bin. */
const BARE_PATH = "/usr/bin:/bin";

const WORKSPACE_FILES = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    "defs.ts": 'export function greet(name: string): string {\n    return "hi " + name;\n}\n',
    // Ошибка типов: greet возвращает string, а reply объявлен number → squiggle.
    "main.ts": 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n',
};

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

/** Каталоги ts-server в изолированном XDG-кэше сессии. */
function tsServerCacheEntries(home: string): string[] {
    const root = join(home, ".cache", "diode", "ts-server");
    if (!existsSync(root)) return [];
    return readdirSync(root).map((name) => join(root, name));
}

describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "Вшитый language-сервер — из коробки, без node в PATH и node_modules",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("SEA: squiggle + F12 на голом окружении; кэш распакован атомарно и переиспользуется", { timeout: 300_000 }, async () => {
            // keepRoot: кэш первого запуска нужен второму (тёплый старт);
            // корень убирается вручную в конце.
            const app = await useHeadlessApp({
                files: WORKSPACE_FILES,
                open: ["main.ts"],
                env: { PATH: BARE_PATH },
                keepRoot: true,
            });
            const { session } = app;
            const home = join(app.env.root, "home");

            await session.waitForNode("EditorElement");
            // Холодный старт: фоновая распаковка ~13 МБ + спавн сервера + индексация.
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от вшитого tsserver", timeoutMs: 180_000, intervalMs: 500 },
            );

            // Кэш: ровно один версионированный каталог, опубликован атомарно.
            const entries = tsServerCacheEntries(home);
            expect(entries).toHaveLength(1);
            expect(existsSync(join(entries[0], ".diode-ready"))).toBe(true);
            expect(existsSync(`${entries[0]}.lock`)).toBe(false);
            expect(existsSync(join(entries[0], "typescript-language-server", "lib", "run-cli.cjs"))).toBe(true);
            expect(existsSync(join(entries[0], "node_modules", "typescript", "lib", "tsserver.js"))).toBe(true);
            const readyMtime = statSync(join(entries[0], ".diode-ready")).mtimeMs;

            // F12: каретка на вызов greet (2:23) → объявление в defs.ts.
            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 23; i++) await session.key("ArrowRight");
            await session.key("F12");
            await session.waitForText((t) => t.includes('return "hi " + name'), { timeoutMs: 60_000, intervalMs: 500 });

            // Второй запуск с тем же кэшем — тёплый: каталог не перераспаковывается.
            await app.dispose();
            const second = await startHeadlessApp({
                files: WORKSPACE_FILES,
                open: ["main.ts"],
                env: { PATH: BARE_PATH, XDG_CACHE_HOME: join(home, ".cache") },
            });
            try {
                await waitUntil(
                    () => second.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                    { describe: "squiggle на тёплом кэше", timeoutMs: 120_000, intervalMs: 500 },
                );
                expect(tsServerCacheEntries(home)).toHaveLength(1);
                expect(statSync(join(entries[0], ".diode-ready")).mtimeMs).toBe(readyMtime);
            } finally {
                await second.dispose();
                removeTempDir(app.env.root);
            }
        });

        it("workspace-версия сервера на голом PATH: JS-энтрипоинт нашим рантаймом, не .bin-шим", { timeout: 300_000 }, async () => {
            // Регрессия реального отказа: у проекта typescript-language-server в
            // devDeps → workspace-кандидат побеждает вшитый. Раньше кандидатом
            // был `.bin`-шим, исполнявшийся напрямую, — его шебанг
            // `#!/usr/bin/env node` на машине без node давал exit 127 и каскад
            // EPIPE-рестартов клиента. Теперь кандидат — сам cli.mjs, и он
            // запускается нашим рантаймом (SEA: diode-as-node).
            const root = mkdtempSync(join(tmpdir(), "vexx-e2e-"));
            const nodeModules = join(root, "workspace", "node_modules");
            const repoModules = resolve(import.meta.dirname, "..", "node_modules");
            mkdirSync(join(nodeModules, ".bin"), { recursive: true });
            for (const pkg of ["typescript-language-server", "typescript"]) {
                symlinkSync(join(repoModules, pkg), join(nodeModules, pkg));
            }
            // Шим — как кладёт npm: симлинк на cli.mjs, исполняемый через шебанг.
            symlinkSync(
                join("..", "typescript-language-server", "lib", "cli.mjs"),
                join(nodeModules, ".bin", "typescript-language-server"),
            );

            const app = await startHeadlessApp({
                root,
                files: WORKSPACE_FILES,
                open: ["main.ts"],
                env: { PATH: BARE_PATH },
            });
            try {
                await app.session.waitForNode("EditorElement");
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                    { describe: "undercurl squiggle от workspace-сервера", timeoutMs: 180_000, intervalMs: 500 },
                );
            } finally {
                await app.dispose();
            }
        });

        it("self-extract: squiggle на голом окружении (node из payload'а)", { timeout: 300_000 }, async () => {
            const selfExtractBinary = await getSelfExtractPath();
            const app = await startHeadlessApp({
                files: WORKSPACE_FILES,
                open: ["main.ts"],
                env: { PATH: BARE_PATH },
                binary: selfExtractBinary,
            });
            try {
                await app.session.waitForNode("EditorElement");
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                    { describe: "undercurl squiggle (self-extract)", timeoutMs: 180_000, intervalMs: 500 },
                );
                const home = join(app.env.root, "home");
                const entries = tsServerCacheEntries(home);
                expect(entries).toHaveLength(1);
                expect(existsSync(join(entries[0], ".diode-ready"))).toBe(true);
                // Диагностика в тексте — сервер отработал проект целиком.
                expect(frameToText(await app.session.captureFrame())).toContain("main.ts");
            } finally {
                await app.dispose();
            }
        }, 600_000);
    },
);

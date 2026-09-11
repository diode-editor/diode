import { cpSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startHeadlessApp } from "../helpers/appSession.ts";
import { findNode } from "../helpers/inspectorClient.ts";
import { waitUntil } from "../helpers/waitFor.ts";

/**
 * Смоук-чеки расширений из магазина: «поставилось» — половина ответа, вторая
 * половина — «работает в Diode на текущем коде». Таблица необязательная и
 * неполная по устройству: `marketplace.test.ts` идёт по живому каталогу, а чек
 * здесь углубляет прогон для тех расширений, для которых мы его написали.
 * Состав магазина решает магазин — отсутствие чека ничего не блокирует.
 *
 * Чек дёргает настоящую функциональность расширения и смотрит на состояние
 * редактора, а не на факт загрузки: фикстура, выведенная из своей же реализации,
 * проверяет только то, что и так работает (см. AGENTS.md, урок #194/#195).
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(here, "..", "fixtures");

export interface ICheckContext {
    /** Корень сессии; в `<root>/user-data-dir` расширение уже установлено из реестра. */
    readonly root: string;
}

export interface IMarketplaceCheck {
    /** id записи в реестре. */
    readonly id: string;
    /** Пути внутри каталога установленного расширения, обязанные существовать. */
    readonly expectFiles: readonly string[];
    /** Таймаут кейса, если стандартного мало (холодный старт language-сервера). */
    readonly timeoutMs?: number;
    /** Поднимает редактор на этом user-data-dir и проверяет работу расширения. */
    run(ctx: ICheckContext): Promise<void>;
}

/**
 * Открывает файл и ждёт, пока расширение проставит `tabSize` активному редактору.
 * Наблюдаемый эффект настоящего кода расширения, снимаемый инспектором, — без
 * ввода в PTY, поэтому чек работает на всех платформах.
 */
async function expectTabSize(ctx: ICheckContext, file: string, tabSize: number): Promise<void> {
    const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
    try {
        await app.session.waitForDocument(
            (root) => findNode(root, (n) => n.type === "EditorElement")?.state?.tabSize === tabSize,
            { timeoutMs: 40_000 },
        );
    } finally {
        await app.dispose();
    }
}

export const MARKETPLACE_CHECKS: readonly IMarketplaceCheck[] = [
    {
        // kind: "native", декларативное расширение: ни строчки кода, только вклад
        // языка и грамматики — extension host для него не поднимается вовсе.
        // Исходник и упаковщик — `sample-extension/` рядом.
        id: "test.sample-lang",
        expectFiles: ["package.json", "syntaxes/diodesample.tmGrammar.json"],
        run: async (ctx) => {
            // Наблюдаемый эффект вклада языка — имя языка в статус-баре: файл
            // `.diodesample` перестаёт быть Plain Text.
            const file = join(ctx.root, "sample.diodesample");
            writeFileSync(file, "sample marketplace 42\n# comment\n");
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                await app.session.waitForText((text) => text.includes("Diode Sample"), { timeoutMs: 40_000 });
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "native", рантайм-расширение: `main` + subprocess extension host.
        id: "test.tab-setter",
        expectFiles: ["package.json", "extension.js"],
        run: async (ctx) => {
            // Расширение при активации ставит tabSize=7 активному редактору через
            // `vscode.window.activeTextEditor.options` — то есть проверяется и
            // subprocess extension host, и RPC до него.
            await expectTabSize(ctx, join(FIXTURES, "tabbed.txt"), 7);
        },
    },
    {
        // kind: "proxy-openvsx" — чужой .vsix, скачивается с open-vsx по URL из меты.
        id: "EditorConfig.EditorConfig",
        expectFiles: ["package.json", "out/editorConfigMain.js", "node_modules/editorconfig/lib/index.js"],
        run: async (ctx) => {
            // `[*.tabbed] indent_size = 3` из .editorconfig проекта: расширение
            // читает конфиг и применяет его к открытому файлу. Проект копируем в
            // корень сессии, чтобы прогон не зависел от .editorconfig репозитория.
            const project = join(ctx.root, "editorconfig-project");
            cpSync(join(FIXTURES, "editorconfig", "project"), project, { recursive: true });
            await expectTabSize(ctx, join(project, "indent.tabbed"), 3);
        },
    },
    {
        // kind: "proxy-openvsx" — настоящий basedpyright с open-vsx (Python LSP).
        // Активация целиком держится на курируемом дефолте
        // `basedpyright.importStrategy: "useBundled"` (`curatedConfigInjection` в
        // src/vs/diode/main.ts): манифестный `fromEnvironment` зовёт API
        // ms-python.python и роняет activate(). Установка из магазина обязана
        // пройти тем же путём регистрации, что применяет дефолт, — чек это
        // доказывает наблюдаемым результатом, а не фактом распаковки.
        id: "detachhead.basedpyright",
        expectFiles: [
            "package.json",
            "dist/extension.js",
            "dist/server.js",
            "dist/typeshed-fallback/stdlib/builtins.pyi",
        ],
        // Холодный старт bundled-сервера — десятки секунд поверх скачивания
        // 6.4 МБ артефакта: стандартных 240 с кейсу впритык.
        timeoutMs: 420_000,
        run: async (ctx) => {
            // Намеренная ошибка типов: str не присваивается int → сервер шлёт
            // диагностику «is not assignable», редактор рисует undercurl
            // (StyleFlags.Undercurl === 8) — стандартный readiness-сигнал наших
            // LSP e2e (см. e2e/pythonLsp.test.ts).
            const file = join(ctx.root, "typed.py");
            writeFileSync(file, 'reply: int = "hi"\nprint(reply)\n');
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
                    { describe: "undercurl squiggle от basedpyright", timeoutMs: 180_000, intervalMs: 500 },
                );
            } finally {
                await app.dispose();
            }
        },
    },
];

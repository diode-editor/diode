import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureEslintLibrary, ESLINT_FLAT_CONFIG, LINT_JS, linkEslintLibrary } from "../../src/TestUtils/eslintFixture.ts";
import { APP_JAVA, APP_JAVA_PATH, POM_XML } from "../../src/TestUtils/javaFixture.ts";
import { startHeadlessApp } from "../helpers/appSession.ts";
import { waitForEslintDiagnostics } from "../helpers/eslintReady.ts";
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
    {
        // kind: "proxy-openvsx", ПЛАТФОРМЕННЫЕ vsix — настоящий ruff с open-vsx
        // (Python-линт/формат). Чек доказывает весь платформенный маршрут
        // магазина наблюдаемым результатом: запись `targetPlatform` текущей
        // машины → её артефакт → распаковка с восстановлением exec-бита →
        // spawn нативного `ruff server` из бандла → диагностика в кадре.
        // Плюс курируемый дефолт `ruff.importStrategy: "useBundled"`
        // (`curatedConfigInjection` в src/vs/diode/main.ts).
        id: "charliermarsh.ruff",
        expectFiles: ["package.json", "dist/extension.js", "bundled/libs/bin/ruff"],
        timeoutMs: 420_000,
        run: async (ctx) => {
            // Неиспользуемый импорт → F401 из дефолтного набора правил → сервер
            // шлёт диагностику, редактор рисует undercurl (StyleFlags.Undercurl
            // === 8) — стандартный readiness-сигнал наших LSP e2e.
            const file = join(ctx.root, "lint.py");
            writeFileSync(file, "import sys\n\nprint(1)\n");
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
                    { describe: "undercurl squiggle от ruff", timeoutMs: 180_000, intervalMs: 500 },
                );
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx" — стоковая цветовая тема (Catppuccin, четыре темы
        // через `contributes.themes`, tokenColors inline, 141 цвет с альфой).
        // Чек доказывает путь темы из магазина наблюдаемым кадром: настройка
        // `workbench.colorTheme` → первый же кадр в теме, фон редактора равен
        // `editor.background` из themes/mocha.json (#1e1e2e) — и тема есть в
        // пикере Color Theme. Runtime-часть расширения (dist/main.cjs
        // перегенерирует темы из настроек) не используется — читаются файлы
        // тем из vsix как есть.
        id: "Catppuccin.catppuccin-vsc",
        expectFiles: ["package.json", "themes/mocha.json", "themes/latte.json"],
        run: async (ctx) => {
            const file = join(ctx.root, "themed.ts");
            writeFileSync(file, "const answer = 42;\n// mocha\n");
            const app = await startHeadlessApp({
                root: ctx.root,
                keepRoot: true,
                open: [file],
                settings: { "workbench.colorTheme": "Catppuccin Mocha" },
                // Настоящий Ctrl+K Ctrl+T headless-DSL не кодирует — вешаем пикер на F8.
                keybindings: [{ key: "f8", command: "workbench.action.selectTheme" }],
            });
            try {
                const frame = await app.session.waitForText((t) => t.includes("const answer"), { timeoutMs: 40_000 });
                const editor = findNode((await app.session.getDocument()).root, (n) => n.type === "EditorElement");
                if (editor === null) throw new Error("EditorElement не найден в дереве");
                // Вторая строка, у правого края: первая — под кареткой и occurrence-подсветкой.
                const cell = frame.cells[(editor.box.y + 1) * frame.cols + editor.box.x + editor.box.width - 2];
                if (cell.bg !== 0x1e1e2e) {
                    throw new Error(`фон редактора #${cell.bg.toString(16)} — не editor.background Catppuccin Mocha (#1e1e2e)`);
                }
                await app.session.sendKey("F8");
                await app.session.waitForText((t) => t.includes("Select Color Theme"), { timeoutMs: 20_000 });
                await app.session.sendText("Catppuccin");
                await app.session.waitForText((t) => t.includes("Catppuccin Mocha") && t.includes("Catppuccin Latte"), {
                    timeoutMs: 20_000,
                });
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx" — стоковый ESLint. Библиотеку eslint расширение
        // НЕ бандлит (сервер резолвит её из node_modules проекта) — чек доносит
        // её в воркспейс симлинком из npm-кэша фикстуры и ждёт диагностику
        // настоящего eslintServer. Не по undercurl'у: builtin TS-клиент линтит
        // .js тоже, и его подчёркивание делало бы чек ложно-зелёным при мёртвом
        // eslint (см. e2e/helpers/eslintReady.ts).
        id: "dbaeumer.vscode-eslint",
        expectFiles: ["package.json", "client/out/extension.js", "server/out/eslintServer.js"],
        timeoutMs: 420_000,
        run: async (ctx) => {
            writeFileSync(join(ctx.root, "eslint.config.mjs"), ESLINT_FLAT_CONFIG);
            const file = join(ctx.root, "lint.js");
            writeFileSync(file, LINT_JS);
            linkEslintLibrary(ctx.root, ensureEslintLibrary());
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                await waitForEslintDiagnostics({
                    key: (name) => app.session.sendKey(name),
                    text: (value) => app.session.sendText(value),
                    waitForText: (predicate, opts) => app.session.waitForText(predicate, opts),
                });
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx" — стоковый redhat.java поверх Eclipse JDT LS.
        // Чек доказывает путь из магазина наблюдаемым кадром: undercurl над
        // `int broken = message;` рисуется только если сервер поднялся, импортировал
        // проект и собрал его. Заодно это проверка курируемого дефолта
        // lombokSupport: с манифестным `true` вместо диагностики пришла бы
        // «Internal compiler error».
        //
        // `expectFiles` — только пути, общие для платформенного и universal
        // артефактов: какой из них отдаст резолв, зависит от версии клиента
        // (платформенные записи гейтятся `engines.diode >=0.5.0`), и чек не должен
        // от этого зависеть.
        id: "redhat.java",
        expectFiles: ["package.json", "dist/extension.js", "server/config_linux/config.ini"],
        timeoutMs: 600_000,
        run: async (ctx) => {
            // Проект — в ПОДКАТАЛОГЕ сессии, а не в `ctx.root`: в корне лежит
            // `user-data-dir/` с приватными каталогами расширения, а jdt.ls
            // отказывается импортировать проект, внутри которого развёрнуто его
            // же eclipse-хозяйство («Invalid project description»), и молча
            // сваливается в режим «non-project file, only syntax errors».
            const projectRoot = join(ctx.root, "javaproj");
            const file = join(projectRoot, APP_JAVA_PATH);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(join(projectRoot, "pom.xml"), POM_XML);
            writeFileSync(file, APP_JAVA);
            const app = await startHeadlessApp({
                root: ctx.root,
                keepRoot: true,
                // Папка ПЕРВОЙ: у redhat.java есть только `workspaceContains:`-события.
                open: [projectRoot, file],
                // Иначе тост про телеметрию перекрывает правую часть редактора —
                // ровно те строки, где рисуется волна, — и чек ловит гонку.
                settings: { "redhat.telemetry.enabled": false },
            });
            try {
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
                    { describe: "undercurl squiggle от jdt.ls", timeoutMs: 420_000, intervalMs: 1000 },
                );
            } finally {
                await app.dispose();
            }
        },
    },
];

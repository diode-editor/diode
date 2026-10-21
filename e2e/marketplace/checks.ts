import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    ensureEslintLibrary,
    ESLINT_FLAT_CONFIG,
    LINT_JS,
    linkEslintLibrary,
} from "../../src/TestUtils/eslintFixture.ts";
import {
    ensureGopls,
    GO_SAMPLE_DIR,
    GO_SESSION_ENV,
    goToolchainMissing,
} from "../../src/TestUtils/goFixture.ts";
import { APP_JAVA, APP_JAVA_PATH, POM_XML } from "../../src/TestUtils/javaFixture.ts";
import { startHeadlessApp } from "../helpers/appSession.ts";
import { CLAUDE_CODE_ID, claudeCodeSessionEnv, IdeProbe, waitForIdeLock } from "../helpers/claudeIde.ts";
import { waitForEslintDiagnostics } from "../helpers/eslintReady.ts";
import { findNode } from "../helpers/inspectorClient.ts";
import { waitUntil } from "../helpers/waitFor.ts";

/**
 * Чек дёргает настоящую функциональность расширения и смотрит на состояние редактора, а не на факт
 * загрузки (урок #194/#195). Таблица неполна по устройству: отсутствие чека ничего не блокирует,
 * состав решает магазин.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(here, "..", "fixtures");

export interface ICheckContext {
    /** Корень сессии; в `<root>/user-data-dir` расширение уже установлено из реестра. */
    readonly root: string;
}

export interface IMarketplaceCheck {
    readonly id: string;
    /** Пути внутри каталога установленного расширения, обязанные существовать. */
    readonly expectFiles: readonly string[];
    /** Таймаут кейса, если стандартного мало (холодный старт language-сервера). */
    readonly timeoutMs?: number;
    /**
     * Причина пропуска без внешнего инструмента (Go toolchain у `golang.go`), как `requires` у
     * сценариев: в CI инструмент ставится в джобу, локально без него кейс честно пропускается.
     */
    requires?(): string | undefined;
    run(ctx: ICheckContext): Promise<void>;
}

/** Эффект снимается инспектором, без ввода в PTY, — поэтому чек работает на всех платформах. */
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
        // kind: "native", декларативное: только вклад языка и грамматики — extension host для него
        // не поднимается вовсе. Исходник и упаковщик — `sample-extension/` рядом.
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
            // `[*.tabbed] indent_size = 3` из .editorconfig проекта; проект копируем в корень сессии,
            // чтобы прогон не зависел от .editorconfig репозитория.
            const project = join(ctx.root, "editorconfig-project");
            cpSync(join(FIXTURES, "editorconfig", "project"), project, { recursive: true });
            await expectTabSize(ctx, join(project, "indent.tabbed"), 3);
        },
    },
    {
        // kind: "proxy-openvsx" — настоящий basedpyright. Активация держится на курируемом дефолте
        // `basedpyright.importStrategy: "useBundled"` (`curatedConfigInjection`): манифестный
        // `fromEnvironment` зовёт API ms-python.python и роняет activate().
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
            // Ошибка типов → undercurl (StyleFlags.Undercurl === 8) — readiness-сигнал наших LSP e2e.
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
        // kind: "proxy-openvsx", ПЛАТФОРМЕННЫЕ vsix — настоящий ruff. Доказывает весь платформенный
        // маршрут: `targetPlatform` машины → её артефакт → распаковка с exec-битом → spawn нативного
        // `ruff server` → диагностика в кадре. Плюс курируемый `ruff.importStrategy: "useBundled"`.
        id: "charliermarsh.ruff",
        expectFiles: ["package.json", "dist/extension.js", "bundled/libs/bin/ruff"],
        timeoutMs: 420_000,
        run: async (ctx) => {
            // Неиспользуемый импорт → F401 из дефолтного набора → undercurl.
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
        // kind: "proxy-openvsx", платформенный vsix со вшитым `terraform-ls`. Активация целиком
        // (TreeItem, context.extension, createTelemetryLogger, authentication — без любого сервер не
        // стартовал) до диагностики в кадре. Схемы провайдеров вшиты: terraform CLI не нужен.
        id: "hashicorp.terraform",
        expectFiles: ["package.json", "dist/extension.js", "bin/terraform-ls"],
        timeoutMs: 420_000,
        run: async (ctx) => {
            // Лишний атрибут ресурса → «Unexpected attribute» от сервера →
            // undercurl (StyleFlags.Undercurl === 8).
            const file = join(ctx.root, "main.tf");
            writeFileSync(file, 'resource "aws_instance" "web" {\n  bogus_attr = 1\n}\n');
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
                    { describe: "undercurl squiggle от terraform-ls", timeoutMs: 180_000, intervalMs: 500 },
                );
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx" — стоковая тема Catppuccin (`contributes.themes`, tokenColors inline,
        // цвета с альфой): `workbench.colorTheme` → первый же кадр в теме (фон = `editor.background`
        // из themes/mocha.json) и тема в пикере. Runtime-часть расширения не используется.
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
                    throw new Error(
                        `фон редактора #${cell.bg.toString(16)} — не editor.background Catppuccin Mocha (#1e1e2e)`,
                    );
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
        // kind: "proxy-openvsx" — стоковый ESLint. Библиотеку eslint он НЕ бандлит — доносим её
        // симлинком из npm-кэша фикстуры. Ждём диагностику eslintServer, а не undercurl: builtin
        // TS-клиент линтит и .js, и чек был бы ложно-зелёным (e2e/helpers/eslintReady.ts).
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
        // kind: "proxy-openvsx" — стоковый redhat.java. Undercurl над `int broken = message;` рисуется,
        // только если jdt.ls поднялся, импортировал и собрал проект; заодно проверка курируемого
        // lombokSupport (с манифестным `true` пришла бы «Internal compiler error»).
        // `expectFiles` — только пути, общие для платформенного и universal артефактов: какой отдаст
        // резолв, зависит от версии клиента.
        id: "redhat.java",
        expectFiles: ["package.json", "dist/extension.js", "server/config_linux/config.ini"],
        timeoutMs: 600_000,
        run: async (ctx) => {
            // Проект — в ПОДКАТАЛОГЕ: в корне лежит `user-data-dir/` с eclipse-хозяйством расширения, и
            // jdt.ls молча сваливается в «non-project file, only syntax errors».
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
    {
        // kind: "proxy-openvsx" — стоковый golang.go: undercurl рисуется, только если его languageclient
        // поднял gopls (своего Go-клиента у diode нет). gopls в vsix нет — кладём в GOBIN собранный
        // фикстурой (в CI — .github/actions/go-tools); авто-установку закрывает goLsp.test.ts. Без Go
        // toolchain расширение не активируется и в VS Code — кейс пропускается.
        id: "golang.go",
        expectFiles: ["package.json", "dist/goMain.js"],
        requires: goToolchainMissing,
        // Первый локальный прогон собирает gopls внутри кейса (`ensureGopls`).
        timeoutMs: 600_000,
        run: async (ctx) => {
            const gobin = dirname(ensureGopls());
            // Модуль — в подкаталоге: в корне сессии лежит user-data-dir.
            const projectRoot = join(ctx.root, "goproj");
            cpSync(GO_SAMPLE_DIR, projectRoot, { recursive: true });
            const app = await startHeadlessApp({
                root: ctx.root,
                keepRoot: true,
                open: [projectRoot, join(projectRoot, "main.go")],
                env: { ...GO_SESSION_ENV, GOBIN: gobin },
            });
            try {
                await waitUntil(
                    () => app.session.captureFrame(),
                    (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
                    { describe: "undercurl squiggle от gopls", timeoutMs: 300_000, intervalMs: 500 },
                );
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx" — prettier, ЕДИНСТВЕННОЕ ESM-расширение в магазине: формат markdown
        // (его не покрывает ни один наш LSP) и загрузка ESM-точки входа под SEA, где прямой `import()`
        // из вшитого main не работает. Чорд Ctrl+K Ctrl+E шлём инспектором, как соседние чеки.
        id: "esbenp.prettier-vscode",
        expectFiles: ["package.json", "dist/extension.js", "node_modules/prettier/package.json"],
        timeoutMs: 300_000,
        run: async (ctx) => {
            const file = join(ctx.root, "notes.md");
            writeFileSync(file, "#   Hello\n\n*  item one\n");
            const app = await startHeadlessApp({ root: ctx.root, keepRoot: true, open: [file] });
            try {
                // Пункт статус-бара появляется в конце activate(): провайдеры
                // формата к этому моменту зарегистрированы.
                await app.session.waitForText((text) => text.includes("Prettier"), { timeoutMs: 120_000 });
                await app.session.key("Ctrl+K");
                await app.session.key("Ctrl+E");
                // Этого текста в файле не было — он мог появиться только правками
                // настоящего prettier.
                await app.session.waitForText((text) => text.includes("# Hello") && text.includes("- item one"), {
                    timeoutMs: 60_000,
                });
            } finally {
                await app.dispose();
            }
        },
    },
    {
        // kind: "proxy-openvsx", платформенный vsix (~130 МБ) — стоковый Claude Code. Его работа здесь —
        // ide-сервер: пункт «✻ Claude Code» и лок пишутся в конце activate(), MCP `initialize` отвечает
        // `ideName` из `env.appName`. Контекст, диагностики и терминал — в e2e claudeCode.test.ts.
        id: CLAUDE_CODE_ID,
        expectFiles: ["package.json", "extension.js"],
        run: async (ctx) => {
            const file = join(ctx.root, "notes.md");
            writeFileSync(file, "# notes\n");
            const app = await startHeadlessApp({
                root: ctx.root,
                keepRoot: true,
                open: [file],
                env: claudeCodeSessionEnv(),
            });
            try {
                await app.session.waitForText((text) => text.includes("✻ Claude Code"), { timeoutMs: 60_000 });
                const lock = await waitForIdeLock(app.env.home);
                const { probe, serverInfo } = await IdeProbe.connect(lock);
                probe.close();
                if (lock.ideName !== "Diode" || serverInfo.name !== "Claude Code Diode MCP") {
                    throw new Error(`ide-сервер не от Diode: лок ${lock.ideName}, сервер ${serverInfo.name}`);
                }
            } finally {
                await app.dispose();
            }
        },
    },
];

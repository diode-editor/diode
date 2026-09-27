import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRegistryFixture } from "../helpers/registryFixture.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Тема из магазина (#84, docs/TODO/Theming.md): расширение-тема проходит тот же
// путь, что любое расширение — Install со страницы магазина → Reload Window →
// его темы в пикере Color Theme → выбор перекрашивает окно. Кадры: страница
// после установки, пикер с live preview на `Sample Dark`, окно после Enter.
//
// Реестр — файловая фикстура с НАСТОЯЩИМ `.vsix` синтетического расширения
// `test.sample-theme` (e2e/fixtures/sample-theme): демо ставит тему по-настоящему,
// без сети. Фикстуру собираем на импорте модуля: путь к реестру нужен уже в
// `extraArgs`, то есть до запуска редактора.

const registry = await createRegistryFixture(join(mkdtempSync(join(tmpdir(), "diode-scenario-theme-")), "registry"), [
    {
        id: "test.sample-theme",
        version: "0.0.1",
        sourceDir: resolve(repoRoot, "e2e", "fixtures", "sample-theme"),
        displayName: "Sample Theme",
        description: "Синтетическое расширение магазина: три цветовые темы",
        readme: "# Sample Theme\n\nТемы Sample Dark / Sample Light / Sample Dimmed для демо магазина.",
    },
]);

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "extension-theme",
    title: "Extensions: тема из магазина — Install → Reload Window → Color Theme",
    open: [repoRoot, sampleFile],
    extraArgs: [`--registry=${registry}`],
    // Настоящие аккорды (Ctrl+Shift+X, Ctrl+K Ctrl+T) headless-DSL не кодирует — вешаем на F-клавиши.
    userKeybindings: [
        { key: "f6", command: "workbench.view.extensions" },
        { key: "f7", command: "workbench.action.increaseSidebarWidth" },
        { key: "f8", command: "workbench.action.selectTheme" },
    ],
    cols: 110,
    rows: 28,
    // Reload Window из сценария, стартующего из repoRoot, на Windows поднимает
    // окно с `diode.exe` во вкладке и без сайдбара (в CI-safety-net кадр после
    // reconnect не дожидается EXPLORER); функциональный e2e с перезагрузкой из
    // изолированного воркспейса на Windows проходит. Открыто в docs/TODO/E2E.md.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER"));
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("MARKETPLACE"));
        for (let i = 0; i < 3; i++) await editor.sendKey("F7");

        // Страница расширения: фокус в список, первая запись каталога, Enter.
        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForNode("#extensionPage-test-sample-theme");
        await editor.waitForText((t) => t.includes("Not installed"));

        // Фокус страницы стоит на первой кнопке — это Install; после установки
        // на её месте Reload Window.
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Reload Window"));
        await editor.capture("installed");

        // Ответа на этот ввод не будет: окно уходит на перезапуск вместе с
        // сокетом. Новое окно поднимается с теми же аргументами — и с темами
        // расширения в реестре.
        await editor.sendKey("Enter").catch(() => undefined);
        await editor.reconnect();
        await editor.waitForText((t) => t.includes("EXPLORER"), { timeoutMs: 60_000 });

        // Пикер Color Theme: темы расширения — вслед за встроенными; фильтр по
        // имени, live preview перекрашивает окно ещё до Enter.
        await editor.sendKey("F8");
        await editor.waitForText((t) => t.includes("Select Color Theme"));
        await editor.sendText("Sample Dark");
        await editor.waitForText((t) => t.includes("Sample Dark") && !t.includes("Sample Light"));
        await editor.capture("picker");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("Select Color Theme"));
        await editor.capture("applied");
    },
});

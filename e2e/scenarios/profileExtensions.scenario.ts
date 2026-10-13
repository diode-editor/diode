import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRegistryFixture } from "../helpers/registryFixture.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Расширения по профилю (итерация 2, docs/TODO/Profiles.md): каталог
// `extensions/` общий, а какие из расширений включены, решает `extensions.json`
// профиля. Extension host поднимает только состав активного профиля, а смена
// профиля — перезагрузка окна, так что новый host стартует с новым составом.
//
// Сид user-data несёт `hello-lang` в `extensions/` без `extensions.json` — как
// у человека, обновившегося с версии, где расширения были общими: миграция
// делает его составом Default. Видимый признак расширения — язык `.hello` в
// статус-баре («Hello Language» против «Plain Text»).
//
// Кадры: `default` (Default с hello-lang), `copied` (New Profile → Copy from
// current — hello-lang приехал), `empty` (New Profile → Empty — язык Plain
// Text), `empty-view` (магазин пустого профиля: секции INSTALLED нет),
// `installed` (Sample Lang поставлен в пустой профиль — после reload язык
// `.diodesample` работает), `default-again` (Default: hello-lang есть, а
// Sample Lang в нём не установлен).
//
// Кейбинды сценария живут в keybindings.json Default-профиля, а у Empty-профиля
// их нет, поэтому все команды — через палитру.

const fixture = resolve(repoRoot, "e2e", "fixtures", "profileExtensions");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-hello");

const registry = await createRegistryFixture(join(mkdtempSync(join(tmpdir(), "diode-scenario-registry-")), "registry"), [
    {
        id: "test.sample-lang",
        version: "0.0.2",
        sourceDir: resolve(repoRoot, "e2e", "marketplace", "sample-extension"),
        displayName: "Sample Lang",
        description: "Синтетическое расширение магазина: свой язык и грамматика",
        readme: "# Sample Lang\n\nЯзык .diodesample.",
    },
]);

/** Открыть команду палитры по полному заголовку. */
async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

/** Перезагрузка окна после команды профиля: старый сокет закрывается, новый поднимается на том же порту. */
async function reloaded(editor: ScenarioDriver): Promise<void> {
    await editor.reconnect();
    await editor.waitForText((t) => t.includes("EXPLORER"), { timeoutMs: 60_000 });
}

/** New Profile: имя, затем пункт содержимого (`down` — сколько раз вниз от «Empty»), вход с перезагрузкой. */
async function newProfile(editor: ScenarioDriver, name: string, down: number): Promise<void> {
    await runCommand(editor, "Profiles: New Profile...");
    await editor.waitForText((t) => t.includes("Profile name"));
    await editor.sendText(name);
    await editor.sendKey("Enter");
    await editor.waitForText((t) => t.includes("Empty") && t.includes("Copy from current"));
    for (let i = 0; i < down; i++) await editor.sendKey("ArrowDown");
    await editor.sendKey("Enter").catch(() => undefined);
    await reloaded(editor);
}

/** Язык активного редактора в статус-баре. */
async function expectLanguage(editor: ScenarioDriver, language: string): Promise<void> {
    await editor.waitForText((t) => t.split("\n").some((line) => line.trimEnd().endsWith(language)));
}

async function showExtensions(editor: ScenarioDriver): Promise<void> {
    await runCommand(editor, "View: Show Extensions");
    await editor.waitForText((t) => t.includes("MARKETPLACE") && t.includes("Sample Lang"));
}

export default defineScenario({
    name: "profile-extensions",
    title: "Профили: свой набор расширений — миграция, Copy from current, Empty, установка в профиль",
    seedUserData: userData,
    open: [fixture, resolve(fixture, "greeting.hello")],
    extraArgs: [`--registry=${registry}`],
    cols: 110,
    rows: 28,
    // Reload Window из сценария на Windows поднимает окно без сайдбара (docs/TODO/E2E.md).
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER"));
        await expectLanguage(editor, "Hello Language");
        await editor.capture("default");

        // Copy from current: состав Default (hello-lang) едет в новый профиль.
        await newProfile(editor, "copied", 1);
        await expectLanguage(editor, "Hello Language");
        await editor.capture("copied");

        // Empty: расширений нет — `.hello` открывается простым текстом.
        await newProfile(editor, "clean", 0);
        await expectLanguage(editor, "Plain Text");
        await editor.capture("empty");

        // Магазин пустого профиля: hello-lang лежит на диске, но в этом профиле
        // его нет — секции INSTALLED нет вовсе.
        await showExtensions(editor);
        await editor.waitForText((t) => !t.includes("INSTALLED"));
        await editor.capture("empty-view");

        // Установка из магазина — в состав активного профиля.
        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForNode("#extensionPage-test-sample-lang");
        await editor.waitForText((t) => t.includes("Not installed"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Reload Window") && t.includes("INSTALLED"));
        await editor.sendKey("Enter").catch(() => undefined);
        await reloaded(editor);
        await editor.sendKey("Ctrl+P");
        await editor.sendText("notes.diodesample");
        await editor.waitForText((t) => t.includes("notes.diodesample"));
        await editor.sendKey("Enter");
        await expectLanguage(editor, "Diode Sample");
        await editor.capture("installed");

        // Default: hello-lang на месте, а Sample Lang в нём не установлен.
        await runCommand(editor, "Profiles: Switch Profile...");
        await editor.waitForText((t) => t.includes("Select Profile"));
        await editor.sendText("Default");
        await editor.waitForText((t) => t.includes("Default") && !t.includes("clean"));
        await editor.sendKey("Enter").catch(() => undefined);
        await reloaded(editor);
        await expectLanguage(editor, "Hello Language");
        await showExtensions(editor);
        // Sample Lang — одна карточка каталога; в пустом профиле после установки
        // их было две (каталог и INSTALLED).
        await editor.waitForText((t) => t.includes("INSTALLED") && t.split("Sample Lang").length === 2);
        await editor.capture("default-again");
    },
});

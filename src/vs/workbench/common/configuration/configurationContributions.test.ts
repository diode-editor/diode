import { describe, expect, it } from "vitest";

import type { ConfigurationScope } from "../../../platform/configuration/common/configurationRegistry.ts";
import { ConfigurationRegistry } from "../../../platform/configuration/common/configurationRegistry.ts";

import { CONFIGURATION_CONTRIBUTIONS } from "./configurationContributions.ts";

/**
 * Ревизия `scope` у каждого нашего ключа настроек — в одной таблице, чтобы
 * ответ «можно ли этот ключ переопределять на уровне папки» был ЗАПИСАН, а не
 * подразумевался. Слоёв конфигурации ниже user'а у нас пока нет, и поле никем
 * не читается (см. docs/TODO/MultiRoot.md, M6): тест — единственное место, где
 * решение зафиксировано, и он же ловит опечатку в литерале.
 *
 * Обоснование по группам (сверено с эталоном vscode, где ключ у него есть):
 * - `editor.*` — `language-overridable`: у эталона весь узел `editor` объявлен
 *   с этим скоупом (`editorConfigurationBaseNode`), включая `formatOnSave` и
 *   `codeActionsOnSave`; наши `editor.inlineSuggest.{delay,requestTimeout}`
 *   своих у эталона не имеют и идут за семьёй.
 * - `explorer.*`, `files.enableTrash`, `workbench.colorTheme` — `window`: у
 *   эталона скоуп не указан, то есть дефолтный `WINDOW` (одно значение на окно).
 * - `files.watcherExclude`, `scm.graph.pageSize` — `resource`: у эталона первый
 *   помечен `RESOURCE` явно, второй наследует `RESOURCE` от узла `scm`.
 * - `terminal.tier`, `keyboard.platform`, `terminal.capabilities`,
 *   `terminal.modes` — `machine`: это свойства терминала и клавиатуры машины,
 *   а не проекта (`keyboard.platform` ставят как раз из-за ssh с другой ОС),
 *   и уезжать вместе с папкой в другое окружение они не должны.
 * - `terminal.customModes` — `window`, в отличие от соседей: это ОБЪЯВЛЕНИЕ
 *   именованных режимов под `when`-выражения, а не свойство машины, и проекту
 *   осмысленно завести своё.
 */
const EXPECTED_SCOPES: Readonly<Record<string, ConfigurationScope>> = {
    "workbench.colorTheme": "window",

    "editor.tabSize": "language-overridable",
    "editor.insertSpaces": "language-overridable",
    "editor.detectIndentation": "language-overridable",
    "editor.cursorSurroundingLines": "language-overridable",
    "editor.emptySelectionClipboard": "language-overridable",
    "editor.contextmenu": "language-overridable",
    "editor.wordWrap": "language-overridable",
    "editor.wordWrapColumn": "language-overridable",
    "editor.formatOnSave": "language-overridable",
    "editor.inlineSuggest.enabled": "language-overridable",
    "editor.inlineSuggest.delay": "language-overridable",
    "editor.inlineSuggest.requestTimeout": "language-overridable",
    "editor.codeActionsOnSave": "language-overridable",

    "explorer.confirmDelete": "window",
    "explorer.confirmUndo": "window",
    "explorer.autoReveal": "window",

    "files.enableTrash": "window",
    "files.watcherExclude": "resource",

    "scm.graph.pageSize": "resource",

    "terminal.tier": "machine",
    "keyboard.platform": "machine",
    "terminal.capabilities": "machine",
    "terminal.modes": "machine",
    "terminal.customModes": "window",
};

const registered = new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS).getConfigurationProperties();

describe("CONFIGURATION_CONTRIBUTIONS — scope каждого ключа", () => {
    // Таблица обязана совпадать с реестром ПОИМЁННО: новый ключ без записи
    // здесь роняет тест, и вопрос «а этот можно на папке?» задаётся при
    // заведении ключа, а не задним числом ревизией всех настроек.
    it("таблица ожиданий покрывает ровно зарегистрированные ключи", () => {
        expect([...registered.keys()].sort()).toEqual(Object.keys(EXPECTED_SCOPES).sort());
    });

    it.each(Object.entries(EXPECTED_SCOPES))("%s → %s", (key, scope) => {
        expect(registered.get(key)?.scope).toBe(scope);
    });

    // Скоуп — не свободная строка: описка вроде "resources" обязана быть видна
    // даже если ключ в таблице выше кто-то обновит вместе с узлом.
    it("все скоупы — из объявленного набора", () => {
        const allowed: readonly ConfigurationScope[] = [
            "application",
            "machine",
            "window",
            "resource",
            "language-overridable",
        ];
        for (const [key, schema] of registered) {
            expect(allowed, key).toContain(schema.scope);
        }
    });
});

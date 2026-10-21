import { describe, expect, it } from "vitest";

import type { ConfigurationScope } from "../../../platform/configuration/common/configurationRegistry.ts";
import { ConfigurationRegistry } from "../../../platform/configuration/common/configurationRegistry.ts";

import { CONFIGURATION_CONTRIBUTIONS } from "./configurationContributions.ts";

/**
 * `scope` пока никем не читается (docs/TODO/MultiRoot.md, M6): таблица — единственное
 * место, где решение «можно ли на уровне папки» записано. Скоупы — как у эталона
 * (без `scope` там — `window`); наши ключи без пары в эталоне идут за семьёй.
 * - `terminal.tier`, `keyboard.platform`, `terminal.capabilities`, `terminal.modes` —
 *   `machine`: свойства терминала машины (`keyboard.platform` ставят из-за ssh с другой ОС);
 * - `terminal.customModes` — `window`: это объявление режимов под `when`, проекту
 *   осмысленно завести своё.
 */
const EXPECTED_SCOPES: Readonly<Record<string, ConfigurationScope>> = {
    "workbench.colorTheme": "window",
    "workbench.editor.enablePreview": "window",
    "workbench.editor.closeOnFileDelete": "window",
    "workbench.editor.editorActionsLocation": "window",
    "workbench.tree.expandMode": "window",
    "workbench.secondarySideBar.defaultVisibility": "window",

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
    "editor.inlineSuggest.suppressSuggestions": "language-overridable",
    "editor.quickSuggestions": "language-overridable",
    "editor.quickSuggestionsDelay": "language-overridable",
    "editor.suggestOnTriggerCharacters": "language-overridable",
    "editor.wordBasedSuggestions": "language-overridable",
    "editor.occurrencesHighlight": "language-overridable",
    "editor.semanticHighlighting.enabled": "language-overridable",
    "editor.smartSelect.selectLeadingAndTrailingWhitespace": "language-overridable",
    "editor.smartSelect.selectSubwords": "language-overridable",
    "editor.codeActionsOnSave": "language-overridable",

    "explorer.confirmDelete": "window",
    "explorer.confirmUndo": "window",
    "explorer.autoReveal": "window",
    "explorer.compactFolders": "window",
    "explorer.decorations.colors": "window",
    "explorer.decorations.badges": "window",

    "files.autoSave": "language-overridable",
    "files.enableTrash": "window",
    "files.refactoring.autoSave": "window",
    "files.exclude": "resource",
    "files.watcherExclude": "resource",
    "files.watcherInclude": "resource",

    "search.exclude": "resource",
    "search.useIgnoreFiles": "resource",
    "search.useGlobalIgnoreFiles": "resource",
    "search.useParentIgnoreFiles": "resource",

    "scm.graph.pageSize": "resource",

    "terminal.tier": "machine",
    "keyboard.platform": "machine",
    "terminal.capabilities": "machine",
    "terminal.modes": "machine",
    "terminal.customModes": "window",
    "terminal.integrated.tabs.enabled": "window",
    "terminal.integrated.tabs.hideCondition": "window",
    "terminal.integrated.tabs.showActiveTerminal": "window",
    "terminal.integrated.tabs.location": "window",
    "terminal.integrated.tabs.focusMode": "window",
    "terminal.integrated.hideOnLastClosed": "window",
    "terminal.integrated.defaultLocation": "window",
    // Хост-терминал один на процесс — не на окно и не на папку.
    "terminal.integrated.colorSource": "application",

    "task.autoDetect": "window",
    "task.slowProviderWarning": "window",
    "task.quickOpen.detail": "window",
    "task.quickOpen.skip": "window",
    "task.saveBeforeRun": "window",
    "task.verboseLogging": "window",
    "extensions.confirmedUriHandlerExtensionIds": "application",
};

const registered = new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS).getConfigurationProperties();

describe("CONFIGURATION_CONTRIBUTIONS — scope каждого ключа", () => {
    // Новый ключ без записи здесь роняет тест: вопрос «а этот можно на папке?» задаётся при заведении ключа.
    it("таблица ожиданий покрывает ровно зарегистрированные ключи", () => {
        expect([...registered.keys()].sort()).toEqual(Object.keys(EXPECTED_SCOPES).sort());
    });

    it.each(Object.entries(EXPECTED_SCOPES))("%s → %s", (key, scope) => {
        expect(registered.get(key)?.scope).toBe(scope);
    });

    // Ловит описку вроде "resources", даже если таблицу выше обновят вместе с узлом.
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

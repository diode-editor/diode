import { describe, expect, it } from "vitest";

import type { ConfigurationScope } from "../../../platform/configuration/common/configurationRegistry.ts";
import { ConfigurationRegistry } from "../../../platform/configuration/common/configurationRegistry.ts";

import { CONFIGURATION_CONTRIBUTIONS } from "./configurationContributions.ts";

/**
 * Nothing reads `scope` yet (docs/TODO/MultiRoot.md, M6): this table is the only place that records
 * whether a key may be set per folder. Scopes match upstream (no `scope` there means `window`);
 * our keys with no upstream counterpart follow their family.
 * - `terminal.tier`, `keyboard.platform`, `terminal.capabilities`, `terminal.modes` —
 *   `machine`: properties of the machine's terminal (`keyboard.platform` is set because of ssh from another OS);
 * - `terminal.customModes` — `window`: it declares modes for `when` clauses, and a project may
 *   reasonably define its own.
 */
const EXPECTED_SCOPES: Readonly<Record<string, ConfigurationScope>> = {
    "workbench.colorTheme": "window",
    "workbench.preferredDarkColorTheme": "window",
    "workbench.preferredLightColorTheme": "window",
    "window.autoDetectColorScheme": "window",
    "workbench.editor.enablePreview": "window",
    "workbench.editor.autoLockGroups": "window",
    "workbench.editor.closeOnFileDelete": "window",
    "workbench.editor.editorActionsLocation": "window",
    "workbench.tree.expandMode": "window",
    "workbench.list.openMode": "window",
    "workbench.sash.hoverDelay": "window",
    "workbench.secondarySideBar.defaultVisibility": "window",

    "editor.tabSize": "language-overridable",
    "editor.insertSpaces": "language-overridable",
    "editor.detectIndentation": "language-overridable",
    "editor.cursorSurroundingLines": "language-overridable",
    "editor.emptySelectionClipboard": "language-overridable",
    "editor.foldingMaximumRegions": "language-overridable",
    "editor.contextmenu": "language-overridable",
    "editor.wordWrap": "language-overridable",
    "editor.wordWrapColumn": "language-overridable",
    "editor.largeFileOptimizations": "language-overridable",
    "editor.largeFileSizeThreshold": "language-overridable",
    "editor.largeFileLineCountThreshold": "language-overridable",
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
    "editor.scrollbarMarkers": "language-overridable",
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
    // The font of the terminal Diode runs in, like `terminal.integrated.colorSource`.
    "diode.icons.nerdFont": "application",
    "terminal.capabilities": "machine",
    "terminal.modes": "machine",
    "terminal.customModes": "window",
    "terminal.integrated.tabs.enabled": "window",
    "terminal.integrated.tabs.hideCondition": "window",
    "terminal.integrated.tabs.showActiveTerminal": "window",
    "terminal.integrated.tabs.location": "window",
    "terminal.integrated.tabs.focusMode": "window",
    "terminal.integrated.hideOnLastClosed": "window",
    "terminal.integrated.enableFileLinks": "window",
    "terminal.integrated.defaultLocation": "window",
    "terminal.integrated.sendKeybindingsToShell": "window",
    "terminal.integrated.commandsToSkipShell": "window",
    "terminal.integrated.allowChords": "window",
    "terminal.integrated.allowMnemonics": "window",
    // There is one host terminal per process, not per window or folder.
    "terminal.integrated.colorSource": "application",

    "task.autoDetect": "window",
    "task.slowProviderWarning": "window",
    "task.quickOpen.detail": "window",
    "task.quickOpen.skip": "window",
    "task.saveBeforeRun": "window",
    "task.verboseLogging": "window",
    "extensions.confirmedUriHandlerExtensionIds": "application",
    "extensions.autoUpdate": "application",
    "extensions.autoUpdateDelay": "application",
    "extensions.autoCheckUpdates": "application",
};

const registered = new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS).getConfigurationProperties();

describe("CONFIGURATION_CONTRIBUTIONS: scope of every key", () => {
    // A new key without an entry here fails the test, so "can this be set per folder?" is decided when the key is added.
    it("the expectation table covers exactly the registered keys", () => {
        expect([...registered.keys()].sort()).toEqual(Object.keys(EXPECTED_SCOPES).sort());
    });

    it.each(Object.entries(EXPECTED_SCOPES))("%s → %s", (key, scope) => {
        expect(registered.get(key)?.scope).toBe(scope);
    });

    // Catches a typo like "resources" even if the table above is updated together with the registration.
    it("all scopes come from the declared set", () => {
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

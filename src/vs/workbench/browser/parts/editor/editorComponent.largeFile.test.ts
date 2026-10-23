import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodedResult, markedMetadata } from "../../../../../TestUtils/encodedTokens.ts";
import { foldsSettled } from "../../../../../TestUtils/foldingClock.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { enablePerformanceMarks, getMarks, resetPerformanceMarks } from "../../../../base/common/performance.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import type { ITokenizationSupport } from "../../../../editor/common/languages.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_STATE } from "../../../../editor/common/languages/iState.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { ILargeFileOptions } from "../../../../editor/common/model/largeFileOptions.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { DocumentSemanticTokensFeature } from "../../../../editor/contrib/semanticTokens/browser/documentSemanticTokens.ts";
import { createDefaultTokenClassificationRegistry } from "../../../../platform/theme/common/tokenClassificationRegistry.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { SemanticTokenStyleResolver } from "../../../services/themes/common/semanticTokenStyleResolver.ts";
import { darkModernTheme } from "../../../services/themes/common/themes/darkModern.ts";

/** Two lines are "many": the mode is about the decision, not the megabytes. */
const TINY: ILargeFileOptions = { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 2 };
const TS_FOREGROUND = 7;

const typescriptLanguageService: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => undefined,
};

/** Marks every line with one color that plain text never has. */
const typescriptTokenizer: ITokenizationSupport = {
    getInitialState: () => NULL_STATE,
    tokenizeEncoded: () => encodedResult([[0, markedMetadata(TS_FOREGROUND)]], NULL_STATE),
};

function firstForeground(pane: TextEditorPane): number | undefined {
    const tokenStore = pane.viewState.tokenStore;
    tokenStore?.forceTokenization(0);
    return tokenStore?.getLineTokens(0)?.getForeground(0);
}

describe("EditorComponent — the large-file mode (upstream `isTooLargeForTokenization` gates)", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-large-file-component-" });
    });
    afterEach(() => {
        resetPerformanceMarks();
        vi.useRealTimers();
        ws.dispose();
    });

    function registryWithTypescript(): TokenizationRegistry {
        const registry = new TokenizationRegistry();
        registry.register("typescript", typescriptTokenizer);
        return registry;
    }

    function openLarge(content = "block\n  a\n  b\ntail", registry = registryWithTypescript()) {
        return createEditorPane({
            registry,
            languageService: typescriptLanguageService,
            largeFileOptions: TINY,
            file: Uri.file(ws.writeFile("big.ts", content)),
        });
    }

    it("no tokenizer and no grammar load; the registered one takes over after Enable Editing", () => {
        enablePerformanceMarks();
        const registry = registryWithTypescript();
        const load = vi.spyOn(registry, "load");
        const pane = openLarge("const a = 1;\nconst b = 2;\nconst c = 3;", registry);

        expect(pane.model.isTooLargeForTokenization).toBe(true);
        expect(firstForeground(pane)).not.toBe(TS_FOREGROUND);
        expect(load).not.toHaveBeenCalled();
        expect(getMarks().filter((m) => m.name === "editor:tokenizer-ready")).toEqual([]);

        pane.model.forcefullyEnableFeatures();
        expect(firstForeground(pane)).toBe(TS_FOREGROUND);
        expect(load).toHaveBeenCalledWith("typescript");
        expect(getMarks().filter((m) => m.name === "editor:tokenizer-ready")).toHaveLength(1);
        pane.dispose();
    });

    it("folding: no regions while too large, computed after Enable Editing", async () => {
        vi.useFakeTimers();
        const pane = openLarge();
        await foldsSettled();
        expect(pane.viewState.foldedRegions).toEqual([]);

        pane.model.forcefullyEnableFeatures();
        await foldsSettled();
        expect(pane.viewState.foldedRegions.map((r) => [r.startLine, r.endLine])).toEqual([[0, 2]]);
        pane.dispose();
    });

    it("wrapping: forced off, the configuration's request comes back after Enable Editing", () => {
        const pane = openLarge();
        pane.setWordWrap("on", 10);
        expect(pane.viewState.wordWrap).toBe("off");
        expect(pane.viewState.wordWrapColumn).toBe(10);

        pane.model.forcefullyEnableFeatures();
        expect(pane.viewState.wordWrap).toBe("on");
        pane.dispose();
    });

    it("word highlighting: off before any setting arrives, the default (on) after Enable Editing", () => {
        const pane = openLarge();
        const app = TestApp.createWithContent(pane.view, new Size(40, 6));
        app.render();
        const editor = app.querySelector("EditorElement") as EditorElement;
        expect(editor.occurrenceHighlightEnabled).toBe(false);

        pane.model.forcefullyEnableFeatures();
        expect(editor.occurrenceHighlightEnabled).toBe(true);

        pane.setOccurrenceHighlightEnabled(false);
        expect(editor.occurrenceHighlightEnabled).toBe(false);
        pane.dispose();
    });

    it("word highlighting: the setting's value is kept aside while too large and applied after Enable Editing", () => {
        const pane = openLarge();
        const app = TestApp.createWithContent(pane.view, new Size(40, 6));
        app.render();
        const editor = app.querySelector("EditorElement") as EditorElement;
        pane.setOccurrenceHighlightEnabled(true);
        expect(editor.occurrenceHighlightEnabled).toBe(false);

        pane.setOccurrenceHighlightEnabled(false);
        pane.model.forcefullyEnableFeatures();
        expect(editor.occurrenceHighlightEnabled).toBe(false);
        pane.dispose();
    });

    it("semantic tokens: the document is not attached to the feature until Enable Editing", () => {
        const feature = new DocumentSemanticTokensFeature(
            new LanguageFeaturesService(),
            createTestConfigurationService(),
            new SemanticTokenStyleResolver(
                createDefaultTokenClassificationRegistry(),
                WorkbenchTheme.fromThemeFile(darkModernTheme).tokenTheme,
            ),
        );
        const attach = vi.spyOn(feature, "attach");
        const pane = createEditorPane({
            semanticTokens: feature,
            largeFileOptions: TINY,
            file: Uri.file(ws.writeFile("big.ts", "1\n2\n3")),
        });
        expect(attach).not.toHaveBeenCalled();
        expect(pane.viewState.semanticTokens).toBeUndefined();

        pane.model.forcefullyEnableFeatures();
        expect(attach).toHaveBeenCalledTimes(1);
        expect(pane.viewState.semanticTokens).toBeDefined();
        pane.dispose();
        feature.dispose();
    });

    it("an ordinary file: nothing is gated", () => {
        const pane = createEditorPane({
            registry: registryWithTypescript(),
            languageService: typescriptLanguageService,
            largeFileOptions: TINY,
            file: Uri.file(ws.writeFile("small.ts", "const a = 1;")),
        });
        expect(pane.model.isTooLargeForTokenization).toBe(false);
        expect(pane.readOnly).toBe(false);
        expect(firstForeground(pane)).toBe(TS_FOREGROUND);
        pane.setWordWrap("on", 10);
        expect(pane.viewState.wordWrap).toBe("on");
        pane.dispose();
    });
});

describe("TextEditorPane — the large-file mode opens read-only", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-large-file-pane-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    it("read-only at open; Enable Editing releases it with the event the tab listens to", () => {
        const pane = createEditorPane({ largeFileOptions: TINY, file: Uri.file(ws.writeFile("big.txt", "1\n2\n3")) });
        expect(pane.readOnly).toBe(true);
        expect(pane.isTooLargeForTokenization).toBe(true);
        expect(pane.viewState.type("x")).toBeUndefined();
        expect(pane.getText()).toBe("1\n2\n3");

        let changed = 0;
        pane.onDidChangeReadOnly(() => changed++);
        let modeChanges = 0;
        pane.onDidChangeTooLargeForTokenization(() => modeChanges++);
        pane.model.forcefullyEnableFeatures();

        expect(pane.readOnly).toBe(false);
        expect(pane.isTooLargeForTokenization).toBe(false);
        expect(changed).toBe(1);
        expect(modeChanges).toBe(1);
        pane.viewState.type("x");
        expect(pane.getText()).toBe("x1\n2\n3");
        pane.dispose();
    });
});

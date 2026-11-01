import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type { DocumentHighlightProvider } from "../../../../editor/common/languages/iDocumentHighlightSource.ts";
import type { WordHighlighter } from "../../../../editor/contrib/wordHighlighter/browser/wordHighlighter.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

const RUN_DELAY_MS = 50;
const FOO = createRange(0, 0, 0, 3);

function highlighterOf(pane: TextEditorPane<TextFileModel>): WordHighlighter {
    return (pane.component as unknown as { editor: { wordHighlighter: WordHighlighter } }).editor.wordHighlighter;
}

async function withText(pane: TextEditorPane<TextFileModel>): Promise<void> {
    pane.viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: "foo foo" }]);
    await vi.advanceTimersByTimeAsync(0);
    pane.viewState.selections = [createCursorSelection(0, 1)];
}

describe("TextEditorPane — occurrence highlighting wiring", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("the delay setting reaches the highlighter", () => {
        const pane = createEditorPane();
        pane.setOccurrenceHighlightDelay(700);
        expect(highlighterOf(pane).delay).toBe(700);
        pane.dispose();
    });

    it("the registry of the build answers", async () => {
        const documentHighlightProviders = new LanguageFeatureRegistry<DocumentHighlightProvider>();
        documentHighlightProviders.register("*", {
            provideDocumentHighlights: () => Promise.resolve([{ range: FOO }]),
        });
        const pane = createEditorPane({ documentHighlightProviders });
        await withText(pane);
        highlighterOf(pane).onFrame();
        await vi.advanceTimersByTimeAsync(RUN_DELAY_MS);

        expect(pane.viewState.wordHighlights.ranges).toEqual([FOO]);
        pane.dispose();
    });

    it("a build without a registry keeps the textual search", async () => {
        const pane = createEditorPane();
        await withText(pane);
        highlighterOf(pane).onFrame();
        await vi.advanceTimersByTimeAsync(RUN_DELAY_MS);

        expect(pane.viewState.wordHighlights.text).toHaveLength(2);
        pane.dispose();
    });

    it("dispose of the pane cancels the query in flight", async () => {
        const documentHighlightProviders = new LanguageFeatureRegistry<DocumentHighlightProvider>();
        const tokens: { isCancellationRequested: boolean }[] = [];
        documentHighlightProviders.register("*", {
            provideDocumentHighlights: (_request, token) => {
                tokens.push(token);
                return new Promise(() => undefined);
            },
        });
        const pane = createEditorPane({ documentHighlightProviders });
        await withText(pane);
        highlighterOf(pane).onFrame();
        await vi.advanceTimersByTimeAsync(RUN_DELAY_MS);
        expect(tokens).toHaveLength(1);

        pane.dispose();

        expect(tokens[0].isCancellationRequested).toBe(true);
    });
});

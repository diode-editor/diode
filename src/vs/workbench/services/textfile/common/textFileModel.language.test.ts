import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodedResult, markedMetadata } from "../../../../../TestUtils/encodedTokens.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { EncodedTokenizationResult, ITokenizationSupport } from "../../../../editor/common/languages.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_STATE } from "../../../../editor/common/languages/iState.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IDocumentLanguageChange } from "../../../../editor/common/model/iDocumentLanguageChange.ts";

function markerTokenizer(marker: number): ITokenizationSupport {
    return {
        getInitialState: () => NULL_STATE,
        tokenizeEncoded(): EncodedTokenizationResult {
            return encodedResult([[0, markedMetadata(marker)]], NULL_STATE);
        },
    };
}

// Tokenizer markers: colors that plain text (ColorId.DefaultForeground) never has.
const MARKDOWN = 10;
const TYPESCRIPT = 11;
const PYTHON = 12;

const TS_ONLY_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

function firstMarker(ctrl: TextEditorPane): number | undefined {
    const tokenStore = ctrl.viewState.tokenStore;
    tokenStore?.forceTokenization(0);
    return tokenStore?.getLineTokens(0)?.getForeground(0);
}

describe("TextFileModel — language", () => {
    let ws: ITempWorkspace;
    let registry: TokenizationRegistry;
    let ctrl: TextEditorPane;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-editorctrl-lang-" });
        registry = new TokenizationRegistry();
        ctrl = createEditorPane({ registry, languageService: TS_ONLY_LANGUAGE_SERVICE });
    });

    afterEach(() => {
        ctrl.dispose();
        ws.dispose();
    });

    function writeFile(name: string, content: string): string {
        return ws.writeFile(name, content);
    }

    it("before a file is opened the language is plaintext", () => {
        expect(ctrl.languageId).toBe("plaintext");
    });

    it("openFile resolves the language via ILanguageService", () => {
        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        expect(ctrl.languageId).toBe("typescript");
    });

    it("an unknown extension falls back to plaintext", () => {
        ctrl.openFile(Uri.file(writeFile("a.unknown", "?")));
        expect(ctrl.languageId).toBe("plaintext");
    });

    it("setLanguage changes the language and relays the event to controller subscribers", () => {
        const changes: IDocumentLanguageChange[] = [];
        // Subscribe BEFORE openFile: opening is a language change too (there is one document
        // for the model's whole life, and it is born plaintext).
        ctrl.onDidChangeLanguage((change) => changes.push(change));

        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        ctrl.setLanguage("markdown");

        expect(ctrl.languageId).toBe("markdown");
        expect(changes).toEqual([
            { oldLanguageId: "plaintext", newLanguageId: "typescript" },
            { oldLanguageId: "typescript", newLanguageId: "markdown" },
        ]);
    });

    it("disposing an onDidChangeLanguage subscription stops delivery, a second dispose is a no-op", () => {
        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        let fired = 0;
        const subscription = ctrl.onDidChangeLanguage(() => fired++);

        ctrl.setLanguage("markdown");
        subscription.dispose();
        subscription.dispose();
        ctrl.setLanguage("json");

        expect(fired).toBe(1);
    });

    it("setLanguage moves the tokenizer to the target language", () => {
        registry.register("markdown", markerTokenizer(MARKDOWN));
        ctrl.openFile(Uri.file(writeFile("a.ts", "# header")));
        expect(firstMarker(ctrl)).not.toBe(MARKDOWN);

        ctrl.setLanguage("markdown");

        expect(firstMarker(ctrl)).toBe(MARKDOWN);
    });

    it("hot-swap: a grammar registered after openFile is picked up", () => {
        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        expect(firstMarker(ctrl)).not.toBe(TYPESCRIPT);

        registry.register("typescript", markerTokenizer(TYPESCRIPT));

        expect(firstMarker(ctrl)).toBe(TYPESCRIPT);
    });

    it("registering a grammar for another language does not invalidate tokens", () => {
        registry.register("typescript", markerTokenizer(TYPESCRIPT));
        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        expect(firstMarker(ctrl)).toBe(TYPESCRIPT);

        registry.register("python", markerTokenizer(PYTHON));

        expect(firstMarker(ctrl)).toBe(TYPESCRIPT);
    });
});

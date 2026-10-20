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

/** Токенизатор-маркер: помечает всю строку одним токеном с заданным индексом цвета. */
function markerTokenizer(marker: number): ITokenizationSupport {
    return {
        getInitialState: () => NULL_STATE,
        tokenizeEncoded(): EncodedTokenizationResult {
            return encodedResult([[0, markedMetadata(marker)]], NULL_STATE);
        },
    };
}

// Метки токенизаторов: цвета, которых у plain text (ColorId.DefaultForeground) не бывает.
const MARKDOWN = 10;
const TYPESCRIPT = 11;
const PYTHON = 12;

const TS_ONLY_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

/** Метка первого токена первой строки — чем токенизирован документ прямо сейчас. */
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

    it("до открытия файла язык plaintext", () => {
        expect(ctrl.languageId).toBe("plaintext");
    });

    it("openFile резолвит язык через ILanguageService", () => {
        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        expect(ctrl.languageId).toBe("typescript");
    });

    it("незнакомое расширение откатывается на plaintext", () => {
        ctrl.openFile(Uri.file(writeFile("a.unknown", "?")));
        expect(ctrl.languageId).toBe("plaintext");
    });

    it("setLanguage меняет язык и ретранслирует событие подписчикам контроллера", () => {
        const changes: IDocumentLanguageChange[] = [];
        // Подписка ДО openFile: открытие — тоже смена языка (документ один на
        // всю жизнь модели и рождается plaintext).
        ctrl.onDidChangeLanguage((change) => changes.push(change));

        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        ctrl.setLanguage("markdown");

        expect(ctrl.languageId).toBe("markdown");
        expect(changes).toEqual([
            { oldLanguageId: "plaintext", newLanguageId: "typescript" },
            { oldLanguageId: "typescript", newLanguageId: "markdown" },
        ]);
    });

    it("dispose подписки onDidChangeLanguage останавливает доставку, повторный dispose — no-op", () => {
        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        let fired = 0;
        const subscription = ctrl.onDidChangeLanguage(() => fired++);

        ctrl.setLanguage("markdown");
        subscription.dispose();
        subscription.dispose();
        ctrl.setLanguage("json");

        expect(fired).toBe(1);
    });

    it("setLanguage пересаживает токенизатор на язык назначения", () => {
        registry.register("markdown", markerTokenizer(MARKDOWN));
        ctrl.openFile(Uri.file(writeFile("a.ts", "# header")));
        expect(firstMarker(ctrl)).not.toBe(MARKDOWN);

        ctrl.setLanguage("markdown");

        expect(firstMarker(ctrl)).toBe(MARKDOWN);
    });

    it("hot-swap: грамматика, зарегистрированная после openFile, подхватывается", () => {
        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        // Файл открыт до регистрации — работает fallback PlainTextTokenizer.
        expect(firstMarker(ctrl)).not.toBe(TYPESCRIPT);

        registry.register("typescript", markerTokenizer(TYPESCRIPT));

        expect(firstMarker(ctrl)).toBe(TYPESCRIPT);
    });

    it("регистрация грамматики чужого языка не инвалидирует токены", () => {
        registry.register("typescript", markerTokenizer(TYPESCRIPT));
        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        expect(firstMarker(ctrl)).toBe(TYPESCRIPT);

        registry.register("python", markerTokenizer(PYTHON));

        expect(firstMarker(ctrl)).toBe(TYPESCRIPT);
    });
});

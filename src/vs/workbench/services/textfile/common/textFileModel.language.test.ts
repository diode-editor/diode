import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { createLineTokens, createToken } from "../../../../editor/common/languages/iLineTokens.ts";
import { NULL_STATE } from "../../../../editor/common/languages/iState.ts";
import type {
    ITokenizationResult,
    ITokenizationSupport,
} from "../../../../editor/common/languages/iTokenizationSupport.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IDocumentLanguageChange } from "../../../../editor/common/model/iDocumentLanguageChange.ts";

/** Токенизатор-маркер: помечает всю строку одним заданным scope. */
function markerTokenizer(scope: string): ITokenizationSupport {
    return {
        getInitialState: () => NULL_STATE,
        tokenizeLine(): ITokenizationResult {
            return { tokens: createLineTokens([createToken(0, [scope])]), endState: NULL_STATE };
        },
    };
}

const TS_ONLY_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

function firstScope(ctrl: TextEditorPane): string | undefined {
    const tokenStore = ctrl.viewState.tokenStore;
    tokenStore?.tokenizeUpTo(0);
    return tokenStore?.getLineTokens(0)?.tokens[0]?.scopes[0];
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
        // Подписка ДО openFile — должна пережить пересоздание документа.
        ctrl.onDidChangeLanguage((change) => changes.push(change));

        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        ctrl.setLanguage("markdown");

        expect(ctrl.languageId).toBe("markdown");
        expect(changes).toEqual([{ oldLanguageId: "typescript", newLanguageId: "markdown" }]);
    });

    it("dispose подписки onDidChangeLanguage останавливает доставку, повторный dispose — no-op", () => {
        let fired = 0;
        const subscription = ctrl.onDidChangeLanguage(() => fired++);
        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));

        ctrl.setLanguage("markdown");
        subscription.dispose();
        subscription.dispose();
        ctrl.setLanguage("json");

        expect(fired).toBe(1);
    });

    it("setLanguage пересаживает токенизатор на язык назначения", () => {
        registry.register("markdown", markerTokenizer("markup.markdown"));
        ctrl.openFile(Uri.file(writeFile("a.ts", "# header")));
        expect(firstScope(ctrl)).not.toBe("markup.markdown");

        ctrl.setLanguage("markdown");

        expect(firstScope(ctrl)).toBe("markup.markdown");
    });

    it("hot-swap: грамматика, зарегистрированная после openFile, подхватывается", () => {
        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        // Файл открыт до регистрации — работает fallback PlainTextTokenizer.
        expect(firstScope(ctrl)).not.toBe("source.ts");

        registry.register("typescript", markerTokenizer("source.ts"));

        expect(firstScope(ctrl)).toBe("source.ts");
    });

    it("регистрация грамматики чужого языка не инвалидирует токены", () => {
        registry.register("typescript", markerTokenizer("source.ts"));
        ctrl.openFile(Uri.file(writeFile("a.ts", "const x = 1;")));
        expect(firstScope(ctrl)).toBe("source.ts");

        registry.register("python", markerTokenizer("source.python"));

        expect(firstScope(ctrl)).toBe("source.ts");
    });
});

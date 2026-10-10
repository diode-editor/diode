import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type {
    DocumentRangeSemanticTokensProvider,
    DocumentSemanticTokensProvider,
} from "../../../../editor/common/languages/iSemanticTokensSource.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { DocumentSemanticTokensFeature } from "../../../../editor/contrib/semanticTokens/browser/documentSemanticTokens.ts";
import { parseHexColor } from "../../../../platform/theme/common/colorUtils.ts";
import { createDefaultTokenClassificationRegistry } from "../../../../platform/theme/common/tokenClassificationRegistry.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { SemanticTokenStyleResolver } from "../../../services/themes/common/semanticTokenStyleResolver.ts";
import { darkModernTheme } from "../../../services/themes/common/themes/darkModern.ts";

/** Ответ провайдера / range-провайдера разрешается макрозадачей (setTimeout 0 планировщика). */
function flush(ms = 0): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const LEGEND = { tokenTypes: ["class", "parameter"], tokenModifiers: [] };
/** Dark Modern: class — `entity.name.type.class` → #4EC9B0. */
const CLASS_FG = parseHexColor("#4EC9B0");

describe("EditorComponent — семантическая подсветка от провайдера", () => {
    let ws: ITempWorkspace;
    let languageFeatures: LanguageFeaturesService;
    let feature: DocumentSemanticTokensFeature;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-semantic-" });
        languageFeatures = new LanguageFeaturesService();
        feature = new DocumentSemanticTokensFeature(
            languageFeatures,
            createTestConfigurationService(),
            new SemanticTokenStyleResolver(
                createDefaultTokenClassificationRegistry(),
                WorkbenchTheme.fromThemeFile(darkModernTheme).tokenTheme,
            ),
        );
    });
    afterEach(() => {
        feature.dispose();
        ws.dispose();
    });

    function open(text: string): { pane: TextEditorPane; app: TestApp; gutter: number } {
        const pane = createEditorPane({ semanticTokens: feature });
        pane.openFile(Uri.file(ws.writeFile("Doc.txt", text)));
        const app = TestApp.createWithContent(pane.view, new Size(30, 4));
        app.render();
        // Гуттер: 2 паддинга + 1 цифра + fold-маржин (3).
        return { pane, app, gutter: 6 };
    }

    it("токены провайдера документа доходят до кадра: класс красится цветом темы", async () => {
        const provider: DocumentSemanticTokensProvider = {
            getLegend: () => LEGEND,
            provideDocumentSemanticTokens: () =>
                Promise.resolve({ resultId: "1", data: new Uint32Array([0, 4, 5, 0, 0]) }),
            releaseDocumentSemanticTokens: () => undefined,
        };
        languageFeatures.documentSemanticTokensProvider.register("*", provider);
        const { app, gutter } = open("new Hello()");
        await flush();
        app.render();
        expect(app.backend.getFgAt(new Point(gutter + 4, 0))).toBe(CLASS_FG);
        expect(app.backend.getFgAt(new Point(gutter + 8, 0))).toBe(CLASS_FG);
        expect(app.backend.getFgAt(new Point(gutter, 0))).not.toBe(CLASS_FG);
    });

    it("вью одного документа делят токены; закрытие последней снимает документ", async () => {
        let requests = 0;
        let released = 0;
        languageFeatures.documentSemanticTokensProvider.register("*", {
            getLegend: () => LEGEND,
            provideDocumentSemanticTokens: () => {
                requests++;
                return Promise.resolve({ resultId: String(requests), data: new Uint32Array([0, 0, 1, 0, 0]) });
            },
            releaseDocumentSemanticTokens: () => {
                released++;
            },
        });
        const { pane } = open("A");
        await flush();
        expect(pane.viewState.semanticTokens?.getLineTokens(0)?.tokens).toEqual([0, 1, 0, 0]);
        expect(requests).toBe(1);
        pane.dispose();
        expect(released).toBe(1);
    });

    it("пока полного набора нет, видимую область докрашивает range-провайдер", async () => {
        const ranges: number[][] = [];
        const rangeProvider: DocumentRangeSemanticTokensProvider = {
            getLegend: () => LEGEND,
            provideDocumentRangeSemanticTokens: (request) => {
                ranges.push([request.range.start.line, request.range.end.line]);
                return Promise.resolve({ resultId: undefined, data: new Uint32Array([1, 0, 5, 0, 0]) });
            },
        };
        languageFeatures.documentRangeSemanticTokensProvider.register("*", rangeProvider);
        const { app, gutter } = open("x\nHello");
        // Пауза range-провайдера — от 100 мс (адаптивная, без истории — 150).
        await flush(200);
        app.render();
        expect(ranges).toEqual([[0, 1]]);
        expect(app.backend.getFgAt(new Point(gutter, 1))).toBe(CLASS_FG);
    });
});

import { blendRgb, packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type { DocumentColorProvider, IColorInformation } from "../../../../editor/common/languages/iColorSource.ts";
import type { ILargeFileOptions } from "../../../../editor/common/model/largeFileOptions.ts";
import {
    DEFAULT_COLOR_DECORATORS_OPTIONS,
    type IColorDecoratorsOptions,
} from "../../../../editor/contrib/colorPicker/browser/colorDetector.ts";
import { DefaultDocumentColorProvider } from "../../../../editor/contrib/colorPicker/browser/defaultDocumentColorProvider.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

// Gutter: 2 padding + 1 digit + fold margin (3) = 6.
const GUTTER = 6;
/** Past the longest recompute delay. */
const SETTLE_MS = 1000;
const DARK_PLUS_BACKGROUND = 0x1e1e1e;

function options(patch: Partial<IColorDecoratorsOptions>): IColorDecoratorsOptions {
    return { ...DEFAULT_COLOR_DECORATORS_OPTIONS, ...patch };
}

function external(colors: readonly IColorInformation[] | null): DocumentColorProvider {
    return { provideDocumentColors: () => Promise.resolve(colors) };
}

describe("EditorComponent — color decorators", () => {
    let ws: ITempWorkspace;
    let providers: LanguageFeatureRegistry<DocumentColorProvider>;

    beforeEach(() => {
        vi.useFakeTimers();
        ws = createTempWorkspace({ prefix: "diode-color-decorators-" });
        providers = new LanguageFeatureRegistry<DocumentColorProvider>();
        providers.register("*", new DefaultDocumentColorProvider());
    });
    afterEach(() => {
        vi.useRealTimers();
        ws.dispose();
    });

    async function open(
        content: string,
        size = new Size(40, 4),
        largeFileOptions?: ILargeFileOptions,
    ): Promise<{ pane: TextEditorPane; app: TestApp; row: (y?: number) => string }> {
        const pane = createEditorPane({
            colorProviders: providers,
            file: Uri.file(ws.writeFile("a.css", content)),
            largeFileOptions,
        });
        const app = TestApp.createWithContent(pane.view, size);
        await settle(app);
        const row = (y = 0): string => app.backend.getTextAt(new Point(GUTTER, y), size.width - GUTTER).trimEnd();
        return { pane, app, row };
    }

    async function settle(app: TestApp): Promise<void> {
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        app.render();
    }

    it("draws a square of the color and a space before it; the tail moves right", async () => {
        const { app, row } = await open("a { color: #ff0000; }");
        expect(row()).toBe("a { color: ■ #ff0000; }");
        expect(app.backend.getFgAt(new Point(GUTTER + 11, 0))).toBe(packRgb(255, 0, 0));
    });

    it("every color of a line gets its square, each in its own color", async () => {
        const { app, row } = await open("x: #00f rgb(0, 255, 0) hsl(0, 100%, 50%)");
        expect(row()).toBe("x: ■ #00f ■ rgb(0, 255, 0) ■ hsl(0, 100%, 50%)".slice(0, 34));
        expect(app.backend.getFgAt(new Point(GUTTER + 3, 0))).toBe(packRgb(0, 0, 255));
        expect(app.backend.getFgAt(new Point(GUTTER + 10, 0))).toBe(packRgb(0, 255, 0));
    });

    it("a translucent color is blended over the editor background, and follows a theme change", async () => {
        const { app } = await open("x: #ff000080");
        const at = new Point(GUTTER + 3, 0);
        expect(app.backend.getFgAt(at)).toBe(blendRgb(0xff0000, DARK_PLUS_BACKGROUND, 128 / 255));

        const vars = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        app.root.setStyleVars({ ...vars, "editor.background": 0x0000ff });
        app.render();
        expect(app.backend.getFgAt(at)).toBe(blendRgb(0xff0000, 0x0000ff, 128 / 255));
    });

    it("typed color: the square comes after the debounce; erased: it goes at once", async () => {
        const { pane, app, row } = await open("x: ");
        pane.goToPosition(0, 3);
        pane.viewState.type("#abc");
        app.render();
        expect(row()).toBe("x: #abc");
        await settle(app);
        expect(row()).toBe("x: ■ #abc");

        // Before the recompute the square follows its text, and leaves with it.
        pane.goToPosition(0, 0);
        pane.viewState.type("ab");
        app.render();
        expect(row()).toBe("abx: ■ #abc");
        pane.viewState.applyEdits([{ range: createRange(0, 5, 0, 9), text: "" }], "test");
        app.render();
        expect(row()).toBe("abx:");
        pane.dispose();
    });

    it("a square of a line below an edit moves with its line until the recompute", async () => {
        const { pane, app, row } = await open("a\nb: #fff");
        pane.goToPosition(0, 1);
        pane.viewState.type("\n");
        app.render();
        expect(row(2)).toBe("b: ■ #fff");
        pane.dispose();
    });

    it("editor.colorDecorators off removes the squares, on brings them back without reopening", async () => {
        const { pane, app, row } = await open("x: #fff");
        pane.setColorDecorators(options({ enabled: false }));
        app.render();
        expect(row()).toBe("x: #fff");
        // Nothing comes back by itself while off.
        await settle(app);
        expect(row()).toBe("x: #fff");

        pane.setColorDecorators(options({ enabled: true }));
        await settle(app);
        expect(row()).toBe("x: ■ #fff");
    });

    it("the limit draws the first colors in document order; raising it draws more", async () => {
        const { pane, app, row } = await open("#111\n#222\n#333", new Size(40, 4));
        pane.setColorDecorators(options({ limit: 2 }));
        await settle(app);
        expect([row(0), row(1), row(2)]).toEqual(["■ #111", "■ #222", "#333"]);

        pane.setColorDecorators(options({ limit: 500 }));
        await settle(app);
        expect(row(2)).toBe("■ #333");
    });

    it("auto: an extension's answer silences the default detector, `always` adds it back, `never` silences it alone", async () => {
        const { pane, app, row } = await open("x: #fff #000");
        providers.register(
            "*",
            external([{ range: createRange(0, 8, 0, 12), color: { red: 0, green: 0, blue: 1, alpha: 1 } }]),
        );
        await settle(app);
        expect(row()).toBe("x: #fff ■ #000");
        expect(app.backend.getFgAt(new Point(GUTTER + 8, 0))).toBe(packRgb(0, 0, 255));

        pane.setColorDecorators(options({ defaultEnablement: "always" }));
        await settle(app);
        expect(row()).toBe("x: ■ #fff ■ ■ #000");

        pane.setColorDecorators(options({ defaultEnablement: "never" }));
        await settle(app);
        expect(row()).toBe("x: #fff ■ #000");
    });

    it("an extension answering with no array leaves the default detector on; `never` turns it off", async () => {
        const { pane, app, row } = await open("x: #fff");
        providers.register("*", external(null));
        await settle(app);
        expect(row()).toBe("x: ■ #fff");

        pane.setColorDecorators(options({ defaultEnablement: "never" }));
        await settle(app);
        expect(row()).toBe("x: #fff");
    });

    it("a language change asks the providers of the new language", async () => {
        providers = new LanguageFeatureRegistry<DocumentColorProvider>();
        providers.register(
            "css",
            external([{ range: createRange(0, 3, 0, 7), color: { red: 1, green: 0, blue: 0, alpha: 1 } }]),
        );
        const { pane, app, row } = await open("x: #fff");
        expect(pane.languageId).not.toBe("css");
        expect(row()).toBe("x: #fff");

        pane.setLanguage("css");
        await settle(app);
        expect(row()).toBe("x: ■ #fff");
    });

    it("a failing provider is reported and does not take the others down", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        const { app, row } = await open("x: #fff");
        providers.register("*", { provideDocumentColors: () => Promise.reject(new Error("boom")) });
        await settle(app);
        expect(row()).toBe("x: ■ #fff");
        expect(errors).toEqual([new Error("boom")]);
    });

    it("the large-file mode draws no squares; Enable Editing brings them", async () => {
        const { pane, app, row } = await open("#111\n#222\n#333", new Size(40, 4), {
            largeFileOptimizations: true,
            sizeThresholdMb: 1,
            lineCountThreshold: 2,
        });
        expect(row(0)).toBe("#111");

        pane.model.forcefullyEnableFeatures();
        await settle(app);
        expect(row(0)).toBe("■ #111");
    });

    it("a color below empty lines gets its square on its own line", async () => {
        const { row } = await open("\n\n#111");
        expect(row(2)).toBe("■ #111");
    });

    it("the default detector skips a document above the sync limit, as upstream's worker does", async () => {
        providers = new LanguageFeatureRegistry<DocumentColorProvider>();
        providers.register("*", new DefaultDocumentColorProvider(9));
        const within = await open("#111\n#222");
        expect(within.row(0)).toBe("■ #111");

        const above = await open("#111\n#2222");
        expect(above.row(0)).toBe("#111");
    });

    it("a file with hundreds of thousands of colors still draws the first squares", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        // 60k lines, 180k colors: below the large-file thresholds, a generated palette or a minified stylesheet.
        const { row } = await open(Array.from({ length: 60_000 }, () => "#0f0 rgb(1,2,3) #abc").join("\n"));
        expect(errors).toEqual([]);
        // The gutter is wider here: five digits of line numbers.
        expect(row(0)).toMatch(/^ *1 +■ #0f0 ■ rgb\(1,2,3\) ■ #abc$/u);
    });

    it("without a color provider registry (the default) nothing is drawn", async () => {
        const pane = createEditorPane({ file: Uri.file(ws.writeFile("b.css", "x: #fff")) });
        const app = TestApp.createWithContent(pane.view, new Size(30, 2));
        await settle(app);
        expect(app.backend.getTextAt(new Point(GUTTER, 0), 7)).toBe("x: #fff");
    });
});

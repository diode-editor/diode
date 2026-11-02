import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type { ILink, LinkProvider } from "../../../../editor/common/languages/iLinkSource.ts";
import type { ILargeFileOptions } from "../../../../editor/common/model/largeFileOptions.ts";
import { DefaultLinkProvider } from "../../../../editor/contrib/links/browser/defaultLinkProvider.ts";

// Gutter: 2 padding + 1 digit + fold margin (3) = 6.
const GUTTER = 6;
/** Past the debounce of an edit. */
const SETTLE_MS = 4000;
const TEXT = "see https://a.b/c now";
/** Inside the link, on the frame. */
const ON_LINK = GUTTER + 6;

describe("EditorComponent — document links", () => {
    let ws: ITempWorkspace;
    let providers: LanguageFeatureRegistry<LinkProvider>;

    beforeEach(() => {
        vi.useFakeTimers();
        ws = createTempWorkspace({ prefix: "diode-links-" });
        providers = new LanguageFeatureRegistry<LinkProvider>();
        providers.register("*", new DefaultLinkProvider());
    });
    afterEach(() => {
        vi.useRealTimers();
        ws.dispose();
    });

    async function settle(app: TestApp): Promise<void> {
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        app.render();
    }

    async function open(
        content = TEXT,
        largeFileOptions?: ILargeFileOptions,
    ): Promise<{ pane: TextEditorPane; app: TestApp; underlined: (x: number) => boolean }> {
        const pane = createEditorPane({
            linkProviders: providers,
            file: Uri.file(ws.writeFile("a.md", content)),
            largeFileOptions,
        });
        const app = TestApp.createWithContent(pane.view, new Size(50, 3));
        await settle(app);
        const underlined = (x: number): boolean =>
            (app.app.screen.getCell(new Point(x, 0)).style & StyleFlags.Underline) !== 0;
        return { pane, app, underlined };
    }

    function ctrlClick(pane: TextEditorPane, x: number): void {
        for (const kind of ["mousedown", "mouseup"] as const) {
            pane.component.view.getChild().dispatchEvent(
                new TUIMouseEvent(kind, {
                    button: "left",
                    screenX: x,
                    screenY: 0,
                    localX: x,
                    localY: 0,
                    ctrlKey: true,
                }),
            );
        }
    }

    it("the link of a file is underlined on the frame, the text around it is not", async () => {
        const { underlined } = await open();
        expect(underlined(GUTTER + 3)).toBe(false);
        expect(underlined(GUTTER + 4)).toBe(true);
        expect(underlined(GUTTER + 16)).toBe(true);
        expect(underlined(GUTTER + 17)).toBe(false);
    });

    it("editor.links off removes the underline, on brings it back without reopening", async () => {
        const { pane, app, underlined } = await open();
        pane.setLinksEnabled(false);
        await settle(app);
        expect(underlined(ON_LINK)).toBe(false);
        expect(pane.getLinksAtSelections()).toEqual([]);

        pane.setLinksEnabled(true);
        await settle(app);
        expect(underlined(ON_LINK)).toBe(true);
    });

    it("editor.links off before a large file gets its detector is respected", async () => {
        const { pane, app, underlined } = await open(`${TEXT}\nb\nc`, {
            largeFileOptimizations: true,
            sizeThresholdMb: 1,
            lineCountThreshold: 2,
        });
        pane.setLinksEnabled(false);
        pane.model.forcefullyEnableFeatures();
        await settle(app);
        expect(underlined(ON_LINK)).toBe(false);
    });

    it("an edit brings the underline to a new link after the debounce", async () => {
        const { pane, app, underlined } = await open("plain text");
        expect(underlined(GUTTER)).toBe(false);
        pane.typeText("http://x.y ");
        await settle(app);
        expect(underlined(GUTTER)).toBe(true);
    });

    it("a large file has no detector until its features are enabled", async () => {
        const { pane, app, underlined } = await open(`${TEXT}\nb\nc`, {
            largeFileOptimizations: true,
            sizeThresholdMb: 1,
            lineCountThreshold: 2,
        });
        expect(underlined(ON_LINK)).toBe(false);
        pane.model.forcefullyEnableFeatures();
        await settle(app);
        expect(underlined(ON_LINK)).toBe(true);
    });

    it("without a registry (the diff, OUTPUT) nothing is detected, and nothing is asked", async () => {
        const pane = createEditorPane({ file: Uri.file(ws.writeFile("c.md", TEXT)) });
        const app = TestApp.createWithContent(pane.view, new Size(50, 3));
        await settle(app);
        pane.setLinksEnabled(false);
        expect(pane.getLinksAtSelections()).toEqual([]);
        expect((app.app.screen.getCell(new Point(ON_LINK, 0)).style & StyleFlags.Underline) !== 0).toBe(false);
    });

    it("Ctrl+click gives the link to the pane's listener", async () => {
        const { pane } = await open();
        const clicked: ILink[] = [];
        pane.onDidClickLink((link) => clicked.push(link));
        ctrlClick(pane, ON_LINK);
        expect(clicked.map((link) => link.url)).toEqual(["https://a.b/c"]);
    });

    it("the link at the end of each selection; a selection off a link adds nothing", async () => {
        const { pane } = await open("http://a.b x http://c.d");
        pane.viewState.selections = [
            createCursorSelection(0, 3),
            createCursorSelection(0, 11),
            createCursorSelection(0, 20),
        ];
        expect(pane.getLinksAtSelections().map((link) => link.url)).toEqual(["http://a.b", "http://c.d"]);
    });
});

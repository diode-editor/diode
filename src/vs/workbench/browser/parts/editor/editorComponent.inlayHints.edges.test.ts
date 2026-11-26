import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type { InlayHint, InlayHintsProvider } from "../../../../editor/common/languages/iInlayHintsSource.ts";

// Gutter: 2 padding + 1 digit + fold margin (3) = 6.
const GUTTER = 6;
/** Past the longest recompute delay. */
const SETTLE_MS = 1000;

function hint(line: number, character: number, label: string): InlayHint {
    return { position: { line, character }, label };
}

describe("EditorComponent — inlay hints, tester's edges", () => {
    let ws: ITempWorkspace;
    let providers: LanguageFeatureRegistry<InlayHintsProvider>;

    beforeEach(() => {
        vi.useFakeTimers();
        ws = createTempWorkspace({ prefix: "diode-inlay-edges-" });
        providers = new LanguageFeatureRegistry<InlayHintsProvider>();
    });
    afterEach(() => {
        setUnexpectedErrorHandler(() => undefined);
        vi.useRealTimers();
        ws.dispose();
    });

    async function open(content: string): Promise<{
        pane: TextEditorPane;
        row: () => string;
        settle: () => Promise<void>;
    }> {
        const size = new Size(40, 4);
        const pane = createEditorPane({
            inlayHintsProviders: providers,
            file: Uri.file(ws.writeFile("a.ts", content)),
        });
        const app = TestApp.createWithContent(pane.view, size);
        const settle = async (): Promise<void> => {
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            app.render();
        };
        await settle();
        const row = (): string => app.backend.getTextAt(new Point(GUTTER, 0), size.width - GUTTER).trimEnd();
        return { pane, row, settle };
    }

    it("a position inside a surrogate pair does not tear the character apart", async () => {
        providers.register("*", {
            provideInlayHints: () => ({ hints: [hint(0, 1, "H")], dispose: () => undefined }),
        });
        const { row, pane } = await open("😀a");
        // Upstream's validatePosition moves such a position before the pair.
        expect(row()).toMatch(/^H😀\s?a$/u);
        pane.dispose();
    });

    it("a list whose dispose throws costs only itself: the next answer is drawn", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        const change = new Emitter<void>();
        let label = "OLD";
        providers.register("*", {
            onDidChangeInlayHints: change.event,
            provideInlayHints: () => ({
                hints: [hint(0, 0, label)],
                dispose: () => {
                    throw new Error("dispose failure");
                },
            }),
        });
        const { row, pane, settle } = await open("x");
        expect(row()).toBe("OLDx");
        label = "NEW";
        change.fire();
        await settle();
        expect(row()).toBe("NEWx");
        expect(errors.map((e) => (e as Error).message)).toContain("dispose failure");
        expect(() => {
            pane.dispose();
        }).not.toThrow();
    });
});

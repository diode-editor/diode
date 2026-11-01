import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type { InlayHintsProvider } from "../../../../editor/common/languages/iInlayHintsSource.ts";

// Upstream wraps a line with its injected text (`createLineBreaks` applies it before breaking), so hints
// never push the code past the right edge of a wrapped editor.

/** Past the longest recompute delay. */
const SETTLE_MS = 1000;
const SIZE = new Size(40, 6);
/** The line fits the width by itself; only its hint makes it too long. */
const LINE = "value = compute(12) + tail_end";
const HINT = "a_long_parameter_name: ";

describe("EditorComponent — inlay hints under word wrap", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        vi.useFakeTimers();
        ws = createTempWorkspace({ prefix: "diode-inlay-hints-wrap-" });
    });
    afterEach(() => {
        vi.useRealTimers();
        ws.dispose();
    });

    async function frameWithHint(): Promise<string> {
        const providers = new LanguageFeatureRegistry<InlayHintsProvider>();
        providers.register("*", {
            provideInlayHints: () => ({
                hints: [{ position: { line: 0, character: LINE.indexOf("12") }, label: HINT }],
                dispose: () => undefined,
            }),
        });
        const pane = createEditorPane({
            inlayHintsProviders: providers,
            file: Uri.file(ws.writeFile("a.ts", `${LINE}\nnext`)),
        });
        const app = TestApp.createWithContent(pane.view, SIZE);
        pane.setWordWrap("on", 80);
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        app.render();
        const frame = app.backend.screenToString();
        pane.dispose();
        return frame;
    }

    it("the code after a hint stays on the frame: the line wraps with the hint's width", async () => {
        const frame = (await frameWithHint()).replace(/\s+/g, "");
        expect(frame).toContain("compute(a_long_parameter_name:12)+tail_end");
    });

    it("the file's rows follow the hints: no hint, no extra row", async () => {
        const providers = new LanguageFeatureRegistry<InlayHintsProvider>();
        const pane = createEditorPane({
            inlayHintsProviders: providers,
            file: Uri.file(ws.writeFile("a.ts", `${LINE}\nnext`)),
        });
        const app = TestApp.createWithContent(pane.view, SIZE);
        pane.setWordWrap("on", 80);
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        app.render();
        const rowOfNext = (): number =>
            app.backend
                .screenToString()
                .split("\n")
                .findIndex((row) => row.includes("next"));
        const before = rowOfNext();

        const registration = providers.register("*", {
            provideInlayHints: () => ({
                hints: [{ position: { line: 0, character: LINE.indexOf("12") }, label: HINT }],
                dispose: () => undefined,
            }),
        });
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        app.render();
        expect(rowOfNext()).toBeGreaterThan(before);

        registration.dispose();
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
        app.render();
        expect(rowOfNext()).toBe(before);
        pane.dispose();
    });
});

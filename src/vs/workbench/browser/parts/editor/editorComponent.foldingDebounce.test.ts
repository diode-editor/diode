import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FOLDING_SETTLE_MS, foldsSettled } from "../../../../../TestUtils/foldingClock.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type { FoldingRangeProvider } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { IFoldingRegion } from "../../../../editor/contrib/folding/iFoldingRegion.ts";

/** Upstream `{ min: 200 }`: the quiet time an edit needs before the regions are recomputed. */
const MIN_DELAY_MS = 200;

function spans(ctrl: TextEditorPane): [number, number][] {
    return ctrl.viewState.foldedRegions.map((r) => [r.startLine, r.endLine]);
}

function regionOf(regions: [number, number][]): IFoldingRegion[] {
    return regions.map(([startLine, endLine]) => ({ startLine, endLine, isCollapsed: false }));
}

/** Every request waits for `answer`; the tokens it was given are kept for inspection. */
function deferredProvider(): {
    provider: FoldingRangeProvider;
    requests: number;
    tokens: ICancellationToken[];
    answer: (regions: IFoldingRegion[]) => void;
} {
    const pending: ((regions: IFoldingRegion[]) => void)[] = [];
    const state = {
        requests: 0,
        tokens: [] as ICancellationToken[],
        answer: (regions: IFoldingRegion[]) => {
            for (const resolve of pending.splice(0)) resolve(regions.map((r) => ({ ...r })));
        },
        provider: {
            provideFoldingRanges: (_request, token) => {
                state.requests++;
                state.tokens.push(token);
                return new Promise<IFoldingRegion[]>((resolve) => pending.push(resolve));
            },
        } as FoldingRangeProvider,
    };
    return state;
}

describe("EditorComponent – folding is recomputed lazily, after a delay", () => {
    let ws: ITempWorkspace;
    let providers: LanguageFeatureRegistry<FoldingRangeProvider>;

    beforeEach(() => {
        vi.useFakeTimers();
        ws = createTempWorkspace({ prefix: "diode-folddelay-" });
        providers = new LanguageFeatureRegistry<FoldingRangeProvider>();
    });
    afterEach(() => {
        ws.dispose();
        vi.useRealTimers();
    });

    /** The app's order: the file is loaded before the component is built (no reload event). */
    function openAsApp(content: string): TextEditorPane {
        return createEditorPane({ file: Uri.file(ws.writeFile("doc.txt", content)), foldingProviders: providers });
    }

    /** The reload path: the content arrives as a flush, which recomputes at once. */
    function openByReload(content: string): TextEditorPane {
        const ctrl = createEditorPane({ foldingProviders: providers });
        ctrl.openFile(Uri.file(ws.writeFile("doc.txt", content)));
        return ctrl;
    }

    const NESTED = "a\n  b\n    c\nd\n  e"; // regions 0..2, 1..2, 3..4

    it("a freshly opened file has no regions until the delay has passed (not on the path to the first frame)", async () => {
        const ctrl = openAsApp(NESTED);
        expect(spans(ctrl)).toEqual([]);

        // Upstream's default before any measurement: min × 1.5.
        await vi.advanceTimersByTimeAsync(FOLDING_SETTLE_MS - 1);
        expect(spans(ctrl)).toEqual([]);

        await vi.advanceTimersByTimeAsync(1);
        expect(spans(ctrl)).toEqual([
            [0, 2],
            [1, 2],
            [3, 4],
        ]);
    });

    it("a reload (flush) recomputes at once: regions of the old text mean nothing", async () => {
        const ctrl = openAsApp(NESTED);
        await foldsSettled();
        expect(spans(ctrl)).toHaveLength(3);

        ctrl.openFile(Uri.file(ws.writeFile("doc.txt", "x\n  y\nz")));
        expect(spans(ctrl)).toEqual([[0, 1]]);
    });

    it("an edit recomputes after 200 ms of quiet; every edit restarts the wait", async () => {
        // 0: block   ← region 0..1
        // 1:   a
        // 2: tail
        const ctrl = openByReload("block\n  a\ntail");
        expect(spans(ctrl)).toEqual([[0, 1]]);

        ctrl.viewState.selections = [createCursorSelection(2, 0)];
        ctrl.viewState.type(" "); // "tail" starts to nest under the block
        await vi.advanceTimersByTimeAsync(MIN_DELAY_MS - 50);
        expect(spans(ctrl)).toEqual([[0, 1]]); // the old regions, untouched by the keystroke

        ctrl.viewState.type(" ");
        await vi.advanceTimersByTimeAsync(MIN_DELAY_MS - 50);
        expect(spans(ctrl)).toEqual([[0, 1]]); // only 150 ms since the last edit

        await vi.advanceTimersByTimeAsync(50);
        expect(spans(ctrl)).toEqual([[0, 2]]);
    });

    it("the edit cancels the request in flight; its late reply is dropped", async () => {
        const deferred = deferredProvider();
        providers.register("*", deferred.provider);
        const ctrl = openByReload("a\nb\nc\nd");
        expect(deferred.requests).toBe(1);
        expect(deferred.tokens[0].isCancellationRequested).toBe(false);

        ctrl.viewState.selections = [createCursorSelection(0, 0)];
        ctrl.viewState.type("\n"); // the reply would describe the text before this line
        expect(deferred.tokens[0].isCancellationRequested).toBe(true);

        deferred.answer(regionOf([[0, 2]]));
        await foldsSettled();
        expect(deferred.requests).toBe(2); // the recompute after the delay asked again
        expect(spans(ctrl)).toEqual([]); // the stale reply is not on screen

        deferred.answer(regionOf([[1, 3]]));
        await foldsSettled();
        expect(spans(ctrl)).toEqual([[1, 3]]);
    });

    it("with a provider, the file is not walked for indentation folds until the provider replies", async () => {
        const deferred = deferredProvider();
        providers.register("*", deferred.provider);
        const ctrl = openByReload(NESTED);
        deferred.answer([]);
        await foldsSettled();
        expect(spans(ctrl)).toHaveLength(3);

        ctrl.viewState.selections = [createCursorSelection(4, 3)];
        ctrl.viewState.type("!");
        const lines = vi.spyOn(ctrl.viewState.document, "getLineContent");
        await foldsSettled();
        expect(deferred.requests).toBe(2);
        // The request is out; the indentation pass (every line of the file) has not run.
        expect(lines.mock.calls.length).toBeLessThan(ctrl.lineCount);

        deferred.answer(regionOf([[0, 4]]));
        await foldsSettled();
        expect(lines.mock.calls.length).toBeGreaterThanOrEqual(ctrl.lineCount);
        expect(spans(ctrl)).toEqual([
            [0, 4],
            [1, 2],
            [3, 4],
        ]);
    });

    it("the delay grows with a slow provider, as upstream's adaptive debounce", async () => {
        const deferred = deferredProvider();
        providers.register("*", deferred.provider);
        const ctrl = openByReload("a\nb\nc\nd");
        await vi.advanceTimersByTimeAsync(1000); // the provider took a second
        deferred.answer(regionOf([[0, 3]]));
        await foldsSettled();
        expect(spans(ctrl)).toEqual([[0, 3]]);

        ctrl.viewState.selections = [createCursorSelection(3, 1)];
        ctrl.viewState.type("!");
        await vi.advanceTimersByTimeAsync(999);
        expect(deferred.requests).toBe(1); // a second of quiet is required now

        await vi.advanceTimersByTimeAsync(1);
        expect(deferred.requests).toBe(2);
    });

    it("`editor.foldingMaximumRegions` cuts the deepest regions and a change recomputes; the same value does not", async () => {
        const ctrl = openByReload(NESTED);
        expect(spans(ctrl)).toHaveLength(3);

        ctrl.setFoldingMaximumRegions(2);
        expect(spans(ctrl)).toHaveLength(3); // after the delay, like any other recompute
        await foldsSettled();
        expect(spans(ctrl)).toEqual([
            [0, 2],
            [3, 4],
        ]);

        const lines = vi.spyOn(ctrl.viewState.document, "getLineContent");
        ctrl.setFoldingMaximumRegions(2);
        await foldsSettled();
        expect(lines).not.toHaveBeenCalled();
    });

    it("closing the editor drops the scheduled recompute", async () => {
        const deferred = deferredProvider();
        providers.register("*", deferred.provider);
        const ctrl = openAsApp("a\nb\nc\nd");
        ctrl.component.dispose();

        await foldsSettled();
        expect(deferred.requests).toBe(0);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { foldsSettled } from "../../../../../TestUtils/foldingClock.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type { FoldingRangeProvider } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { IFoldingRegion } from "../../../../editor/contrib/folding/iFoldingRegion.ts";

function starts(ctrl: TextEditorPane): number[] {
    return ctrl.viewState.foldedRegions.map((r) => r.startLine).sort((a, b) => a - b);
}

function providerOf(regions: IFoldingRegion[]): FoldingRangeProvider {
    return { provideFoldingRanges: async () => regions.map((r) => ({ ...r })) };
}

describe("EditorComponent – extension folding provider merge", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        vi.useFakeTimers();
        ws = createTempWorkspace({ prefix: "diode-foldprov-" });
    });
    afterEach(() => {
        ws.dispose();
        vi.useRealTimers();
    });

    let providers: LanguageFeatureRegistry<FoldingRangeProvider>;

    function open(content: string): TextEditorPane {
        providers = new LanguageFeatureRegistry<FoldingRangeProvider>();
        const filePath = ws.writeFile("doc.txt", content);
        const ctrl = createEditorPane({ foldingProviders: providers });
        ctrl.openFile(Uri.file(filePath));
        return ctrl;
    }

    it("a provider region appears where there are no indentation folds", async () => {
        // Five unindented lines — indentation folding yields no regions.
        const ctrl = open("a\nb\nc\nd\ne");
        expect(starts(ctrl)).toEqual([]);

        // Registering a provider by itself recomputes the regions of an open document.
        providers.register("*", providerOf([{ startLine: 0, endLine: 3, isCollapsed: false }]));
        await foldsSettled();

        expect(starts(ctrl)).toEqual([0]);
        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.endLine).toBe(3);
    });

    it("union: provider ∪ indentation (both ranges are kept)", async () => {
        // Indentation region 0..2 (header + two indented lines); the provider adds 3..4.
        const ctrl = open("header\n  x\n  y\nfooter\nmore");
        expect(starts(ctrl)).toEqual([0]);

        providers.register("*", providerOf([{ startLine: 3, endLine: 4, isCollapsed: false }]));
        await foldsSettled();

        expect(starts(ctrl)).toEqual([0, 3]);
    });

    it("provider wins on a shared startLine", async () => {
        // Indentation gives 0..2; the provider returns 0..3 on the same line → 0..3 wins.
        const ctrl = open("header\n  x\n  y\nfooter");
        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.endLine).toBe(2);

        providers.register("*", providerOf([{ startLine: 0, endLine: 3, isCollapsed: false }]));
        await foldsSettled();

        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.endLine).toBe(3);
    });

    it("collapsed survives the provider merge by startLine", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        providers.register("*", providerOf([{ startLine: 0, endLine: 3, isCollapsed: false }]));
        await foldsSettled();

        ctrl.viewState.foldRegionContaining(0);
        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.isCollapsed).toBe(true);

        providers.register("*", providerOf([{ startLine: 0, endLine: 3, isCollapsed: false }]));
        await foldsSettled();
        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.isCollapsed).toBe(true);
    });

    it("provider failed/timed out → indentation folds remain (no throw)", async () => {
        const ctrl = open("header\n  x\n  y\nfooter");
        expect(starts(ctrl)).toEqual([0]);

        providers.register("*", {
            provideFoldingRanges: async () => {
                throw new Error("provider boom");
            },
        });
        await foldsSettled();

        expect(starts(ctrl)).toEqual([0]);
    });

    it("a provider for another language is not asked: no ranges arrive", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        let asked = false;
        providers.register("typescript", {
            provideFoldingRanges: () => {
                asked = true;
                return Promise.resolve([{ startLine: 0, endLine: 3, isCollapsed: false }]);
            },
        });
        await foldsSettled();

        expect(asked).toBe(false);
        expect(starts(ctrl)).toEqual([]);
    });

    it("unregistering the provider recomputes ranges: its regions go away", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        const registration = providers.register("*", providerOf([{ startLine: 0, endLine: 3, isCollapsed: false }]));
        await foldsSettled();
        expect(starts(ctrl)).toEqual([0]);

        registration.dispose();
        await foldsSettled();

        expect(starts(ctrl)).toEqual([]);
    });

    it("a late response from an unregistered provider does not bring its ranges back", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        let answer: (regions: IFoldingRegion[]) => void = () => undefined;
        const registration = providers.register("*", {
            provideFoldingRanges: () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        });
        await foldsSettled();

        registration.dispose();
        answer([{ startLine: 0, endLine: 3, isCollapsed: false }]);
        await foldsSettled();

        expect(starts(ctrl)).toEqual([]);
    });

    it("empty provider response → only indentation folds remain", async () => {
        const ctrl = open("header\n  x\n  y\nfooter");
        expect(starts(ctrl)).toEqual([0]);

        providers.register("*", providerOf([]));
        await foldsSettled();

        expect(starts(ctrl)).toEqual([0]);
    });

    it("a response arriving after the editor is closed is not applied", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        let resolve: (regions: IFoldingRegion[]) => void = () => undefined;
        providers.register("*", {
            provideFoldingRanges: () =>
                new Promise((r) => {
                    resolve = r;
                }),
        });

        await foldsSettled();
        ctrl.component.dispose();
        resolve([{ startLine: 0, endLine: 3, isCollapsed: false }]);
        await foldsSettled();

        expect(starts(ctrl)).toEqual([]);
    });

    it("closing the editor cancels the request at the provider too", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        const tokens: ICancellationToken[] = [];
        providers.register("*", {
            provideFoldingRanges: (_request, token) => {
                tokens.push(token);
                return new Promise(() => undefined);
            },
        });
        await foldsSettled();
        // Earlier recomputes are already cancelled by later ones — only the last is live.
        expect(tokens.at(-1)?.isCancellationRequested).toBe(false);

        ctrl.component.dispose();

        expect(tokens.every((token) => token.isCancellationRequested)).toBe(true);
    });

    describe("edit before the provider responds", () => {
        // A multi-line signature, as in Java: by indentation, "first(" is a region of
        // the parameters only (1..2), and the body is its own region at ") {" (3..4);
        // the provider returns the whole method (1..4).
        const source = [
            "class A {",
            "    void first(",
            "        int a",
            "    ) {",
            "        body1();",
            "    }",
            "    void second() {",
            "        body2();",
            "    }",
            "}",
        ].join("\n");
        const methodRegions: IFoldingRegion[] = [
            { startLine: 0, endLine: 8, isCollapsed: false },
            { startLine: 1, endLine: 4, isCollapsed: false },
            { startLine: 6, endLine: 7, isCollapsed: false },
        ];

        /** Replies immediately until `defer` is called; after that, requests wait for `answer`. */
        function registerDeferredProvider(): { defer: () => void; answer: (regions: IFoldingRegion[]) => void } {
            const pending: ((regions: IFoldingRegion[]) => void)[] = [];
            let deferred = false;
            providers.register("*", {
                provideFoldingRanges: () => {
                    if (!deferred) return Promise.resolve(methodRegions.map((r) => ({ ...r })));
                    return new Promise((resolve) => pending.push(resolve));
                },
            });
            return {
                defer: () => {
                    deferred = true;
                },
                answer: (regions) => {
                    for (const resolve of pending.splice(0)) resolve(regions.map((r) => ({ ...r })));
                },
            };
        }

        function frame(ctrl: TextEditorPane): string {
            return renderElement(ctrl.component.view, 40, 12, { themeVars: true }).screenToString();
        }

        it("a folded method with a multi-line signature does not unfold on a keystroke", async () => {
            const ctrl = open(source);
            const provider = registerDeferredProvider();
            await foldsSettled();
            ctrl.viewState.foldRegionContaining(1); // fold the whole of first
            expect(frame(ctrl)).not.toContain("body1");

            provider.defer();
            ctrl.viewState.selections = [createCursorSelection(7, 16)];
            ctrl.viewState.type("!"); // type into the expanded second
            await foldsSettled();

            // The provider is still thinking: the body of first must stay hidden,
            // or the text above the cursor jumps on every keystroke.
            expect(frame(ctrl)).not.toContain("body1");
            expect(frame(ctrl)).toContain("body2();!");

            provider.answer(methodRegions);
            await foldsSettled();

            expect(frame(ctrl)).not.toContain("body1");
            expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 1)).toMatchObject({
                endLine: 4,
                isCollapsed: true,
            });
        });

        it("empty provider response after an edit → indentation folds", async () => {
            const ctrl = open(source);
            const provider = registerDeferredProvider();
            await foldsSettled();
            const methodEnd = (): number | undefined =>
                ctrl.viewState.foldedRegions.find((r) => r.startLine === 1)?.endLine;
            expect(methodEnd()).toBe(4); // the whole method, from the provider

            provider.defer();
            ctrl.viewState.selections = [createCursorSelection(7, 16)];
            ctrl.viewState.type("!");
            await foldsSettled();
            expect(methodEnd()).toBe(4); // until the reply, the previous regions stay

            provider.answer([]);
            await foldsSettled();

            expect(methodEnd()).toBe(2); // the provider has nothing to say — indentation folds apply
        });
    });
});

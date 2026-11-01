import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange, type IRange } from "../../../common/core/iRange.ts";
import { createCursorSelection, createSelection } from "../../../common/core/iSelection.ts";
import { LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import {
    DocumentHighlightKind,
    type DocumentHighlightProvider,
    type IDocumentHighlight,
    type IDocumentHighlightRequest,
    textWordHighlightSet,
} from "../../../common/languages/iDocumentHighlightSource.ts";
import { TextDocument } from "../../../common/model/textDocument.ts";
import { EditorViewState } from "../../../common/viewModel/editorViewState.ts";

import { WordHighlighter } from "./wordHighlighter.ts";

const RUN_DELAY_MS = 50;
const TARGET = { uri: Uri.parse("file:///a.ts"), languageId: "typescript" };
const FOO_1 = createRange(0, 0, 0, 3);
const FOO_2 = createRange(0, 8, 0, 11);
const BAR = createRange(0, 4, 0, 7);

type Answer = readonly IDocumentHighlight[] | null;

interface IFixture {
    readonly viewState: EditorViewState;
    readonly highlighter: WordHighlighter;
    readonly registry: LanguageFeatureRegistry<DocumentHighlightProvider>;
}

function setup(text = "foo bar foo"): IFixture {
    const viewState = new EditorViewState(new TextDocument(text));
    const highlighter = new WordHighlighter(viewState);
    const registry = new LanguageFeatureRegistry<DocumentHighlightProvider>();
    highlighter.setProviders(registry, TARGET);
    return { viewState, highlighter, registry };
}

function answering(answer: Answer | (() => Answer)) {
    return vi.fn((_request: IDocumentHighlightRequest, _token: unknown) =>
        Promise.resolve(typeof answer === "function" ? answer() : answer),
    );
}

/** Whichever frame comes next arms the query; the answer of a resolved provider lands in microtasks. */
async function settle(highlighter: WordHighlighter): Promise<void> {
    highlighter.onFrame();
    await vi.advanceTimersByTimeAsync(RUN_DELAY_MS);
}

function ranges(viewState: EditorViewState): readonly IRange[] {
    return viewState.wordHighlights.ranges;
}

describe("WordHighlighter", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("providers", () => {
        it("the provider decides what is highlighted, not the word's text", async () => {
            const { viewState, highlighter, registry } = setup();
            registry.register("*", { provideDocumentHighlights: answering([{ range: FOO_1 }]) });
            await settle(highlighter);

            expect(ranges(viewState)).toEqual([FOO_1]);
        });

        it("the request names the document, its version and the position under the cursor", async () => {
            const { viewState, highlighter, registry } = setup();
            const provide = answering([]);
            registry.register("*", { provideDocumentHighlights: provide });
            viewState.selections = [createCursorSelection(0, 9)];
            await settle(highlighter);

            expect(provide.mock.calls[0][0]).toEqual({
                uri: TARGET.uri.toString(),
                languageId: "typescript",
                versionId: viewState.document.versionId,
                position: { line: 0, character: 9 },
            });
        });

        it("asks in order until the first answer that is not null", async () => {
            const { viewState, highlighter, registry } = setup();
            const last = answering([{ range: FOO_2 }]);
            const middle = answering([{ range: BAR }]);
            const first = answering(null);
            // Newest first on equal score.
            registry.register("*", { provideDocumentHighlights: last });
            registry.register("*", { provideDocumentHighlights: middle });
            registry.register("*", { provideDocumentHighlights: first });
            await settle(highlighter);

            expect(first).toHaveBeenCalledOnce();
            expect(middle).toHaveBeenCalledOnce();
            expect(last).not.toHaveBeenCalled();
            expect(ranges(viewState)).toEqual([BAR]);
        });

        it("an empty array is an answer: no textual fallback and no next provider", async () => {
            const { viewState, highlighter, registry } = setup();
            const next = answering([{ range: FOO_2 }]);
            registry.register("*", { provideDocumentHighlights: next });
            registry.register("*", { provideDocumentHighlights: answering([]) });
            await settle(highlighter);

            expect(next).not.toHaveBeenCalled();
            expect(ranges(viewState)).toEqual([]);
        });

        it("null from every provider falls back to the textual search, as kind Text", async () => {
            const { viewState, highlighter, registry } = setup();
            registry.register("*", { provideDocumentHighlights: answering(null) });
            await settle(highlighter);

            expect(viewState.wordHighlights.text).toEqual([FOO_1, FOO_2]);
            expect(viewState.wordHighlights.read).toEqual([]);
        });

        it("a failing provider counts as declined", async () => {
            const errors: unknown[] = [];
            setUnexpectedErrorHandler((e) => errors.push(e));
            const { viewState, highlighter, registry } = setup();
            const boom = new Error("boom");
            registry.register("*", { provideDocumentHighlights: () => Promise.reject(boom) });
            await settle(highlighter);

            expect(errors).toEqual([boom]);
            expect(viewState.wordHighlights.text).toEqual([FOO_1, FOO_2]);
        });

        it("without providers the search is synchronous with the timer", () => {
            const { viewState, highlighter } = setup();
            highlighter.onFrame();
            vi.advanceTimersByTime(RUN_DELAY_MS);

            expect(viewState.wordHighlights.text).toEqual([FOO_1, FOO_2]);
        });

        it("without a registry at all the search still works", () => {
            const viewState = new EditorViewState(new TextDocument("foo foo"));
            const highlighter = new WordHighlighter(viewState);
            highlighter.onFrame();
            vi.advanceTimersByTime(RUN_DELAY_MS);

            expect(ranges(viewState)).toHaveLength(2);
        });

        it("splits the answer by kind; Read and no kind share one list", async () => {
            const { viewState, highlighter, registry } = setup("a b c d");
            const [a, b, c, d] = [0, 2, 4, 6].map((at) => createRange(0, at, 0, at + 1));
            registry.register("*", {
                provideDocumentHighlights: answering([
                    { range: a, kind: DocumentHighlightKind.Read },
                    { range: b, kind: DocumentHighlightKind.Write },
                    { range: c, kind: DocumentHighlightKind.Text },
                    { range: d },
                ]),
            });
            await settle(highlighter);

            expect(viewState.wordHighlights).toEqual({ ranges: [a, b, c, d], read: [a, d], write: [b], text: [c] });
        });

        it("sorts the answer: the painters binary-search it", async () => {
            const { viewState, highlighter, registry } = setup();
            registry.register("*", { provideDocumentHighlights: answering([{ range: FOO_2 }, { range: FOO_1 }]) });
            await settle(highlighter);

            expect(ranges(viewState)).toEqual([FOO_1, FOO_2]);
        });

        it("clamps a range past the end of the document", async () => {
            const { viewState, highlighter, registry } = setup();
            registry.register("*", {
                provideDocumentHighlights: answering([{ range: createRange(0, 8, 40, 99) }]),
            });
            await settle(highlighter);

            expect(ranges(viewState)).toEqual([FOO_2]);
        });
    });

    describe("stale answers", () => {
        /** A provider held open: the test resolves it after changing the state under it. */
        function pending(registry: LanguageFeatureRegistry<DocumentHighlightProvider>) {
            let resolve: (answer: Answer) => void = () => undefined;
            const seen: { token?: { isCancellationRequested: boolean } } = {};
            registry.register("*", {
                provideDocumentHighlights: (_request, token) => {
                    seen.token = token;
                    return new Promise<Answer>((r) => {
                        resolve = r;
                    });
                },
            });
            return {
                seen,
                answer: (a: Answer) => {
                    resolve(a);
                },
            };
        }

        it("an edit cancels the request and drops its answer", async () => {
            const { viewState, highlighter, registry } = setup();
            const { seen, answer } = pending(registry);
            await settle(highlighter);
            viewState.document.applyEdits([{ range: createRange(0, 11, 0, 11), text: "!" }]);
            answer([{ range: FOO_1 }]);
            await vi.advanceTimersByTimeAsync(0);

            expect(seen.token?.isCancellationRequested).toBe(true);
            expect(ranges(viewState)).toEqual([]);
        });

        it("an answer for a caret that has moved away is dropped", async () => {
            const { viewState, highlighter, registry } = setup();
            const { answer } = pending(registry);
            await settle(highlighter);
            viewState.selections = [createCursorSelection(0, 5)];
            answer([{ range: FOO_1 }]);
            await vi.advanceTimersByTimeAsync(0);

            expect(ranges(viewState)).toEqual([]);
        });

        it("a newer query cancels the one in flight", async () => {
            const { viewState, highlighter, registry } = setup();
            const { seen } = pending(registry);
            await settle(highlighter);
            const first = seen.token;
            viewState.selections = [createCursorSelection(0, 5)];
            await settle(highlighter);

            expect(first?.isCancellationRequested).toBe(true);
            expect(seen.token).not.toBe(first);
        });

        it("dispose cancels the request and leaves no set behind", async () => {
            const { viewState, highlighter, registry } = setup();
            const { seen, answer } = pending(registry);
            await settle(highlighter);
            highlighter.dispose();
            answer([{ range: FOO_1 }]);
            await vi.advanceTimersByTimeAsync(0);

            expect(seen.token?.isCancellationRequested).toBe(true);
            expect(ranges(viewState)).toEqual([]);
        });

        it("no query runs after dispose", () => {
            const { viewState, highlighter } = setup();
            highlighter.onFrame();
            highlighter.dispose();
            vi.advanceTimersByTime(RUN_DELAY_MS);

            expect(ranges(viewState)).toEqual([]);
        });
    });

    describe("the kept set", () => {
        it("a caret inside the set keeps it without a request", async () => {
            const { viewState, highlighter, registry } = setup();
            const provide = answering([{ range: FOO_1 }, { range: FOO_2 }]);
            registry.register("*", { provideDocumentHighlights: provide });
            await settle(highlighter);
            const set = viewState.wordHighlights;
            viewState.selections = [createCursorSelection(0, 9)];
            await settle(highlighter);

            expect(provide).toHaveBeenCalledOnce();
            expect(viewState.wordHighlights).toBe(set);
        });

        it("a caret on another word of the same file asks again", async () => {
            const { viewState, highlighter, registry } = setup();
            const provide = answering([{ range: FOO_1 }]);
            registry.register("*", { provideDocumentHighlights: provide });
            await settle(highlighter);
            viewState.selections = [createCursorSelection(0, 5)];
            await settle(highlighter);

            expect(provide).toHaveBeenCalledTimes(2);
        });

        it("the old set goes when the new query starts, as upstream `_stopAll`", async () => {
            const { viewState, highlighter, registry } = setup();
            registry.register("*", { provideDocumentHighlights: answering([{ range: FOO_1 }]) });
            await settle(highlighter);
            registry.register("*", { provideDocumentHighlights: () => new Promise(() => undefined) });
            viewState.selections = [createCursorSelection(0, 5)];
            await settle(highlighter);

            expect(ranges(viewState)).toEqual([]);
        });

        it("the set changes without a view event: viewport listeners have nothing to do", async () => {
            const { viewState, highlighter } = setup();
            const view = vi.fn();
            const highlights = vi.fn();
            viewState.onDidChangeView(view);
            viewState.onDidChangeWordHighlights(highlights);
            await settle(highlighter);
            expect(highlights).toHaveBeenCalledOnce();

            viewState.document.applyEdits([{ range: createRange(0, 11, 0, 11), text: "!" }]);
            expect(highlights).toHaveBeenCalledTimes(2);

            view.mockClear();
            viewState.wordHighlights = textWordHighlightSet([FOO_1]);
            expect(view).not.toHaveBeenCalled();
        });

        it("setting the same set again announces nothing", async () => {
            const { viewState, highlighter } = setup();
            await settle(highlighter);
            const highlights = vi.fn();
            viewState.onDidChangeWordHighlights(highlights);
            const same = viewState.wordHighlights;
            viewState.wordHighlights = same;

            expect(highlights).not.toHaveBeenCalled();
        });

        it("an edit drops the set and asks nothing until an explicit move", async () => {
            const { viewState, highlighter, registry } = setup();
            const provide = answering([{ range: FOO_1 }]);
            registry.register("*", { provideDocumentHighlights: provide });
            await settle(highlighter);
            viewState.document.applyEdits([{ range: createRange(0, 11, 0, 11), text: "!" }]);
            expect(ranges(viewState)).toEqual([]);

            await settle(highlighter);
            expect(provide).toHaveBeenCalledOnce();
        });
    });

    describe("the selection", () => {
        it.each([
            ["inside a word", createSelection(0, 5, 0, 6)],
            ["exactly a word", createSelection(0, 4, 0, 7)],
            ["exactly a word, backwards", createSelection(0, 7, 0, 4)],
        ])("%s is highlighted", async (_, selection) => {
            const { viewState, highlighter, registry } = setup();
            const provide = answering([{ range: BAR }]);
            registry.register("*", { provideDocumentHighlights: provide });
            viewState.selections = [selection];
            await settle(highlighter);

            expect(provide.mock.calls[0][0].position).toEqual(selection.active);
            expect(ranges(viewState)).toEqual([BAR]);
        });

        it.each([
            ["wider than a word", createSelection(0, 0, 0, 7)],
            ["reaching out of the word", createSelection(0, 5, 0, 8)],
            ["backwards out of the word", createSelection(0, 8, 0, 5)],
            ["on several lines", createSelection(0, 1, 1, 1)],
        ])("%s asks nothing", async (_, selection) => {
            const { viewState, highlighter, registry } = setup("foo bar foo\nfoo");
            const provide = answering([{ range: FOO_1 }]);
            registry.register("*", { provideDocumentHighlights: provide });
            viewState.selections = [selection];
            await settle(highlighter);

            expect(provide).not.toHaveBeenCalled();
            expect(ranges(viewState)).toEqual([]);
        });

        it("a caret past a document that has just shrunk asks nothing and does not throw", () => {
            const { viewState, highlighter } = setup("foo\nbar");
            viewState.selections = [createCursorSelection(1, 1)];
            viewState.document.applyEdits([{ range: createRange(0, 3, 1, 3), text: "" }]);
            highlighter.onFrame();

            expect(() => {
                vi.advanceTimersByTime(RUN_DELAY_MS);
            }).not.toThrow();
        });

        it("a caret on whitespace asks nothing", async () => {
            const { viewState, highlighter, registry } = setup("foo  foo");
            const provide = answering([{ range: FOO_1 }]);
            registry.register("*", { provideDocumentHighlights: provide });
            viewState.selections = [createCursorSelection(0, 4)];
            await settle(highlighter);

            expect(provide).not.toHaveBeenCalled();
        });

        it("several cursors ask nothing", async () => {
            const { viewState, highlighter, registry } = setup();
            const provide = answering([{ range: FOO_1 }]);
            registry.register("*", { provideDocumentHighlights: provide });
            viewState.selections = [createCursorSelection(0, 0), createCursorSelection(0, 8)];
            await settle(highlighter);

            expect(provide).not.toHaveBeenCalled();
        });

        it("a wide selection takes the set away at once, before any timer", async () => {
            const { viewState, highlighter } = setup();
            await settle(highlighter);
            expect(ranges(viewState)).not.toEqual([]);

            viewState.selections = [createSelection(0, 0, 0, 7)];

            expect(ranges(viewState)).toEqual([]);
        });

        it("switched off, an armed query that fires clears whatever is left", () => {
            const { viewState, highlighter } = setup();
            highlighter.onFrame();
            highlighter.enabled = false;
            vi.advanceTimersByTime(RUN_DELAY_MS);

            expect(ranges(viewState)).toEqual([]);
        });
    });

    describe("editor.occurrencesHighlightDelay", () => {
        it("adds to the 50 ms before the set appears; the request goes out at 50 ms", async () => {
            const { viewState, highlighter, registry } = setup();
            const provide = answering([{ range: FOO_1 }]);
            registry.register("*", { provideDocumentHighlights: provide });
            highlighter.delay = 100;
            highlighter.onFrame();

            await vi.advanceTimersByTimeAsync(RUN_DELAY_MS);
            expect(provide).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(99);
            expect(ranges(viewState)).toEqual([]);

            await vi.advanceTimersByTimeAsync(1);
            expect(ranges(viewState)).toEqual([FOO_1]);
        });

        it("applies to the textual search too", () => {
            const { viewState, highlighter } = setup();
            highlighter.delay = 100;
            highlighter.onFrame();
            vi.advanceTimersByTime(RUN_DELAY_MS + 99);
            expect(ranges(viewState)).toEqual([]);

            vi.advanceTimersByTime(1);
            expect(ranges(viewState)).toEqual([FOO_1, FOO_2]);
        });

        it("a slow provider past the delay is painted as soon as it answers", async () => {
            const { viewState, highlighter, registry } = setup();
            let resolve: (answer: Answer) => void = () => undefined;
            registry.register("*", {
                provideDocumentHighlights: () =>
                    new Promise<Answer>((r) => {
                        resolve = r;
                    }),
            });
            highlighter.delay = 10;
            await settle(highlighter);
            await vi.advanceTimersByTimeAsync(500);
            resolve([{ range: FOO_1 }]);
            await vi.advanceTimersByTimeAsync(0);

            expect(ranges(viewState)).toEqual([FOO_1]);
        });

        it("an edit during the delay cancels the pending render", () => {
            const { viewState, highlighter } = setup();
            highlighter.delay = 100;
            highlighter.onFrame();
            vi.advanceTimersByTime(RUN_DELAY_MS);
            viewState.document.applyEdits([{ range: createRange(0, 11, 0, 11), text: "!" }]);
            vi.advanceTimersByTime(100);

            expect(ranges(viewState)).toEqual([]);
        });
    });

    describe("trigger", () => {
        it("asks right away, without the debounce or the delay", async () => {
            const { viewState, highlighter, registry } = setup();
            registry.register("*", { provideDocumentHighlights: answering([{ range: FOO_1 }]) });
            highlighter.delay = 1000;
            highlighter.trigger();
            await vi.advanceTimersByTimeAsync(0);

            expect(ranges(viewState)).toEqual([FOO_1]);
        });

        it("works with a selection wider than a word, and a frame does not take the set away", async () => {
            const { viewState, highlighter, registry } = setup();
            const provide = answering([{ range: FOO_1 }]);
            registry.register("*", { provideDocumentHighlights: provide });
            const selection = createSelection(0, 0, 0, 7);
            viewState.selections = [selection];
            highlighter.trigger();
            await vi.advanceTimersByTimeAsync(0);
            expect(provide.mock.calls[0][0].position).toEqual(selection.active);
            expect(ranges(viewState)).toEqual([FOO_1]);

            viewState.selections = [selection];
            await settle(highlighter);
            expect(ranges(viewState)).toEqual([FOO_1]);
        });

        it("the forced selection ends with the next change of the selection", async () => {
            const { viewState, highlighter } = setup();
            viewState.selections = [createSelection(0, 0, 0, 7)];
            highlighter.trigger();
            expect(ranges(viewState)).not.toEqual([]);

            viewState.selections = [createSelection(0, 0, 0, 6)];

            expect(ranges(viewState)).toEqual([]);
        });

        it("the forced selection ends with an edit", async () => {
            const { viewState, highlighter } = setup();
            const selection = createSelection(0, 0, 0, 7);
            viewState.selections = [selection];
            highlighter.trigger();
            viewState.document.applyEdits([{ range: createRange(0, 11, 0, 11), text: "!" }]);
            viewState.selections = [selection];
            await settle(highlighter);

            expect(ranges(viewState)).toEqual([]);
        });

        it("asks again even with the caret inside the set", async () => {
            const { highlighter, registry } = setup();
            const provide = answering([{ range: FOO_1 }]);
            registry.register("*", { provideDocumentHighlights: provide });
            await settle(highlighter);
            highlighter.trigger();
            await vi.advanceTimersByTimeAsync(0);

            expect(provide).toHaveBeenCalledTimes(2);
        });

        it("takes over a query already armed", async () => {
            const { highlighter, registry } = setup();
            const provide = answering([{ range: FOO_1 }]);
            registry.register("*", { provideDocumentHighlights: provide });
            highlighter.onFrame();
            highlighter.trigger();
            await vi.advanceTimersByTimeAsync(RUN_DELAY_MS);

            expect(provide).toHaveBeenCalledOnce();
        });

        it("the request it replaced by a frame does not come back", async () => {
            const { highlighter, registry } = setup();
            const provide = answering([{ range: FOO_1 }]);
            registry.register("*", { provideDocumentHighlights: provide });
            // The initial request is still waiting for its frame.
            highlighter.trigger();
            await settle(highlighter);

            expect(provide).toHaveBeenCalledOnce();
        });

        it("does nothing when switched off or with several cursors", () => {
            const off = setup();
            off.highlighter.enabled = false;
            off.highlighter.trigger();
            expect(ranges(off.viewState)).toEqual([]);

            const multi = setup();
            multi.viewState.selections = [createCursorSelection(0, 0), createCursorSelection(0, 8)];
            multi.highlighter.trigger();
            expect(ranges(multi.viewState)).toEqual([]);
        });
    });

    it("reports whether it is enabled", () => {
        const { highlighter } = setup();
        expect(highlighter.enabled).toBe(true);
        highlighter.enabled = false;
        expect(highlighter.enabled).toBe(false);
    });
});

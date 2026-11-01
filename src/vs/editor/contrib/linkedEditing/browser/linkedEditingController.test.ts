import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import type { TextFileModel } from "../../../../workbench/services/textfile/common/textFileModel.ts";
import { createRange, type IRange } from "../../../common/core/iRange.ts";
import { createCursorSelection, createSelection } from "../../../common/core/iSelection.ts";
import { LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type {
    ILinkedEditingRangeRequest,
    LinkedEditingRangeProvider,
} from "../../../common/languages/iLinkedEditingSource.ts";
import { FeatureDebounce } from "../../../common/services/languageFeatureDebounce.ts";

import { LinkedEditingController } from "./linkedEditingController.ts";

// Upstream `linkedEditing.test.ts` by meaning, on a real pane. One difference is on purpose: the mirrored edit and
// the input are one undo step here (upstream's "then undo" cases need two undos for a stop its keyboard path leaves).

const SETTLE_MS = 300;
const LANGUAGE_WORD = /[a-zA-Z]+/;

/** Upstream's mock: every occurrence of the word under the position. */
function wordOccurrences(text: string, line: number, character: number): IRange[] {
    const lines = text.split("\n");
    const word = /[a-zA-Z]+/g;
    let found: string | null = null;
    for (let match = word.exec(lines[line]); match !== null; match = word.exec(lines[line])) {
        if (match.index <= character && character <= match.index + match[0].length) found = match[0];
    }
    if (found === null) return [];
    const ranges: IRange[] = [];
    lines.forEach((content, i) => {
        const all = new RegExp(`\\b${found}\\b`, "g");
        for (let match = all.exec(content); match !== null; match = all.exec(content)) {
            ranges.push(createRange(i, match.index, i, match.index + match[0].length));
        }
    });
    return ranges;
}

interface IHarness {
    readonly pane: TextEditorPane<TextFileModel>;
    readonly controller: LinkedEditingController;
    readonly provide: ReturnType<typeof vi.fn<(request: ILinkedEditingRangeRequest) => void>>;
    readonly registry: LanguageFeatureRegistry<LinkedEditingRangeProvider>;
    setting: boolean;
    text(): string;
    at(line: number, character: number): Promise<void>;
    select(line: number, from: number, to: number): Promise<void>;
    type(text: string): Promise<void>;
    paste(text: string): Promise<void>;
    run(edit: "deleteLeft" | "deleteWordLeft" | "deleteAllLeft"): Promise<void>;
    undo(): void;
    redo(): void;
}

const disposers: (() => void)[] = [];

async function setup(
    initial: string,
    options: { wordPattern?: RegExp; setting?: boolean; languageWord?: RegExp | null } = {},
): Promise<IHarness> {
    const registry = new LanguageFeatureRegistry<LinkedEditingRangeProvider>();
    const pane = createEditorPane();
    const { viewState } = pane;
    viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: initial }]);
    await vi.advanceTimersByTimeAsync(0);
    const provide = vi.fn<(request: ILinkedEditingRangeRequest) => void>();
    registry.register("*", {
        provideLinkedEditingRanges: (request) => {
            provide(request);
            const ranges = wordOccurrences(
                viewState.document.getText(),
                request.position.line,
                request.position.character,
            );
            return Promise.resolve({ ranges, wordPattern: options.wordPattern });
        },
    });
    const harness: IHarness = {
        pane,
        provide,
        registry,
        setting: options.setting ?? true,
        controller: undefined as never,
        text: () => viewState.document.getText(),
        at: async (line, character) => {
            viewState.selections = [createCursorSelection(line, character)];
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
        },
        select: async (line, from, to) => {
            viewState.selections = [createSelection(line, from, line, to)];
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
        },
        type: async (text) => {
            pane.pushUndo(viewState.type(text));
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
        },
        paste: async (text) => {
            pane.pushUndo(viewState.insertText(text));
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
        },
        run: async (edit) => {
            pane.pushUndo(viewState[edit]());
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
        },
        undo: () => {
            pane.undo();
        },
        redo: () => {
            pane.redo();
        },
    };
    const controller = new LinkedEditingController(pane, {
        providers: registry,
        isSettingEnabled: () => harness.setting,
        languageWordPattern: () =>
            options.languageWord === null ? undefined : (options.languageWord ?? LANGUAGE_WORD),
        debounce: new FeatureDebounce(50, 200),
    });
    (harness as { controller: LinkedEditingController }).controller = controller;
    disposers.push(() => {
        controller.dispose();
        pane.dispose();
    });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    return harness;
}

const TAGS = "<ooo></ooo>";

describe("LinkedEditingController", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        for (const dispose of disposers.splice(0)) dispose();
        vi.useRealTimers();
    });

    describe("upstream cases", () => {
        type Step = (h: IHarness) => Promise<void> | void;
        const cases: readonly [string, string, Step[], string, RegExp?][] = [
            ["simple insert - initial", TAGS, [(h) => h.at(0, 1), (h) => h.type("i")], "<iooo></iooo>"],
            ["simple insert - middle", TAGS, [(h) => h.at(0, 2), (h) => h.type("i")], "<oioo></oioo>"],
            ["simple insert - end", TAGS, [(h) => h.at(0, 4), (h) => h.type("i")], "<oooi></oooi>"],
            [
                "simple insert in the closing tag - initial",
                TAGS,
                [(h) => h.at(0, 7), (h) => h.type("i")],
                "<iooo></iooo>",
            ],
            [
                "simple insert in the closing tag - middle",
                TAGS,
                [(h) => h.at(0, 8), (h) => h.type("i")],
                "<oioo></oioo>",
            ],
            ["simple insert in the closing tag - end", TAGS, [(h) => h.at(0, 10), (h) => h.type("i")], "<oooi></oooi>"],
            ["out of boundary, before", TAGS, [(h) => h.at(0, 0), (h) => h.type("i")], "i<ooo></ooo>"],
            ["out of boundary, between", TAGS, [(h) => h.at(0, 5), (h) => h.type("i")], "<ooo>i</ooo>"],
            ["out of boundary, in the slash", TAGS, [(h) => h.at(0, 6), (h) => h.type("i")], "<ooo><i/ooo>"],
            ["out of boundary, after", TAGS, [(h) => h.at(0, 11), (h) => h.type("i")], "<ooo></ooo>i"],
            ["continuous insert", TAGS, [(h) => h.at(0, 1), (h) => h.type("i"), (h) => h.type("i")], "<iiooo></iiooo>"],
            [
                "insert - move - insert",
                TAGS,
                [(h) => h.at(0, 1), (h) => h.type("i"), (h) => h.at(0, 3), (h) => h.type("i")],
                "<ioioo></ioioo>",
            ],
            [
                "insert - move - insert outside region",
                TAGS,
                [(h) => h.at(0, 1), (h) => h.type("i"), (h) => h.at(0, 6), (h) => h.type("i")],
                "<iooo>i</iooo>",
            ],
            [
                "selection insert - simple",
                TAGS,
                [(h) => h.at(0, 1), (h) => h.select(0, 1, 2), (h) => h.type("i")],
                "<ioo></ioo>",
            ],
            [
                "selection insert - whole",
                TAGS,
                [(h) => h.at(0, 1), (h) => h.select(0, 1, 4), (h) => h.type("i")],
                "<i></i>",
            ],
            [
                "selection insert - across boundary",
                TAGS,
                [(h) => h.at(0, 1), (h) => h.select(0, 0, 2), (h) => h.type("i")],
                "ioo></oo>",
            ],
            ["breakout - type space", TAGS, [(h) => h.at(0, 4), (h) => h.type(" ")], "<ooo ></ooo>"],
            [
                "breakout - type space then undo",
                TAGS,
                [
                    (h) => h.at(0, 4),
                    (h) => h.type(" "),
                    (h) => {
                        h.undo();
                    },
                ],
                TAGS,
            ],
            ["breakout - type space in middle", TAGS, [(h) => h.at(0, 3), (h) => h.type(" ")], "<oo o></ooo>"],
            [
                "breakout - paste starting with space",
                TAGS,
                [(h) => h.at(0, 4), (h) => h.paste(' i="i"')],
                '<ooo i="i"></ooo>',
            ],
            [
                "breakout - paste starting with space then undo",
                TAGS,
                [
                    (h) => h.at(0, 4),
                    (h) => h.paste(' i="i"'),
                    (h) => {
                        h.undo();
                    },
                ],
                TAGS,
            ],
            [
                "breakout - paste starting with space in middle",
                TAGS,
                [(h) => h.at(0, 3), (h) => h.paste(" i")],
                "<oo io></ooo>",
            ],
            ["stop pattern - insert", TAGS, [(h) => h.at(0, 1), (h) => h.type("i")], "<iooo></iooo>", /[a-yA-Y]+/],
            [
                "stop pattern - insert stop char",
                TAGS,
                [(h) => h.at(0, 1), (h) => h.type("z")],
                "<zooo></ooo>",
                /[a-yA-Y]+/,
            ],
            ["stop pattern - paste char", TAGS, [(h) => h.at(0, 1), (h) => h.paste("z")], "<zooo></ooo>", /[a-yA-Y]+/],
            [
                "stop pattern - paste string",
                TAGS,
                [(h) => h.at(0, 1), (h) => h.paste("zo")],
                "<zoooo></ooo>",
                /[a-yA-Y]+/,
            ],
            [
                "stop pattern - insert at end",
                TAGS,
                [(h) => h.at(0, 4), (h) => h.type("z")],
                "<oooz></ooo>",
                /[a-yA-Y]+/,
            ],
            [
                "stop pattern - the response's pattern fails",
                TAGS,
                [(h) => h.at(0, 1), (h) => h.type("i")],
                "<iooo></ooo>",
                /[a-eA-E]+/,
            ],
            ["delete - left char", TAGS, [(h) => h.at(0, 4), (h) => h.run("deleteLeft")], "<oo></oo>"],
            [
                "delete - left char then undo",
                TAGS,
                [
                    (h) => h.at(0, 4),
                    (h) => h.run("deleteLeft"),
                    (h) => {
                        h.undo();
                    },
                ],
                TAGS,
            ],
            ["delete - left word", TAGS, [(h) => h.at(0, 4), (h) => h.run("deleteWordLeft")], "<></>"],
            [
                "delete - left word then undo",
                TAGS,
                [
                    (h) => h.at(0, 4),
                    (h) => h.run("deleteWordLeft"),
                    (h) => {
                        h.undo();
                    },
                ],
                TAGS,
            ],
            [
                "delete - left all then undo",
                TAGS,
                [
                    (h) => h.at(0, 4),
                    (h) => h.run("deleteAllLeft"),
                    (h) => {
                        h.undo();
                    },
                ],
                TAGS,
            ],
            [
                "delete - selection",
                TAGS,
                [(h) => h.at(0, 4), (h) => h.select(0, 1, 2), (h) => h.run("deleteLeft")],
                "<oo></oo>",
            ],
            [
                "delete - selection across boundary",
                TAGS,
                [(h) => h.at(0, 2), (h) => h.select(0, 0, 2), (h) => h.run("deleteLeft")],
                "oo></oo>",
            ],
            [
                "undo - one undo takes both tags back",
                TAGS,
                [
                    (h) => h.at(0, 1),
                    (h) => h.type("i"),
                    (h) => {
                        h.undo();
                    },
                ],
                TAGS,
            ],
            [
                "undo/redo - redo brings both tags back",
                TAGS,
                [
                    (h) => h.at(0, 1),
                    (h) => h.type("i"),
                    (h) => {
                        h.undo();
                    },
                    (h) => {
                        h.redo();
                    },
                ],
                "<iooo></iooo>",
            ],
            ["multiline insert", "<ooo>\n</ooo>", [(h) => h.at(0, 1), (h) => h.type("i")], "<iooo>\n</iooo>"],
        ];

        it.each(cases)("%s", async (_name, initial, steps, expected, wordPattern) => {
            const h = await setup(initial, { wordPattern });
            for (const step of steps) {
                await step(h);
                await vi.advanceTimersByTimeAsync(SETTLE_MS);
            }
            expect(h.text()).toBe(expected);
        });
    });

    describe("undo", () => {
        it("the input and the mirror are one step: the stack has nothing older to take", async () => {
            const h = await setup(TAGS);
            await h.at(0, 1);
            await h.type("i");
            expect(h.text()).toBe("<iooo></iooo>");
            h.undo();
            expect(h.text()).toBe(TAGS);
            h.undo();
            expect(h.text()).toBe(TAGS);
            expect(h.pane.viewState.selections[0].active).toEqual({ line: 0, character: 1 });
        });

        it("typing twice is two steps, each with its mirror", async () => {
            const h = await setup(TAGS);
            await h.at(0, 1);
            await h.type("a");
            await h.type("b");
            h.undo();
            expect(h.text()).toBe("<aooo></aooo>");
            h.undo();
            expect(h.text()).toBe(TAGS);
        });
    });

    describe("the caret", () => {
        it("stays in the word when the mirror before it grows", async () => {
            const h = await setup(TAGS);
            await h.at(0, 7);
            await h.type("i");
            expect(h.text()).toBe("<iooo></iooo>");
            expect(h.pane.viewState.selections[0].active).toEqual({ line: 0, character: 9 });
        });
    });

    describe("the ranges on the frame", () => {
        it("are published sorted, whichever one is the reference, and follow the edits", async () => {
            const h = await setup(TAGS);
            await h.at(0, 8);
            expect(h.pane.viewState.linkedEditingRanges).toEqual([createRange(0, 1, 0, 4), createRange(0, 7, 0, 10)]);
            await h.type("i");
            expect(h.pane.viewState.linkedEditingRanges).toEqual([createRange(0, 1, 0, 5), createRange(0, 8, 0, 12)]);
        });

        it("go when the caret leaves them; a new position asks again", async () => {
            const h = await setup("<ooo></ooo> aaa");
            await h.at(0, 1);
            expect(h.pane.viewState.linkedEditingRanges).toHaveLength(2);
            await h.at(0, 13);
            expect(h.pane.viewState.linkedEditingRanges).toEqual([createRange(0, 12, 0, 15)]);
            await h.at(0, 5);
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
        });

        it("a move inside the reference does not ask the provider again", async () => {
            const h = await setup(TAGS);
            await h.at(0, 1);
            h.provide.mockClear();
            await h.at(0, 2);
            await h.at(0, 3);
            expect(h.provide).not.toHaveBeenCalled();
            expect(h.pane.viewState.linkedEditingRanges).toHaveLength(2);
        });

        it("go when a break-out ends the link", async () => {
            const h = await setup(TAGS);
            await h.at(0, 3);
            await h.type(" ");
            expect(h.text()).toBe("<oo o></ooo>");
            // The caret now touches the word `o`, which has no mirror: the old pair is gone, the closing tag with it.
            expect(h.pane.viewState.linkedEditingRanges).toEqual([createRange(0, 4, 0, 5)]);
        });

        it("go on dispose, and the decorations with them", async () => {
            const h = await setup(TAGS);
            await h.at(0, 1);
            h.controller.dispose();
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
            await h.type("i");
            expect(h.text()).toBe("<iooo></ooo>");
        });
    });

    describe("requests", () => {
        it("carry the uri, the language, the version and the position", async () => {
            const h = await setup(TAGS);
            await h.at(0, 2);
            expect(h.provide).toHaveBeenLastCalledWith({
                uri: h.pane.uri.toString(),
                languageId: h.pane.languageId,
                versionId: h.pane.viewState.document.versionId,
                position: { line: 0, character: 2 },
            });
        });

        it("the cursor move waits for the debounce: a provider answering at once brings it down to the minimum", async () => {
            const h = await setup("<ooo></ooo> aaa");
            h.provide.mockClear();
            h.pane.viewState.selections = [createCursorSelection(0, 13)];
            await vi.advanceTimersByTimeAsync(49);
            expect(h.provide).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(h.provide).toHaveBeenCalledTimes(1);
        });

        it("an answer for an older version is dropped", async () => {
            const h = await setup(TAGS);
            let answer: (value: { ranges: IRange[] }) => void = () => undefined;
            const slow = new LanguageFeatureRegistry<LinkedEditingRangeProvider>();
            slow.register("*", {
                provideLinkedEditingRanges: () =>
                    new Promise((resolve) => {
                        answer = resolve;
                    }),
            });
            const controller = new LinkedEditingController(h.pane, {
                providers: slow,
                isSettingEnabled: () => true,
                languageWordPattern: () => undefined,
                debounce: new FeatureDebounce(50, 200),
            });
            disposers.unshift(() => {
                controller.dispose();
            });
            h.controller.dispose();
            await vi.advanceTimersByTimeAsync(0);
            h.pane.viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: "x" }]);
            answer({ ranges: [createRange(0, 0, 0, 1)] });
            await vi.advanceTimersByTimeAsync(0);
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
        });

        it("a provider declining or empty or failing passes to the next", async () => {
            const errors: unknown[] = [];
            setUnexpectedErrorHandler((e) => errors.push(e));
            const boom = new Error("boom");
            const h = await setup(TAGS, { setting: false });
            const chain = new LanguageFeatureRegistry<LinkedEditingRangeProvider>();
            chain.register("*", {
                provideLinkedEditingRanges: () => Promise.resolve({ ranges: [createRange(0, 1, 0, 4)] }),
            });
            chain.register("*", { provideLinkedEditingRanges: () => Promise.reject(boom) });
            chain.register("*", { provideLinkedEditingRanges: () => Promise.resolve({ ranges: [] }) });
            chain.register("*", { provideLinkedEditingRanges: () => Promise.resolve(null) });
            const controller = new LinkedEditingController(h.pane, {
                providers: chain,
                isSettingEnabled: () => true,
                languageWordPattern: () => undefined,
                debounce: new FeatureDebounce(50, 200),
            });
            disposers.unshift(() => {
                controller.dispose();
            });
            await h.at(0, 2);
            expect(h.pane.viewState.linkedEditingRanges).toEqual([createRange(0, 1, 0, 4)]);
            expect(new Set(errors)).toEqual(new Set([boom]));
        });

        it("ranges away from the caret are no link", async () => {
            const h = await setup(TAGS, { setting: false });
            const away = new LanguageFeatureRegistry<LinkedEditingRangeProvider>();
            away.register("*", {
                provideLinkedEditingRanges: () => Promise.resolve({ ranges: [createRange(0, 7, 0, 10)] }),
            });
            const controller = new LinkedEditingController(h.pane, {
                providers: away,
                isSettingEnabled: () => true,
                languageWordPattern: () => undefined,
                debounce: new FeatureDebounce(50, 200),
            });
            disposers.unshift(() => {
                controller.dispose();
            });
            await h.at(0, 2);
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
        });
    });

    describe("the mirror edit", () => {
        it("replaces only what differs, under its label", async () => {
            const h = await setup("<abcd></abcd>");
            const apply = vi.spyOn(h.pane, "applyEditsIntoLastUndoStep");
            await h.at(0, 3);
            await h.type("x");
            expect(apply.mock.calls).toEqual([[[{ range: createRange(0, 11, 0, 11), text: "x" }], "linkedEditing"]]);
            apply.mockClear();
            await h.run("deleteLeft");
            expect(apply.mock.calls).toEqual([[[{ range: createRange(0, 10, 0, 11), text: "" }], "linkedEditing"]]);
        });

        it("a replaced middle keeps the common prefix and suffix", async () => {
            const h = await setup("<abcd></abcd>");
            const apply = vi.spyOn(h.pane, "applyEditsIntoLastUndoStep");
            await h.at(0, 2);
            await h.select(0, 2, 4);
            await h.type("xyz");
            expect(h.text()).toBe("<axyzd></axyzd>");
            expect(apply.mock.calls[0][0]).toEqual([{ range: createRange(0, 10, 0, 12), text: "xyz" }]);
        });

        it("texts already equal: nothing is applied", async () => {
            const h = await setup(TAGS);
            const apply = vi.spyOn(h.pane, "applyEditsIntoLastUndoStep");
            await h.at(0, 1);
            h.pane.viewState.document.applyEdits([{ range: createRange(0, 1, 0, 2), text: "o" }]);
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            expect(apply).not.toHaveBeenCalled();
        });

        it("a mirror over several lines is replaced whole", async () => {
            const h = await setup("<aa>\nb\nc");
            const providers = new LanguageFeatureRegistry<LinkedEditingRangeProvider>();
            providers.register("*", {
                provideLinkedEditingRanges: () =>
                    Promise.resolve({ ranges: [createRange(0, 1, 0, 3), createRange(1, 0, 2, 1)] }),
            });
            h.controller.dispose();
            const controller = new LinkedEditingController(h.pane, {
                providers,
                isSettingEnabled: () => true,
                languageWordPattern: () => undefined,
                debounce: new FeatureDebounce(50, 200),
            });
            disposers.unshift(() => {
                controller.dispose();
            });
            await h.at(0, 2);
            await h.type("x");
            expect(h.text()).toBe("<axa>\naxa");
        });
    });

    describe("edits that are not the reference's", () => {
        it("an edit in the mirror is not overwritten from the reference", async () => {
            const h = await setup(TAGS);
            await h.at(0, 1);
            h.pane.viewState.document.applyEdits([{ range: createRange(0, 8, 0, 8), text: "x" }]);
            await vi.advanceTimersByTimeAsync(0);
            expect(h.text()).toBe("<ooo></oxoo>");
        });

        it("a batch with one change outside the reference does not sync", async () => {
            const h = await setup("<ooo></ooo> a");
            await h.at(0, 1);
            h.pane.viewState.document.applyEdits([
                { range: createRange(0, 2, 0, 2), text: "x" },
                { range: createRange(0, 12, 0, 12), text: "y" },
            ]);
            await vi.advanceTimersByTimeAsync(0);
            expect(h.text()).toBe("<oxoo></ooo> ya");
        });

        it("a reload does not sync, and the next query decides", async () => {
            const h = await setup(TAGS);
            await h.at(0, 1);
            const apply = vi.spyOn(h.pane, "applyEditsIntoLastUndoStep");
            h.provide.mockClear();
            h.pane.viewState.document.setText("<aaa></bbb>");
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            expect(apply).not.toHaveBeenCalled();
            expect(h.provide).toHaveBeenCalled();
            expect(h.text()).toBe("<aaa></bbb>");
        });
    });

    describe("late and superseded answers", () => {
        function deferred(h: IHarness, askedAfter?: LinkedEditingRangeProvider) {
            const answers: ((value: { ranges: IRange[] } | null) => void)[] = [];
            const asked = vi.fn();
            const providers = new LanguageFeatureRegistry<LinkedEditingRangeProvider>();
            // Among equal scores the later registration is asked first.
            if (askedAfter !== undefined) providers.register("*", askedAfter);
            providers.register("*", {
                provideLinkedEditingRanges: () => {
                    asked();
                    return new Promise((resolve) => {
                        answers.push(resolve);
                    });
                },
            });
            h.controller.dispose();
            const controller = new LinkedEditingController(h.pane, {
                providers,
                isSettingEnabled: () => true,
                languageWordPattern: () => undefined,
                debounce: new FeatureDebounce(50, 200),
            });
            disposers.unshift(() => {
                controller.dispose();
            });
            return { answers, asked, controller, providers };
        }

        it("a superseded answer is dropped, the newest one counts", async () => {
            const h = await setup("<ooo></ooo> aaa");
            const { answers } = deferred(h);
            await vi.advanceTimersByTimeAsync(0);
            await h.at(0, 1);
            await h.at(0, 13);
            const newest = createRange(0, 12, 0, 15);
            answers.at(-1)?.({ ranges: [newest] });
            await vi.advanceTimersByTimeAsync(0);
            expect(h.pane.viewState.linkedEditingRanges).toEqual([newest]);
            answers[answers.length - 2]({ ranges: [createRange(0, 1, 0, 4)] });
            await vi.advanceTimersByTimeAsync(0);
            expect(h.pane.viewState.linkedEditingRanges).toEqual([newest]);
        });

        it("an answer after Escape is dropped, and the cancelled walk asks nobody else", async () => {
            const h = await setup(TAGS);
            const next = vi.fn(() => Promise.resolve(null));
            const { answers, controller } = deferred(h, { provideLinkedEditingRanges: next });
            await vi.advanceTimersByTimeAsync(0);
            controller.clearRanges();
            for (const answer of answers) answer(null);
            await vi.advanceTimersByTimeAsync(0);
            next.mockClear();
            answers.length = 0;
            h.pane.viewState.selections = [createCursorSelection(0, 2)];
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            controller.clearRanges();
            for (const answer of answers) answer(null);
            await vi.advanceTimersByTimeAsync(0);
            expect(next).not.toHaveBeenCalled();
            answers.length = 0;
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
        });
    });

    describe("asking again", () => {
        it("the same position and version are not asked twice", async () => {
            const h = await setup(TAGS);
            await h.at(0, 1);
            h.provide.mockClear();
            await h.controller.updateRanges();
            expect(h.provide).not.toHaveBeenCalled();
        });

        it("a move at the same version with no ranges asks again, without an error", async () => {
            const h = await setup("<ooo> <ooo>");
            await h.at(0, 5);
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
            h.provide.mockClear();
            await h.at(0, 6);
            expect(h.provide).toHaveBeenCalledTimes(1);
        });

        it("an edit away from the caret asks again at the same position", async () => {
            const h = await setup("<ooo></ooo> a");
            await h.at(0, 1);
            h.provide.mockClear();
            h.pane.viewState.document.applyEdits([{ range: createRange(0, 13, 0, 13), text: "y" }]);
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            expect(h.provide).toHaveBeenCalledTimes(1);
        });

        it("the answer no longer holding the caret, or declining, ends the link", async () => {
            const h = await setup("<ooo></ooo> a");
            const answers: ({ ranges: IRange[] } | null)[] = [{ ranges: [createRange(0, 7, 0, 10)] }, null];
            const providers = new LanguageFeatureRegistry<LinkedEditingRangeProvider>();
            let current: { ranges: IRange[] } | null = { ranges: [createRange(0, 1, 0, 4), createRange(0, 7, 0, 10)] };
            providers.register("*", { provideLinkedEditingRanges: () => Promise.resolve(current) });
            h.controller.dispose();
            const controller = new LinkedEditingController(h.pane, {
                providers,
                isSettingEnabled: () => true,
                languageWordPattern: () => undefined,
                debounce: new FeatureDebounce(50, 200),
            });
            disposers.unshift(() => {
                controller.dispose();
            });
            for (const answer of answers) {
                current = { ranges: [createRange(0, 1, 0, 4), createRange(0, 7, 0, 10)] };
                await h.at(0, 2);
                await controller.updateRanges(true);
                expect(h.pane.viewState.linkedEditingRanges).toHaveLength(2);
                current = answer;
                h.pane.viewState.document.applyEdits([{ range: createRange(0, 13, 0, 13), text: "y" }]);
                await vi.advanceTimersByTimeAsync(SETTLE_MS);
                expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
            }
        });

        it("a pending query does not outlive dispose", async () => {
            const h = await setup("<ooo></ooo> aaa");
            h.provide.mockClear();
            h.pane.viewState.selections = [createCursorSelection(0, 13)];
            h.controller.dispose();
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            expect(h.provide).not.toHaveBeenCalled();
        });

        it("clearing with nothing on the frame does not repaint", async () => {
            const h = await setup(TAGS, { setting: false });
            const repaint = vi.fn();
            h.pane.viewState.onDidChangeLinkedEditingRanges(repaint);
            h.controller.clearRanges();
            expect(repaint).not.toHaveBeenCalled();
        });
    });

    describe("what ends the link", () => {
        it("several cursors", async () => {
            const h = await setup(TAGS);
            await h.at(0, 1);
            h.pane.viewState.selections = [createCursorSelection(0, 1), createCursorSelection(0, 8)];
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
        });

        it("a multi-line reference", async () => {
            const h = await setup(TAGS);
            await h.at(0, 2);
            await h.paste("a\nb");
            expect(h.text()).toBe("<oa\nboo></ooo>");
        });

        it("Escape: the ranges go and typing is not mirrored", async () => {
            const h = await setup(TAGS);
            await h.at(0, 1);
            h.controller.clearRanges();
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
            h.pane.pushUndo(h.pane.viewState.type("i"));
            await vi.advanceTimersByTimeAsync(0);
            expect(h.text()).toBe("<iooo></ooo>");
        });

        it("an edit outside the reference asks again and mirrors nothing", async () => {
            const h = await setup(TAGS);
            await h.at(0, 1);
            h.pane.viewState.document.applyEdits([{ range: createRange(0, 5, 0, 5), text: "x" }]);
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            expect(h.text()).toBe("<ooo>x</ooo>");
            expect(h.pane.viewState.linkedEditingRanges).toEqual([createRange(0, 1, 0, 4), createRange(0, 8, 0, 11)]);
        });

        it("without a language pattern the default word decides", async () => {
            const h = await setup(TAGS, { languageWord: null });
            await h.at(0, 1);
            await h.type("1");
            expect(h.text()).toBe("<1ooo></1ooo>");
            await h.type("/");
            expect(h.text()).toBe("<1/ooo></1ooo>");
        });
    });

    describe("the setting and the command", () => {
        it("off: nothing is asked and nothing mirrored", async () => {
            const h = await setup(TAGS, { setting: false });
            await h.at(0, 1);
            await h.type("i");
            expect(h.provide).not.toHaveBeenCalled();
            expect(h.text()).toBe("<iooo></ooo>");
        });

        it("on without a provider for the document: nothing is asked", async () => {
            const h = await setup(TAGS);
            const other = new LanguageFeatureRegistry<LinkedEditingRangeProvider>();
            const provide = vi.fn(() => Promise.resolve(null));
            other.register({ language: "no-such-language" }, { provideLinkedEditingRanges: provide });
            h.controller.dispose();
            const controller = new LinkedEditingController(h.pane, {
                providers: other,
                isSettingEnabled: () => true,
                languageWordPattern: () => undefined,
                debounce: new FeatureDebounce(50, 200),
            });
            disposers.unshift(() => {
                controller.dispose();
            });
            await h.at(0, 1);
            expect(provide).not.toHaveBeenCalled();
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
        });

        it("switched on: the ranges come without a cursor move; switched off: they go", async () => {
            const h = await setup(TAGS, { setting: false });
            h.pane.viewState.selections = [createCursorSelection(0, 1)];
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            h.setting = true;
            h.controller.reinitialize(false);
            await vi.advanceTimersByTimeAsync(0);
            expect(h.pane.viewState.linkedEditingRanges).toHaveLength(2);
            h.setting = false;
            h.controller.reinitialize(false);
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
        });

        it("reinitialize without a change keeps the ranges; a forced one asks anew", async () => {
            const h = await setup(TAGS);
            await h.at(0, 1);
            h.provide.mockClear();
            h.controller.reinitialize(false);
            expect(h.pane.viewState.linkedEditingRanges).toHaveLength(2);
            expect(h.provide).not.toHaveBeenCalled();
            h.controller.reinitialize(true);
            await vi.advanceTimersByTimeAsync(0);
            expect(h.provide).toHaveBeenCalledTimes(1);
        });

        it("the command with the setting off links, mirrors, and survives typing", async () => {
            const h = await setup(TAGS, { setting: false });
            h.pane.viewState.selections = [createCursorSelection(0, 1)];
            await h.controller.updateRanges(true);
            await vi.advanceTimersByTimeAsync(0);
            expect(h.pane.viewState.linkedEditingRanges).toHaveLength(2);
            await h.type("a");
            await h.type("b");
            expect(h.text()).toBe("<abooo></abooo>");
            h.undo();
            expect(h.text()).toBe("<aooo></aooo>");
        });

        it("the session of the command ends when the caret leaves, and nothing asks again", async () => {
            const h = await setup("<ooo></ooo> aaa", { setting: false });
            h.pane.viewState.selections = [createCursorSelection(0, 1)];
            await h.controller.updateRanges(true);
            await vi.advanceTimersByTimeAsync(0);
            h.provide.mockClear();
            await h.at(0, 13);
            expect(h.provide).not.toHaveBeenCalled();
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
            await h.at(0, 1);
            expect(h.provide).not.toHaveBeenCalled();
        });

        it("the session of the command ends with Escape", async () => {
            const h = await setup(TAGS, { setting: false });
            h.pane.viewState.selections = [createCursorSelection(0, 1)];
            await h.controller.updateRanges(true);
            await vi.advanceTimersByTimeAsync(0);
            h.controller.clearRanges();
            await h.type("i");
            expect(h.text()).toBe("<iooo></ooo>");
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
        });

        it("the command at a place without ranges ends the session at once", async () => {
            const h = await setup("<ooo> </ooo>", { setting: false });
            h.pane.viewState.selections = [createCursorSelection(0, 5)];
            await h.controller.updateRanges(true);
            await vi.advanceTimersByTimeAsync(0);
            expect(h.pane.viewState.linkedEditingRanges).toEqual([]);
            h.provide.mockClear();
            await h.at(0, 1);
            expect(h.provide).not.toHaveBeenCalled();
        });
    });
});

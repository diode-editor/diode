import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { renderCodicons } from "../../../../base/common/codicons.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../common/core/iRange.ts";
import { LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type {
    CodeLens,
    CodeLensCommand,
    CodeLensList,
    CodeLensProvider,
    ICodeLensZone,
} from "../../../common/languages/iCodeLensSource.ts";
import { TextDocument } from "../../../common/model/textDocument.ts";

import { CodeLensController, type ICodeLensOptions } from "./codeLensController.ts";

/** Past any debounce a test here can grow. */
const SETTLE_MS = 70_000;

function command(title: string): CodeLensCommand {
    return { id: `cmd.${title}`, title };
}

function rangeAt(line: number, character = 0): IRange {
    return { start: { line, character }, end: { line, character: character + 1 } };
}

function lens(line: number, cmd?: CodeLensCommand, character = 0): CodeLens {
    return { range: rangeAt(line, character), command: cmd };
}

function list(lenses: readonly CodeLens[], dispose: () => void = () => undefined): CodeLensList {
    return { lenses, dispose };
}

function answering(lenses: readonly CodeLens[], rest: Partial<CodeLensProvider> = {}): CodeLensProvider {
    return { provideCodeLenses: () => list(lenses), ...rest };
}

/** A provide or resolve that answers when told to. */
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

let uniqueUri = 0;

describe("CodeLensController", () => {
    let providers: LanguageFeatureRegistry<CodeLensProvider>;
    let unexpected: unknown[];
    let disposables: (() => void)[];

    beforeEach(() => {
        vi.useFakeTimers();
        providers = new LanguageFeatureRegistry();
        unexpected = [];
        disposables = [];
        setUnexpectedErrorHandler((e) => {
            unexpected.push(e);
        });
    });

    afterEach(() => {
        for (const dispose of disposables) dispose();
        vi.useRealTimers();
        setUnexpectedErrorHandler(() => undefined);
    });

    function setup(text = "l0\nl1\nl2\nl3\nl4\nl5", options: ICodeLensOptions = { enabled: true, nerdFont: false }) {
        const document = new TextDocument(text);
        const language = new Emitter<unknown>();
        const visibleRange = new Emitter<void>();
        const visible = { startLine: 0, endLine: document.lineCount - 1 };
        const published: (readonly ICodeLensZone[])[] = [];
        const controller = new CodeLensController(
            {
                document,
                uri: Uri.file(`/code-lens-${String(uniqueUri++)}.ts`),
                languageId: "typescript",
                onDidChangeLanguage: language.event,
            },
            { getVisibleLineRange: () => visible, onDidChangeVisibleRange: visibleRange.event },
            providers,
            options,
            (zones) => {
                published.push(zones);
            },
        );
        disposables.push(() => {
            controller.dispose();
        });
        const edit = (range: IRange, newText: string): void => {
            document.applyEdits([{ range, text: newText }]);
        };
        const insert = (line: number, newText: string): void => {
            edit({ start: { line, character: 0 }, end: { line, character: 0 } }, newText);
        };
        return {
            document,
            language,
            visibleRange,
            visible,
            published,
            controller,
            edit,
            insert,
            zones: () => published.at(-1) ?? [],
            settle: () => vi.advanceTimersByTimeAsync(SETTLE_MS),
        };
    }

    describe("the zones", () => {
        it("come sorted by line, each with the text and the clickable part of every title", async () => {
            const a = command("a");
            const b = command("b");
            providers.register("*", answering([lens(5, a), lens(1, b), lens(3, a), lens(3, b, 1)]));
            const { zones, settle } = setup();
            await settle();
            expect(zones()).toEqual([
                { line: 1, text: "b", actions: [{ start: 0, end: 1, command: b }] },
                {
                    line: 3,
                    text: "a | b",
                    actions: [
                        { start: 0, end: 1, command: a },
                        { start: 4, end: 5, command: b },
                    ],
                },
                { line: 5, text: "a", actions: [{ start: 0, end: 1, command: a }] },
            ]);
        });

        it("a line goes by provider rank, then column", async () => {
            providers.register("*", answering([lens(1, command("o2"), 1), lens(1, command("o1"), 0)]));
            providers.register("*", answering([lens(1, command("late"), 5), lens(1, command("early"), 1)]));
            const { zones, settle } = setup();
            await settle();
            expect(zones()[0].text).toBe("early | late | o1 | o2");
        });

        it("an empty title between two takes no place and no separator", async () => {
            providers.register(
                "*",
                answering([lens(0, command("a"), 0), lens(0, command(""), 1), lens(0, command("b"), 2)]),
            );
            const { zones, settle } = setup();
            await settle();
            expect(zones()[0].text).toBe("a | b");
            expect(zones()[0].actions).toHaveLength(2);
        });

        it("a title is one trimmed line", async () => {
            providers.register("*", answering([lens(0, command("  a\tb\nc\r  "))]));
            const { zones, settle } = setup();
            await settle();
            expect(zones()[0].text).toBe("a b c");
        });

        it("a line whose every lens failed says 'no commands' and has nothing to click", async () => {
            providers.register("*", answering([lens(0)], { resolveCodeLens: () => null }));
            const { zones, settle } = setup();
            await settle();
            expect(zones()).toEqual([{ line: 0, text: "no commands", actions: [] }]);
        });

        it("a resolve answering undefined counts as failed", async () => {
            providers.register("*", answering([lens(0)], { resolveCodeLens: () => undefined }));
            const { zones, settle } = setup();
            await settle();
            expect(zones()[0].text).toBe("no commands");
        });

        it("a range past the document is clamped into it, the character to its line", async () => {
            providers.register("*", answering([{ range: rangeAt(99, 99), command: command("t") }]));
            const { document, settle } = setup("l0\nl1");
            const delta = vi.spyOn(document, "deltaDecorations");
            await settle();
            const [[, decorations]] = delta.mock.calls.filter(([, added]) => added.length > 0);
            expect(decorations[0].range.start).toEqual({ line: 1, character: 2 });
        });
    });

    describe("the options", () => {
        it("the glyph set repaints the titles without asking the providers", async () => {
            const provideCodeLenses = vi.fn(() => list([lens(0, command("$(play)"))]));
            providers.register("*", { provideCodeLenses });
            const { controller, zones, settle } = setup();
            await settle();
            expect(zones()[0].text).toBe(renderCodicons("$(play)", false));

            controller.setOptions({ enabled: true, nerdFont: true });
            expect(zones()[0].text).toBe(renderCodicons("$(play)", true));
            await settle();
            expect(provideCodeLenses).toHaveBeenCalledOnce();
        });

        it("the same options do nothing", async () => {
            const provideCodeLenses = vi.fn(() => list([lens(0, command("t"))]));
            providers.register("*", { provideCodeLenses });
            const { controller, published, settle } = setup();
            await settle();
            const count = published.length;
            controller.setOptions({ enabled: true, nerdFont: false });
            await settle();
            expect(published).toHaveLength(count);
            expect(provideCodeLenses).toHaveBeenCalledOnce();
        });

        it("off from the start asks nobody", async () => {
            const provideCodeLenses = vi.fn(() => list([]));
            providers.register("*", { provideCodeLenses });
            const { settle } = setup(undefined, { enabled: false, nerdFont: false });
            await settle();
            expect(provideCodeLenses).not.toHaveBeenCalled();
        });

        it("turning off before the debounce ends: the providers are not asked", async () => {
            const provideCodeLenses = vi.fn(() => list([]));
            providers.register("*", { provideCodeLenses });
            const { controller, settle } = setup();
            controller.setOptions({ enabled: false, nerdFont: false });
            await settle();
            expect(provideCodeLenses).not.toHaveBeenCalled();
        });

        it("turning off with a resolve due: it does not go out", async () => {
            const resolveCodeLens = vi.fn(() => null);
            providers.register("*", answering([lens(0)], { resolveCodeLens }));
            const { controller } = setup();
            // The provide is over, the resolve's debounce is running.
            await vi.advanceTimersByTimeAsync(380);
            expect(resolveCodeLens).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(1);
            controller.setOptions({ enabled: false, nerdFont: false });
            expect(vi.getTimerCount()).toBe(0);
        });

        it("turning off cancels the provide in flight, and its late answer shows nothing", async () => {
            const answer = deferred<CodeLensList>();
            let token: ICancellationToken | undefined;
            providers.register("*", {
                provideCodeLenses: (_model, t) => {
                    token = t;
                    return answer.promise;
                },
            });
            const { controller, zones, settle } = setup();
            await settle();
            controller.setOptions({ enabled: false, nerdFont: false });
            expect(token?.isCancellationRequested).toBe(true);
            const dispose = vi.fn();
            answer.resolve(list([lens(0, command("late"))], dispose));
            await settle();
            expect(zones()).toEqual([]);
            expect(dispose).toHaveBeenCalledOnce();
        });

        it("off, an edit and the provider's own change ask nobody", async () => {
            const changed = new Emitter<void>();
            const provideCodeLenses = vi.fn(() => list([]));
            providers.register("*", { provideCodeLenses, onDidChange: changed.event });
            const { controller, insert, settle } = setup();
            await settle();
            controller.setOptions({ enabled: false, nerdFont: false });
            insert(0, "x");
            changed.fire();
            await settle();
            expect(provideCodeLenses).toHaveBeenCalledOnce();
        });
    });

    describe("the language", () => {
        it("a change drops the lenses at once and asks again", async () => {
            const provideCodeLenses = vi.fn(() => list([lens(0, command("t"))]));
            providers.register("*", { provideCodeLenses });
            const { language, zones, settle } = setup();
            await settle();
            expect(zones()).toHaveLength(1);
            language.fire(undefined);
            expect(zones()).toEqual([]);
            await settle();
            expect(provideCodeLenses).toHaveBeenCalledTimes(2);
            expect(zones()).toHaveLength(1);
        });
    });

    describe("the answers", () => {
        it("a provider answering null or undefined is no list to dispose", async () => {
            providers.register("*", { provideCodeLenses: () => null });
            providers.register("*", { provideCodeLenses: () => undefined });
            const { controller, settle } = setup();
            await settle();
            controller.dispose();
            expect(unexpected).toEqual([]);
        });

        it("a list failing to dispose is reported and costs the others nothing", async () => {
            const boom = new Error("boom");
            const dispose = vi.fn();
            providers.register("*", {
                provideCodeLenses: () =>
                    list([], () => {
                        throw boom;
                    }),
            });
            providers.register("*", { provideCodeLenses: () => list([], dispose) });
            const { controller, settle } = setup();
            await settle();
            controller.dispose();
            expect(unexpected).toEqual([boom]);
            expect(dispose).toHaveBeenCalledOnce();
        });

        it("the next answer takes the decorations of the previous one away", async () => {
            const changed = new Emitter<void>();
            providers.register("*", answering([lens(0, command("t"))], { onDidChange: changed.event }));
            const { document, settle } = setup();
            const delta = vi.spyOn(document, "deltaDecorations");
            await settle();
            const [first] = delta.mock.results.at(-1)?.value as string[];
            expect(document.getDecorationRange(first)).not.toBeNull();
            changed.fire();
            await settle();
            expect(document.getDecorationRange(first)).toBeNull();
        });
    });

    describe("an edit", () => {
        it("cancels the provide in flight; its late answer is disposed and not shown", async () => {
            const answer = deferred<CodeLensList>();
            let token: ICancellationToken | undefined;
            const provideCodeLenses = vi.fn((_model: unknown, t: ICancellationToken) => {
                token ??= t;
                return answer.promise;
            });
            providers.register("*", { provideCodeLenses });
            const { insert, zones, settle } = setup();
            await settle();
            insert(0, "x");
            expect(token?.isCancellationRequested).toBe(true);
            const dispose = vi.fn();
            answer.resolve(list([lens(0, command("stale"))], dispose));
            await vi.advanceTimersByTimeAsync(0);
            expect(zones()).toEqual([]);
            expect(dispose).toHaveBeenCalledOnce();
        });

        it("asks the providers again", async () => {
            const provideCodeLenses = vi.fn(() => list([]));
            providers.register("*", { provideCodeLenses });
            const { insert, settle } = setup();
            await settle();
            insert(0, "x");
            await settle();
            expect(provideCodeLenses).toHaveBeenCalledTimes(2);
        });

        it("called off the resolve that was due: the lens has moved under it", async () => {
            const resolveCodeLens = vi.fn(() => null);
            const never = new Promise<CodeLensList>(() => undefined);
            let asked = 0;
            providers.register("*", {
                provideCodeLenses: () => (asked++ === 0 ? list([lens(0)]) : never),
                resolveCodeLens,
            });
            const { insert } = setup();
            await vi.advanceTimersByTimeAsync(380);
            insert(1, "x");
            await vi.advanceTimersByTimeAsync(SETTLE_MS);
            expect(resolveCodeLens).not.toHaveBeenCalled();
        });

        it("a late answer of a cancelled resolve changes nothing", async () => {
            const answer = deferred<CodeLens>();
            const never = new Promise<CodeLensList>(() => undefined);
            let asked = 0;
            providers.register("*", {
                provideCodeLenses: () => (asked++ === 0 ? list([lens(0)]) : never),
                resolveCodeLens: () => answer.promise,
            });
            const { insert, zones, settle } = setup();
            await settle();
            insert(1, "x");
            answer.resolve(lens(0, command("late")));
            await settle();
            expect(zones()[0].text).toBe("");
        });

        it("two edits in a task publish once, after both", async () => {
            providers.register("*", answering([lens(1, command("t"))]));
            const { insert, published, zones, settle } = setup();
            await settle();
            const count = published.length;
            insert(0, "a\n");
            insert(0, "b\n");
            expect(published).toHaveLength(count);
            await Promise.resolve();
            expect(published).toHaveLength(count + 1);
            expect(zones()[0].line).toBe(3);
        });

        it("text typed at the start of a lens does not stretch it: the lens goes down with its line", async () => {
            const never = new Promise<CodeLensList>(() => undefined);
            let asked = 0;
            providers.register("*", {
                provideCodeLenses: () => (asked++ === 0 ? list([lens(0, command("t"))]) : never),
            });
            const { insert, zones, settle } = setup();
            await settle();
            insert(0, "new\n");
            await Promise.resolve();
            expect(zones()[0].line).toBe(1);
        });
    });

    describe("the text of a lens gone", () => {
        function once(lenses: readonly CodeLens[], rest: Partial<CodeLensProvider> = {}): void {
            const never = new Promise<CodeLensList>(() => undefined);
            let asked = 0;
            providers.register("*", {
                provideCodeLenses: () => (asked++ === 0 ? list(lenses) : never),
                ...rest,
            });
        }

        it("a lens of one line drops; an empty range has nothing to lose and stays", async () => {
            const empty: CodeLens = {
                range: { start: { line: 3, character: 0 }, end: { line: 3, character: 0 } },
                command: command("empty"),
            };
            once([lens(1, command("one")), empty]);
            const { edit, zones, settle } = setup();
            await settle();
            edit({ start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, "");
            await Promise.resolve();
            expect(zones().map((zone) => zone.text)).toEqual(["empty"]);
        });

        it("a lens over several lines lives while they do, with the same columns at both ends", async () => {
            const multi: CodeLens = {
                range: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } },
                command: command("multi"),
            };
            once([multi]);
            const { edit, insert, zones, settle } = setup();
            await settle();
            insert(5, "x");
            await Promise.resolve();
            expect(zones().map((zone) => zone.text)).toEqual(["multi"]);

            edit({ start: { line: 1, character: 0 }, end: { line: 3, character: 0 } }, "");
            await Promise.resolve();
            expect(zones()).toEqual([]);
        });

        it("a dropped lens survives the next edit, a scroll and the picker", async () => {
            once([lens(1, command("t")), lens(2)], { resolveCodeLens: () => null });
            const { edit, insert, visibleRange, controller, zones } = setup();
            // The provide is over, the resolve's debounce is still running: lens 2 keeps waiting.
            await vi.advanceTimersByTimeAsync(380);
            edit({ start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, "");
            edit({ start: { line: 2, character: 0 }, end: { line: 2, character: 1 } }, "");
            await Promise.resolve();
            insert(0, "x");
            await Promise.resolve();
            visibleRange.fire();
            // Before the next provide goes out: the picker would wait for its answer.
            await expect(controller.getPicksAtLine(1)).resolves.toEqual([]);
            expect(zones()).toEqual([]);
            expect(unexpected).toEqual([]);
        });
    });

    describe("the resolve", () => {
        it("goes out after the provide with no viewport event at all", async () => {
            const resolveCodeLens = vi.fn(() => null);
            providers.register("*", answering([lens(0)], { resolveCodeLens }));
            const { settle } = setup();
            await settle();
            expect(resolveCodeLens).toHaveBeenCalledOnce();
        });

        it("is not for a lens that has its command", async () => {
            const resolveCodeLens = vi.fn(() => null);
            providers.register("*", answering([lens(0, command("t"))], { resolveCodeLens }));
            const { settle, zones } = setup();
            await settle();
            expect(resolveCodeLens).not.toHaveBeenCalled();
            expect(zones()[0].text).toBe("t");
        });

        it("takes the viewport and the row under it, nothing above or below", async () => {
            const resolved: number[] = [];
            const resolveCodeLens = (_model: unknown, item: CodeLens): null => {
                resolved.push(item.range.start.line);
                return null;
            };
            providers.register("*", answering([lens(0), lens(1), lens(2), lens(3), lens(4)], { resolveCodeLens }));
            const { visible, visibleRange, settle } = setup();
            visible.startLine = 1;
            visible.endLine = 2;
            visibleRange.fire();
            await settle();
            expect(resolved.sort()).toEqual([1, 2, 3]);
        });

        it("arms no timer with nothing to resolve in view, after the provide and on a scroll", async () => {
            providers.register("*", answering([lens(5)], { resolveCodeLens: () => null }));
            const { visible, visibleRange } = setup();
            visible.endLine = 1;
            await vi.advanceTimersByTimeAsync(380);
            expect(vi.getTimerCount()).toBe(0);
            visibleRange.fire();
            expect(vi.getTimerCount()).toBe(0);
        });

        it("a scroll to a waiting lens brings its title", async () => {
            const resolveCodeLens = (_model: unknown, item: CodeLens): CodeLens => ({ ...item, command: command("t") });
            providers.register("*", answering([lens(5)], { resolveCodeLens }));
            const { visible, visibleRange, zones, settle } = setup();
            visible.endLine = 1;
            await settle();
            expect(zones()[0].text).toBe("");
            visible.endLine = 5;
            visibleRange.fire();
            await settle();
            expect(zones()[0].text).toBe("t");
        });
    });

    describe("the debounce", () => {
        it("a cancelled resolve does not count: however long it took, the next one is not delayed", async () => {
            const hung = deferred<CodeLens>();
            let asked = 0;
            const resolveCodeLens = vi.fn(() => (asked++ === 0 ? hung.promise : null));
            providers.register("*", answering([lens(0)], { resolveCodeLens }));
            const { insert, settle } = setup();
            await settle();
            expect(resolveCodeLens).toHaveBeenCalledOnce();
            insert(1, "x");
            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(5000);
            // The next provide and its resolve are over; the hung answer comes only now.
            expect(resolveCodeLens).toHaveBeenCalledTimes(2);
            hung.resolve(lens(0, command("t")));
            await vi.advanceTimersByTimeAsync(0);

            insert(1, "y");
            // Provide: 250 ms at the fastest, then the resolve at most the default.
            await vi.advanceTimersByTimeAsync(250 + 400);
            expect(resolveCodeLens).toHaveBeenCalledTimes(3);
        });

        it("a slow provider is asked less often", async () => {
            const changed = new Emitter<void>();
            const provideCodeLenses = vi.fn(
                () =>
                    new Promise<CodeLensList>((resolve) => {
                        setTimeout(() => {
                            resolve(list([]));
                        }, 4000);
                    }),
            );
            providers.register("*", { provideCodeLenses, onDidChange: changed.event });
            const { settle } = setup();
            await settle();
            expect(provideCodeLenses).toHaveBeenCalledOnce();
            changed.fire();
            await vi.advanceTimersByTimeAsync(1000);
            expect(provideCodeLenses).toHaveBeenCalledOnce();
            await settle();
            expect(provideCodeLenses).toHaveBeenCalledTimes(2);
        });

        it("a slow resolve makes the next one wait longer", async () => {
            const changed = new Emitter<void>();
            const resolveCodeLens = vi.fn(
                () =>
                    new Promise<null>((resolve) => {
                        setTimeout(() => {
                            resolve(null);
                        }, 4000);
                    }),
            );
            providers.register("*", answering([lens(0)], { resolveCodeLens, onDidChange: changed.event }));
            const { settle } = setup();
            await settle();
            expect(resolveCodeLens).toHaveBeenCalledOnce();
            changed.fire();
            await vi.advanceTimersByTimeAsync(1000);
            expect(resolveCodeLens).toHaveBeenCalledOnce();
            await settle();
            expect(resolveCodeLens).toHaveBeenCalledTimes(2);
        });
    });

    describe("the picks of a line", () => {
        it("leave out a lens without a command and those of other lines", async () => {
            const run = command("run");
            providers.register("*", answering([lens(1), lens(1, run, 1), lens(2, command("other"))]));
            const { controller, settle } = setup();
            await settle();
            await expect(controller.getPicksAtLine(1)).resolves.toEqual([{ label: "run", command: run }]);
        });
    });

    describe("dispose", () => {
        it("cancels the provide in flight", async () => {
            let token: ICancellationToken | undefined;
            providers.register("*", {
                provideCodeLenses: (_model, t) => {
                    token = t;
                    return new Promise(() => undefined);
                },
            });
            const { controller, settle } = setup();
            await settle();
            controller.dispose();
            expect(token?.isCancellationRequested).toBe(true);
        });

        it("right after an edit publishes nothing more", async () => {
            providers.register("*", answering([lens(1, command("t"))]));
            const { controller, insert, published, settle } = setup();
            await settle();
            insert(0, "x\n");
            controller.dispose();
            const count = published.length;
            await Promise.resolve();
            expect(published).toHaveLength(count);
        });
    });
});

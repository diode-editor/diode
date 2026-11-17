// The inline values over fake editors and a fake focused frame: when they are shown (`debug.inlineValues`, the
// frame's file, the providers of the language), what the providers' three kinds become, the fallback from the
// frame's variables (the scopes, the lines up to the stop, code words only), and when they are computed again.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { StandardTokenType } from "../../../../editor/common/encodedTokenAttributes.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type {
    IInlineValuesRequest,
    InlineValue,
    InlineValuesProvider,
} from "../../../../editor/common/languages/iInlineValuesSource.ts";
import type { ILineMessageDecoration } from "../../../../editor/common/model/iLineMessageDecoration.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import type { LineTokens } from "../../../../editor/common/tokens/lineTokens.ts";
import type { IConfigurationChangeEvent } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { IDebugService, IStackFrame } from "../common/debug.ts";

import {
    type IInlineValuesEditor,
    type IInlineValuesEditorSource,
    INLINE_VALUES_OWNER,
    InlineValuesContribution,
} from "./inlineValuesContribution.ts";

const FILE = Uri.file("/w/main.c");
const TEXT = [
    "int main(int argc) {", // 0
    "    int sum = 0;", // 1
    "    // sum is argc", // 2
    "    sum += argc;", // 3
    "    return sum;", // 4
    "}", // 5
].join("\n");

/** A token per word and per run of the rest; `// …` to the end is a comment, `"…"` a string. */
function tokensOf(content: string): LineTokens {
    const tokens: { start: number; end: number; type: StandardTokenType }[] = [];
    const comment = content.indexOf("//");
    const code = comment === -1 ? content : content.slice(0, comment);
    for (const match of code.matchAll(/"[^"]*"|\w+|[^\w"]+/g)) {
        const type = match[0].startsWith('"') ? StandardTokenType.String : StandardTokenType.Other;
        tokens.push({ start: match.index, end: match.index + match[0].length, type });
    }
    if (comment !== -1) tokens.push({ start: comment, end: content.length, type: StandardTokenType.Comment });
    return {
        getCount: () => tokens.length,
        getStartOffset: (i: number) => tokens[i].start,
        getEndOffset: (i: number) => tokens[i].end,
        getStandardTokenType: (i: number) => tokens[i].type,
    } as unknown as LineTokens;
}

interface IFakeEditor extends IInlineValuesEditor {
    readonly document: TextDocument;
    /** What the editor shows after the lines' ends: line → text. */
    values(): Record<number, string>;
    decorations: readonly ILineMessageDecoration[];
    /** How many times the decorations were set. */
    sets: number;
    visible: { startLine: number; endLine: number };
    scroll(): void;
    edit(line: number, text: string): void;
    readonly forced: number[];
}

/** `tokens`: `false` — no token store; `"line"` — a language without a grammar, a line is one token. */
function fakeEditor(
    options: { uri?: Uri; languageId?: string; text?: string; tokens?: false | "line" } = {},
): IFakeEditor {
    const document = new TextDocument(options.text ?? TEXT);
    const content = new Emitter<void>();
    const visibleRange = new Emitter<void>();
    const forced: number[] = [];
    const tokenStore =
        options.tokens === false
            ? null
            : {
                  forceTokenization: (line: number) => {
                      forced.push(line);
                  },
                  getLineTokens: (line: number) =>
                      options.tokens === "line"
                          ? ({
                                getCount: () => 1,
                                getStartOffset: () => 0,
                                getEndOffset: () => document.getLineContent(line).length,
                                getStandardTokenType: () => StandardTokenType.Other,
                            } as unknown as LineTokens)
                          : tokensOf(document.getLineContent(line)),
              };
    const editor: IFakeEditor = {
        uri: options.uri ?? FILE,
        languageId: options.languageId ?? "c",
        versionId: 4,
        document,
        forced,
        viewState: { document, tokenStore },
        visible: { startLine: 0, endLine: document.lineCount - 1 },
        decorations: [],
        sets: 0,
        getVisibleLineRange: () => editor.visible,
        onDidChangeVisibleRange: (listener) => visibleRange.event(listener),
        onDidChangeContent: (listener) => content.event(listener),
        setLineMessageDecorations: (owner, decorations) => {
            expect(owner).toBe(INLINE_VALUES_OWNER);
            editor.decorations = decorations;
            editor.sets++;
        },
        values: () => Object.fromEntries(editor.decorations.map((d) => [d.line, d.text])),
        scroll: () => {
            visibleRange.fire();
        },
        edit: (line, text) => {
            document.applyEdits([createTextEdit(createRange(line, 0, line, 0), text)]);
            content.fire();
        },
    };
    return editor;
}

/** A change of the setting `key`. */
function changed(key: string): IConfigurationChangeEvent {
    return { affectsConfiguration: (k: string) => k === key } as unknown as IConfigurationChangeEvent;
}

interface IFakeScope {
    /** 1-based lines, as the debug model's ranges. */
    readonly range?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
    readonly variables: Record<string, string>;
}

interface IFakeFrame extends IStackFrame {
    scopes: IFakeScope[];
    readonly evaluated: string[];
}

/** A frame stopped at the 1-based `line` and `column` of `uri`; `evaluate` answers the expressions it knows. */
function stackFrame(
    line: number,
    scopes: IFakeScope[],
    { uri = FILE, column = 5, answers = {} as Record<string, string> } = {},
): IFakeFrame {
    const evaluated: string[] = [];
    const session = {
        evaluate: (expression: string) => {
            evaluated.push(expression);
            return Promise.resolve(
                expression in answers ? { body: { result: answers[expression], variablesReference: 0 } } : undefined,
            );
        },
    };
    const frame = {
        frameId: 1000,
        source: { uri },
        range: { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column },
        thread: { session },
        scopes,
        evaluated,
        getMostSpecificScopes: () =>
            Promise.resolve(
                frame.scopes.map((scope) => ({
                    range: scope.range,
                    getChildren: () =>
                        Promise.resolve(Object.entries(scope.variables).map(([name, value]) => ({ name, value }))),
                })),
            ),
    };
    return frame as unknown as IFakeFrame;
}

describe("InlineValuesContribution", () => {
    let open: IFakeEditor[];
    let editor: IFakeEditor;
    let editorsChanged: Emitter<void>;
    let focused: IStackFrame | undefined;
    let focusChanged: Emitter<void>;
    let willUpdateViews: Emitter<void>;
    let lazyEvaluated: Emitter<void>;
    let setting: string | boolean;
    /** What `inspect` answers instead of `setting` in the user's layer. */
    let layers: Record<string, unknown> | undefined;
    let configChanged: Emitter<IConfigurationChangeEvent>;
    let providers: LanguageFeatureRegistry<InlineValuesProvider>;
    let contribution: InlineValuesContribution | undefined;

    const LOCALS: IFakeScope = { variables: { argc: "2", sum: "4" } };

    function start(): void {
        const source: IInlineValuesEditorSource = {
            getEditors: () => open,
            onDidChangeEditors: (listener) => editorsChanged.event(listener),
        };
        const debugService = {
            getViewModel: () => ({
                get focusedStackFrame() {
                    return focused;
                },
                onDidFocusStackFrame: focusChanged.event,
                onWillUpdateViews: willUpdateViews.event,
                onDidEvaluateLazyExpression: lazyEvaluated.event,
            }),
        } as unknown as IDebugService;
        contribution = new InlineValuesContribution(
            source,
            debugService,
            {
                // The schema keeps only its strings; the user's layer is as written.
                inspect: (() => layers ?? { user: setting, value: setting === true ? "auto" : setting }) as never,
                onDidChangeConfiguration: configChanged.event,
            },
            { inlineValuesProvider: providers },
        );
    }

    /** Focuses `frame` and lets the update finish. */
    async function focus(frame: IStackFrame | undefined): Promise<void> {
        focused = frame;
        focusChanged.fire();
        await vi.advanceTimersByTimeAsync(0);
    }

    function provide(answer: (request: IInlineValuesRequest) => readonly InlineValue[] | null, selector = "c") {
        const provider = {
            provideInlineValues: vi.fn((request: IInlineValuesRequest) => Promise.resolve(answer(request))),
        };
        providers.register(selector, provider);
        return provider;
    }

    const at = (line: number, start: number, end: number) => createRange(line, start, line, end);

    beforeEach(() => {
        vi.useFakeTimers();
        editor = fakeEditor();
        open = [editor];
        editorsChanged = new Emitter();
        focused = undefined;
        focusChanged = new Emitter();
        willUpdateViews = new Emitter();
        lazyEvaluated = new Emitter();
        setting = "on";
        layers = undefined;
        configChanged = new Emitter();
        providers = new LanguageFeatureRegistry();
    });

    afterEach(() => {
        contribution?.dispose();
        contribution = undefined;
        vi.useRealTimers();
    });

    describe("without a provider: the frame's variables named in the code up to the stop", () => {
        it("each line up to the stop shows the values of the variables it names, in the order it names them", async () => {
            start();
            await focus(stackFrame(4, [LOCALS]));
            expect(editor.values()).toEqual({ 0: "argc = 2", 1: "sum = 4", 3: "sum = 4, argc = 2" });
        });

        it("in the background of inline values, after the other owners' messages of the line", async () => {
            start();
            await focus(stackFrame(2, [LOCALS]));
            expect(editor.decorations).toEqual([
                {
                    key: expect.stringMatching(/:0$/) as string,
                    line: 0,
                    text: "argc = 2",
                    colorToken: "editor.inlineValuesForeground",
                    bgToken: "editor.inlineValuesBackground",
                    order: 1,
                },
                {
                    key: expect.stringMatching(/:1$/) as string,
                    line: 1,
                    text: "sum = 4",
                    colorToken: "editor.inlineValuesForeground",
                    bgToken: "editor.inlineValuesBackground",
                    order: 1,
                },
            ]);
        });

        it("a comment or a string naming a variable is not code; the lines are tokenized first", async () => {
            editor = fakeEditor({ text: 'int argc;\nputs("argc"); // argc\n' });
            open = [editor];
            start();
            await focus(stackFrame(2, [LOCALS]));
            expect(editor.values()).toEqual({ 0: "argc = 2" });
            expect(editor.forced).toEqual([0, 1]);
        });

        it.each([
            ["without tokens", false],
            ["in one token of a line (no grammar)", "line"],
        ] as const)("%s every word of the line counts", async (_name, tokens) => {
            editor = fakeEditor({ text: "int argc; // sum\n", tokens });
            open = [editor];
            start();
            await focus(stackFrame(1, [LOCALS]));
            expect(editor.values()).toEqual({ 0: "argc = 2, sum = 4" });
        });

        it("a narrower scope's value shadows a wider one's; a scope starts where its range does", async () => {
            start();
            await focus(
                stackFrame(4, [
                    {
                        range: { startLineNumber: 4, startColumn: 1, endLineNumber: 5, endColumn: 1 },
                        variables: { sum: "9" },
                    },
                    { variables: { sum: "1", argc: "2" } },
                ]),
            );
            expect(editor.values()).toEqual({ 0: "argc = 2", 1: "sum = 1", 3: "sum = 9, argc = 2" });
        });

        it("only the first 100 variables of a scope are looked for", async () => {
            const variables = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`v${String(i)}`, String(i)]));
            editor = fakeEditor({ text: "v0 v99 v100\n" });
            open = [editor];
            start();
            await focus(stackFrame(1, [{ variables }]));
            expect(editor.values()).toEqual({ 0: "v0 = 0, v99 = 99" });
        });

        it("a line longer than 500 characters is skipped", async () => {
            editor = fakeEditor({ text: `argc ${"x".repeat(496)}\nargc ${"x".repeat(495)}\n` });
            open = [editor];
            start();
            await focus(stackFrame(2, [LOCALS]));
            expect(editor.values()).toEqual({ 1: "argc = 2" });
        });

        it("only the visible lines and a screen above and below are looked at", async () => {
            editor = fakeEditor({ text: Array.from({ length: 20 }, () => "argc").join("\n") });
            editor.visible = { startLine: 8, endLine: 9 };
            open = [editor];
            start();
            await focus(stackFrame(20, [LOCALS]));
            expect(Object.keys(editor.values()).map(Number)).toEqual([6, 7, 8, 9, 10, 11]);
        });

        it("a value is one line, cut after 150 characters", async () => {
            start();
            await focus(stackFrame(1, [{ variables: { argc: `a\nb\t${"c".repeat(200)}` } }]));
            const text = editor.values()[0];
            expect(text).toBe(`argc = a b ${"c".repeat(150 - "argc = a b ".length)}...`);
        });
    });

    describe("when they are shown", () => {
        it("off, or auto without a provider: none", async () => {
            setting = "off";
            start();
            await focus(stackFrame(4, [LOCALS]));
            expect(editor.decorations).toEqual([]);

            setting = "auto";
            configChanged.fire(changed("debug.inlineValues"));
            await vi.advanceTimersByTimeAsync(0);
            expect(editor.decorations).toEqual([]);
        });

        it("auto with a provider for the language, or the old `true`: shown", async () => {
            setting = "auto";
            provide(() => [{ type: "text", range: at(1, 8, 11), text: "sum: 4" }]);
            start();
            await focus(stackFrame(4, [LOCALS]));
            expect(editor.values()).toEqual({ 1: "sum: 4" });

            setting = true;
            providers = new LanguageFeatureRegistry();
            contribution?.dispose();
            editor.decorations = [];
            start();
            await focus(stackFrame(4, [LOCALS]));
            expect(editor.values()[1]).toBe("sum = 4");
        });

        it("turned off: the values go a moment later; another setting changing changes nothing", async () => {
            start();
            await focus(stackFrame(4, [LOCALS]));
            setting = "off";
            configChanged.fire(changed("debug.other"));
            await vi.advanceTimersByTimeAsync(1000);
            expect(editor.decorations).not.toEqual([]);

            configChanged.fire(changed("debug.inlineValues"));
            await vi.advanceTimersByTimeAsync(99);
            expect(editor.decorations).not.toEqual([]);
            await vi.advanceTimersByTimeAsync(1);
            expect(editor.decorations).toEqual([]);
        });

        it("the old `true` is read from the most specific layer that has the key", async () => {
            layers = { user: "off", workspace: true, value: "auto" };
            start();
            await focus(stackFrame(2, [LOCALS]));
            expect(editor.values()).toEqual({ 0: "argc = 2", 1: "sum = 4" });

            layers = { user: true, workspaceFolder: "off", workspace: true, profile: true, value: "off" };
            configChanged.fire(changed("debug.inlineValues"));
            await vi.advanceTimersByTimeAsync(100);
            expect(editor.decorations).toEqual([]);

            layers = { profile: true, user: "off", value: "off" };
            configChanged.fire(changed("debug.inlineValues"));
            await vi.advanceTimersByTimeAsync(0);
            expect(editor.values()).toEqual({ 0: "argc = 2", 1: "sum = 4" });
        });

        it("a frame of another file shows none in this one", async () => {
            start();
            await focus(stackFrame(4, [LOCALS], { uri: Uri.file("/w/other.c") }));
            expect(editor.decorations).toEqual([]);
        });

        it("a step does not blink: the frame back within 100 ms keeps the values", async () => {
            start();
            await focus(stackFrame(4, [LOCALS]));
            const shown = editor.decorations;
            await focus(undefined);
            await vi.advanceTimersByTimeAsync(50);
            // A second removal while one is pending does not postpone it.
            await focus(undefined);
            expect(editor.decorations).toBe(shown);
            await focus(stackFrame(4, [{ variables: { argc: "3" } }]));
            await vi.advanceTimersByTimeAsync(200);
            expect(editor.values()).toEqual({ 0: "argc = 3", 3: "argc = 3" });
        });

        it("the session gone: the values go after 100 ms", async () => {
            start();
            await focus(stackFrame(4, [LOCALS]));
            await focus(undefined);
            await vi.advanceTimersByTimeAsync(100);
            expect(editor.decorations).toEqual([]);
        });

        it("an editor opened while stopped gets the values; a closed one is let go", async () => {
            start();
            await focus(stackFrame(4, [LOCALS]));
            const other = fakeEditor();
            open = [other];
            editorsChanged.fire();
            await vi.advanceTimersByTimeAsync(0);
            expect(other.values()[3]).toBe("sum = 4, argc = 2");

            editor.decorations = [];
            await focus(stackFrame(4, [{ variables: { argc: "7" } }]));
            expect(editor.decorations).toEqual([]);
            expect(other.values()[0]).toBe("argc = 7");
            editorsChanged.fire();
        });
    });

    describe("computed again", () => {
        it("200 ms after the views update, a lazy variable is evaluated or the text changes", async () => {
            start();
            const frame = stackFrame(4, [{ variables: { argc: "2" } }]);
            await focus(frame);

            frame.scopes = [{ variables: { argc: "3" } }];
            willUpdateViews.fire();
            await vi.advanceTimersByTimeAsync(199);
            expect(editor.values()[0]).toBe("argc = 2");
            await vi.advanceTimersByTimeAsync(1);
            expect(editor.values()[0]).toBe("argc = 3");

            frame.scopes = [{ variables: { argc: "4" } }];
            lazyEvaluated.fire();
            await vi.advanceTimersByTimeAsync(200);
            expect(editor.values()[0]).toBe("argc = 4");

            // The stop stays on the 4th line: `sum += argc` went below it.
            editor.edit(0, "// top\n");
            await vi.advanceTimersByTimeAsync(200);
            expect(editor.values()).toEqual({ 1: "argc = 4" });
        });

        it("typing while no frame is focused computes nothing", async () => {
            start();
            await vi.advanceTimersByTimeAsync(1000);
            const sets = editor.sets;
            editor.edit(0, "// top\n");
            await vi.advanceTimersByTimeAsync(1000);
            expect(editor.sets).toBe(sets);
        });

        it("a scroll asks the providers again; without a provider it changes nothing", async () => {
            start();
            const frame = stackFrame(4, [{ variables: { argc: "2" } }]);
            await focus(frame);
            frame.scopes = [{ variables: { argc: "3" } }];
            editor.scroll();
            await vi.advanceTimersByTimeAsync(200);
            expect(editor.values()[0]).toBe("argc = 2");

            const provider = provide(() => []);
            await vi.advanceTimersByTimeAsync(200);
            expect(provider.provideInlineValues).toHaveBeenCalledTimes(1);
            editor.scroll();
            await vi.advanceTimersByTimeAsync(200);
            expect(provider.provideInlineValues).toHaveBeenCalledTimes(2);
        });

        it("a provider registered while stopped is asked", async () => {
            start();
            await focus(stackFrame(4, [LOCALS]));
            provide(() => [{ type: "text", range: at(2, 0, 1), text: "from the provider" }]);
            await vi.advanceTimersByTimeAsync(200);
            expect(editor.values()).toEqual({ 2: "from the provider" });
        });

        it("a newer update wins over a slower older one", async () => {
            let release: (() => void) | undefined;
            const slow = new Promise<void>((resolve) => {
                release = resolve;
            });
            const provider = {
                provideInlineValues: vi
                    .fn<InlineValuesProvider["provideInlineValues"]>()
                    .mockImplementationOnce(async (_request, token) => {
                        await slow;
                        expect(token.isCancellationRequested).toBe(true);
                        return [{ type: "text", range: at(0, 0, 1), text: "old" }];
                    })
                    .mockResolvedValue([{ type: "text", range: at(0, 0, 1), text: "new" }]),
            };
            providers.register("c", provider);
            start();
            focused = stackFrame(4, [LOCALS]);
            focusChanged.fire();
            await focus(focused);
            release?.();
            await vi.advanceTimersByTimeAsync(0);
            expect(editor.values()).toEqual({ 0: "new" });
        });
    });

    describe("from the providers", () => {
        it("the request: the document, the window of lines and the frame with upstream's columns", async () => {
            const provider = provide(() => null);
            start();
            await focus(stackFrame(4, [LOCALS], { column: 5 }));
            expect(provider.provideInlineValues).toHaveBeenCalledWith(
                {
                    uri: FILE.toString(),
                    languageId: "c",
                    versionId: 4,
                    viewPort: createRange(0, 0, 5, 1),
                    context: { frameId: 1000, stoppedLocation: createRange(3, 5, 3, 5) },
                },
                expect.anything(),
            );
            expect(editor.decorations).toEqual([]);
        });

        it("text as it is; a variable looked up by name or by the range's text, case sensitive or not", async () => {
            provide(() => [
                { type: "text", range: at(0, 0, 3), text: "main()" },
                { type: "variable", range: at(1, 8, 11), caseSensitiveLookup: true },
                { type: "variable", range: at(3, 4, 7), variableName: "ARGC", caseSensitiveLookup: false },
                { type: "variable", range: at(4, 4, 7), variableName: "ARGC", caseSensitiveLookup: true },
                { type: "variable", range: at(4, 0, 0), variableName: "nope", caseSensitiveLookup: true },
            ]);
            start();
            await focus(stackFrame(4, [{ variables: { a: "x" } }, LOCALS]));
            expect(editor.values()).toEqual({ 0: "main()", 1: "sum = 4", 3: "ARGC = 2" });
        });

        it("an expression evaluated in the frame, given or the range's text; one not available is left out", async () => {
            provide(() => [
                { type: "expression", range: at(3, 4, 7) },
                { type: "expression", range: at(4, 11, 14), expression: "sum * 2" },
                { type: "expression", range: at(1, 0, 3), expression: "unknown" },
                { type: "expression", range: at(2, 0, 0) },
            ]);
            start();
            const frame = stackFrame(4, [LOCALS], { answers: { sum: "4", "sum * 2": "8" } });
            await focus(frame);
            expect(editor.values()).toEqual({ 3: "sum = 4", 4: "sum * 2 = 8" });
            expect(frame.evaluated).toEqual(["sum", "sum * 2", "unknown"]);
        });

        it("the values of a line are joined by their columns, without repeats; the providers' answers merge", async () => {
            provide(() => [
                { type: "text", range: at(3, 11, 15), text: "argc: 2" },
                { type: "text", range: at(3, 4, 7), text: "sum: 4" },
            ]);
            provide(() => [{ type: "text", range: at(3, 0, 1), text: "sum: 4" }]);
            start();
            await focus(stackFrame(4, [LOCALS]));
            expect(editor.values()).toEqual({ 3: "sum: 4, argc: 2" });
        });

        it("a failing provider costs only its own values", async () => {
            const errors: unknown[] = [];
            setUnexpectedErrorHandler((e) => errors.push(e));
            providers.register("c", { provideInlineValues: () => Promise.reject(new Error("boom")) });
            provide(() => [{ type: "text", range: at(1, 0, 1), text: "kept" }]);
            start();
            await focus(stackFrame(4, [LOCALS]));
            expect(editor.values()).toEqual({ 1: "kept" });
            expect(errors).toEqual([new Error("boom")]);
        });

        it("a provider of another language is not asked; the fallback applies", async () => {
            const provider = provide(() => [{ type: "text", range: at(1, 0, 1), text: "py" }], "python");
            start();
            await focus(stackFrame(2, [LOCALS]));
            expect(provider.provideInlineValues).not.toHaveBeenCalled();
            expect(editor.values()).toEqual({ 0: "argc = 2", 1: "sum = 4" });
        });
    });
});

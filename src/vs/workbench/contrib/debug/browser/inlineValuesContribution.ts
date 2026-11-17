/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugEditorContribution.ts
// The inline values of upstream's `DebugEditorContribution` over every text editor of the tabs: while a frame of
// the editor's file is focused, the values of the variables (`debug.inlineValues`) follow the visible lines' ends —
// from the language's `InlineValuesProvider`s, or without one from the names of the frame's variables found in the
// lines up to the stop. They are messages after the lines' ends (`editor.inlineValuesForeground` on
// `editor.inlineValuesBackground`) and come after the other owners' messages of a line: the test failures and the
// exception badge are cut by the editor's edge last. Deviations: the text is cut at 150 characters (upstream: by
// the editor's width, which cuts the message here anyway), no hover over a value, a fixed 200 ms debounce (upstream
// learns it per document), no word-to-lines cache (the visible lines are found again on each update).

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { DEFAULT_WORD_REGEXP } from "../../../../editor/common/core/wordHelper.ts";
import { StandardTokenType } from "../../../../editor/common/encodedTokenAttributes.ts";
import type { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type { InlineValue, InlineValuesProvider } from "../../../../editor/common/languages/iInlineValuesSource.ts";
import type { ILineMessageDecoration } from "../../../../editor/common/model/iLineMessageDecoration.ts";
import type { ITextDocument } from "../../../../editor/common/model/iTextDocument.ts";
import {
    type ILanguageFeaturesService,
    LanguageFeaturesServiceDIToken,
} from "../../../../editor/common/services/languageFeatures.ts";
import type { LineTokens } from "../../../../editor/common/tokens/lineTokens.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IDebugService, IStackFrame } from "../common/debug.ts";
import { Expression } from "../common/debugModel.ts";

import { DebugServiceDIToken } from "./debugService.ts";

/** The owner of the inline values among the messages after the lines' ends. */
export const INLINE_VALUES_OWNER = "debug.inlineValues";

/** After the test messages and the exception badge (order 0) of a line. */
const INLINE_VALUES_ORDER = 1;

const MAX_NUM_INLINE_VALUES = 100; // JS Global scope can have 700+ entries. We want to limit ourselves for perf reasons
const MAX_INLINE_DECORATOR_LENGTH = 150; // Max string length of each inline decorator when debugging. If exceeded ... is added
const MAX_TOKENIZATION_LINE_LEN = 500; // If line is too long, then inline values for the line are skipped

/** Upstream's `DEAFULT_INLINE_DEBOUNCE_DELAY`, the least of its learnt debounce. */
const UPDATE_DELAY = 200;
/** Upstream's `removeInlineValuesScheduler`: a step does not blink the values away and back. */
const REMOVE_DELAY = 100;

const FOREGROUND = "editor.inlineValuesForeground";
const BACKGROUND = "editor.inlineValuesBackground";

/** `TextEditorPane` matches structurally; the DI module does the binding. */
export interface IInlineValuesEditor {
    readonly uri: Uri;
    readonly languageId: string;
    readonly versionId: number;
    readonly viewState: {
        readonly document: Pick<ITextDocument, "getLineContent" | "lineCount">;
        readonly tokenStore?: {
            forceTokenization(line: number): void;
            getLineTokens(line: number): LineTokens | undefined;
        } | null;
    };
    /** Document lines, inclusive, 0-based. */
    getVisibleLineRange(): { readonly startLine: number; readonly endLine: number };
    onDidChangeVisibleRange(listener: () => void): IDisposable;
    onDidChangeContent(listener: () => void): IDisposable;
    setLineMessageDecorations(owner: string, decorations: readonly ILineMessageDecoration[]): void;
}

export interface IInlineValuesEditorSource {
    /** The tabs' text editors of every group. */
    getEditors(): readonly IInlineValuesEditor[];
    onDidChangeEditors(listener: () => void): IDisposable;
}

export const InlineValuesEditorSourceDIToken = token<IInlineValuesEditorSource>("InlineValuesEditorSource");
export const InlineValuesContributionDIToken = token<InlineValuesContribution>("InlineValuesContribution");

interface IAttachedEditor {
    readonly editor: IInlineValuesEditor;
    readonly subscriptions: readonly IDisposable[];
    readonly updateScheduler: RunOnceScheduler;
    readonly removeScheduler: RunOnceScheduler;
    /** The latest update; a new one cancels it. */
    pending: CancellationTokenSource | undefined;
}

/** Lines are 0-based, inclusive. */
interface ILineWindow {
    readonly startLine: number;
    readonly endLine: number;
}

export class InlineValuesContribution extends Disposable {
    public static dependencies = [
        InlineValuesEditorSourceDIToken,
        DebugServiceDIToken,
        IConfigurationServiceDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    private readonly attached = new Map<IInlineValuesEditor, IAttachedEditor>();
    private readonly providers: LanguageFeatureRegistry<InlineValuesProvider>;

    public constructor(
        private readonly editors: IInlineValuesEditorSource,
        private readonly debugService: IDebugService,
        private readonly configuration: Pick<IConfigurationService, "get" | "onDidChangeConfiguration">,
        languageFeatures: Pick<ILanguageFeaturesService, "inlineValuesProvider">,
    ) {
        super();
        this.providers = languageFeatures.inlineValuesProvider;
        const viewModel = debugService.getViewModel();
        this.register(
            editors.onDidChangeEditors(() => {
                this.syncEditors();
            }),
        );
        this.register(
            viewModel.onDidFocusStackFrame(() => {
                this.updateAll();
            }),
        );
        this.register(
            viewModel.onWillUpdateViews(() => {
                this.scheduleAll();
            }),
        );
        this.register(
            viewModel.onDidEvaluateLazyExpression(() => {
                this.scheduleAll();
            }),
        );
        // An extension's provider usually comes with its activation, after the stop.
        this.register(
            this.providers.onDidChange(() => {
                this.scheduleAll();
            }),
        );
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("debug.inlineValues")) this.updateAll();
            }),
        );
        this.register({
            dispose: () => {
                for (const state of [...this.attached.values()]) this.detach(state);
            },
        });
        this.syncEditors();
    }

    private syncEditors(): void {
        const open = new Set(this.editors.getEditors());
        for (const state of [...this.attached.values()]) {
            if (!open.has(state.editor)) this.detach(state);
        }
        for (const editor of open) {
            if (this.attached.has(editor)) continue;
            const state: IAttachedEditor = {
                editor,
                subscriptions: [
                    editor.onDidChangeContent(() => {
                        state.updateScheduler.schedule();
                    }),
                    // Inline value provider should get called on view port change
                    editor.onDidChangeVisibleRange(() => {
                        if (this.providers.has(editor)) state.updateScheduler.schedule();
                    }),
                ],
                updateScheduler: new RunOnceScheduler(() => {
                    this.update(state);
                }, UPDATE_DELAY),
                removeScheduler: new RunOnceScheduler(() => {
                    editor.setLineMessageDecorations(INLINE_VALUES_OWNER, []);
                }, REMOVE_DELAY),
                pending: undefined,
            };
            this.attached.set(editor, state);
            this.update(state);
        }
    }

    private detach(state: IAttachedEditor): void {
        for (const subscription of state.subscriptions) subscription.dispose();
        state.updateScheduler.dispose();
        state.removeScheduler.dispose();
        state.pending?.cancel();
        this.attached.delete(state.editor);
    }

    private updateAll(): void {
        for (const state of this.attached.values()) this.update(state);
    }

    private scheduleAll(): void {
        for (const state of this.attached.values()) state.updateScheduler.schedule();
    }

    private update(state: IAttachedEditor): void {
        state.updateScheduler.cancel();
        this.updateInlineValueDecorations(state).catch(onUnexpectedError);
    }

    /** Upstream `updateInlineValueDecorations`. */
    private async updateInlineValueDecorations(state: IAttachedEditor): Promise<void> {
        const { editor } = state;
        const stackFrame = this.debugService.getViewModel().focusedStackFrame;
        const setting = this.configuration.get("debug.inlineValues") as string | boolean;
        const hasProvider = this.providers.has(editor);
        const inlineValuesTurnedOn = setting === true || setting === "on" || (setting === "auto" && hasProvider);
        state.pending?.cancel();
        if (!inlineValuesTurnedOn || editor.uri.toString() !== stackFrame?.source.uri.toString()) {
            if (!state.removeScheduler.isScheduled()) state.removeScheduler.schedule();
            return;
        }
        state.removeScheduler.cancel();

        const cts = new CancellationTokenSource();
        state.pending = cts;
        const window = visibleWindow(editor);
        const valuesByLine = hasProvider
            ? await this.valuesFromProviders(editor, stackFrame, window, cts.token)
            : await valuesFromVariables(editor, stackFrame, window);
        if (cts.token.isCancellationRequested) return;
        editor.setLineMessageDecorations(
            INLINE_VALUES_OWNER,
            [...valuesByLine].map(([line, text]) => ({
                key: String(line),
                line,
                text: inlineText(text),
                colorToken: FOREGROUND,
                bgToken: BACKGROUND,
                order: INLINE_VALUES_ORDER,
            })),
        );
    }

    /** The providers' values, a line's joined by their columns; a failing provider costs only its own. */
    private async valuesFromProviders(
        editor: IInlineValuesEditor,
        stackFrame: IStackFrame,
        window: ILineWindow,
        cancellation: ICancellationToken,
    ): Promise<Map<number, string>> {
        const document = editor.viewState.document;
        const { range } = stackFrame;
        const request = {
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            versionId: editor.versionId,
            viewPort: createRange(window.startLine, 0, window.endLine, document.getLineContent(window.endLine).length),
            context: {
                frameId: stackFrame.frameId,
                // Upstream's columns are one past the frame's: the extension sees the 1-based column as 0-based.
                stoppedLocation: createRange(
                    range.startLineNumber - 1,
                    range.startColumn,
                    range.endLineNumber - 1,
                    range.endColumn,
                ),
            },
        };
        const findVariable = async (key: string, caseSensitiveLookup: boolean): Promise<string | undefined> => {
            const scopes = await stackFrame.getMostSpecificScopes(stackFrame.range);
            const name = caseSensitiveLookup ? key : key.toLowerCase();
            for (const scope of scopes) {
                const variables = await scope.getChildren();
                const found = variables.find((v) =>
                    caseSensitiveLookup ? v.name === name : v.name.toLowerCase() === name,
                );
                if (found) return found.value;
            }
            return undefined;
        };
        const textOf = async (iv: InlineValue): Promise<string | undefined> => {
            const rangeText = (): string =>
                document
                    .getLineContent(iv.range.start.line)
                    .substring(iv.range.start.character, iv.range.end.character);
            switch (iv.type) {
                case "text":
                    return iv.text;
                case "variable": {
                    const va = iv.variableName ?? rangeText();
                    const value = await findVariable(va, iv.caseSensitiveLookup);
                    return value ? `${va} = ${value}` : undefined;
                }
                case "expression": {
                    const expr = iv.expression ?? rangeText();
                    if (!expr) return undefined;
                    const expression = new Expression(expr);
                    await expression.evaluate(stackFrame.thread.session, stackFrame, "watch", true);
                    return expression.available ? `${expr} = ${expression.value}` : undefined;
                }
            }
        };

        const lineSegments = new Map<number, { readonly column: number; readonly text: string }[]>();
        const providers = this.providers.ordered(editor).reverse();
        await Promise.all(
            providers.map(async (provider) => {
                try {
                    for (const iv of (await provider.provideInlineValues(request, cancellation)) ?? []) {
                        const text = await textOf(iv);
                        if (!text) continue;
                        const line = iv.range.start.line;
                        let segments = lineSegments.get(line);
                        if (segments === undefined) {
                            segments = [];
                            lineSegments.set(line, segments);
                        }
                        // de-dupe
                        if (!segments.some((s) => s.text === text)) {
                            segments.push({ column: iv.range.start.character, text });
                        }
                    }
                } catch (err) {
                    onUnexpectedError(err);
                }
            }),
        );
        const result = new Map<number, string>();
        for (const [line, segments] of lineSegments) {
            result.set(
                line,
                segments
                    .sort((a, b) => a.column - b.column)
                    .map((s) => s.text)
                    .join(", "),
            );
        }
        return result;
    }
}

/** Upstream `getVisibleRangesPlusViewportAboveBelow`: the visible lines and a screen above and below. */
function visibleWindow(editor: IInlineValuesEditor): ILineWindow {
    const { startLine, endLine } = editor.getVisibleLineRange();
    const height = endLine - startLine + 1;
    return {
        startLine: Math.max(0, startLine - height),
        endLine: Math.min(editor.viewState.document.lineCount - 1, endLine + height),
    };
}

/**
 * Upstream's "one-size-fits-all" strategy: the scopes' variables from the narrowest scope out, each named in the
 * code of a line between its scope's start and the stop; a name shadowed by a narrower scope keeps that one's value.
 */
async function valuesFromVariables(
    editor: IInlineValuesEditor,
    stackFrame: IStackFrame,
    window: ILineWindow,
): Promise<Map<number, string>> {
    const scopes = await stackFrame.getMostSpecificScopes(stackFrame.range);
    const scopesWithVariables = await Promise.all(
        scopes.map(async (scope) => ({ scope, variables: await scope.getChildren() })),
    );
    const stopLine = stackFrame.range.startLineNumber - 1;
    const wordLines = new WordLines(editor);
    const valuesPerLine = new Map<number, Map<string, string>>();
    for (const { scope, variables } of scopesWithVariables) {
        const startLine = Math.max(window.startLine, scope.range ? scope.range.startLineNumber - 1 : 0);
        const endLine = Math.min(window.endLine, stopLine);
        const nameValueMap = new Map<string, string>();
        for (const expr of variables) {
            nameValueMap.set(expr.name, expr.value);
            // Limit the size of map. Too large can have a perf impact
            if (nameValueMap.size >= MAX_NUM_INLINE_VALUES) break;
        }
        for (let line = startLine; line <= endLine; line++) {
            const content = editor.viewState.document.getLineContent(line);
            const names = [...new Set(wordLines.words(line))]
                .filter((name) => nameValueMap.has(name))
                .sort((first, second) => content.indexOf(first) - content.indexOf(second));
            if (names.length === 0) continue;
            let values = valuesPerLine.get(line);
            if (values === undefined) {
                values = new Map();
                valuesPerLine.set(line, values);
            }
            for (const name of names) {
                if (!values.has(name)) values.set(name, nameValueMap.get(name) ?? "");
            }
        }
    }
    const result = new Map<number, string>();
    for (const [line, values] of valuesPerLine) {
        result.set(line, [...values].map(([n, v]) => `${n} = ${v}`).join(", "));
    }
    return result;
}

/** Upstream `getWordToLineNumbersMap` for a line: the words of its code, not of its comments and strings. */
class WordLines {
    private readonly cache = new Map<number, readonly string[]>();

    public constructor(private readonly editor: IInlineValuesEditor) {}

    public words(line: number): readonly string[] {
        let words = this.cache.get(line);
        if (words === undefined) {
            words = this.compute(line);
            this.cache.set(line, words);
        }
        return words;
    }

    private compute(line: number): readonly string[] {
        const content = this.editor.viewState.document.getLineContent(line);
        // If line is too long then skip the line
        if (content.length > MAX_TOKENIZATION_LINE_LEN) return [];
        const tokenStore = this.editor.viewState.tokenStore;
        tokenStore?.forceTokenization(line);
        const lineTokens = tokenStore?.getLineTokens(line);
        // No tokens: the whole line is code.
        if (lineTokens === undefined) return wordsOf(content);
        const result: string[] = [];
        for (let tokenIndex = 0, tokenCount = lineTokens.getCount(); tokenIndex < tokenCount; tokenIndex++) {
            // Token is a word and not a comment
            if (lineTokens.getStandardTokenType(tokenIndex) !== StandardTokenType.Other) continue;
            result.push(
                ...wordsOf(
                    content.substring(lineTokens.getStartOffset(tokenIndex), lineTokens.getEndOffset(tokenIndex)),
                ),
            );
        }
        return result;
    }
}

/**
 * Every word of a code token: upstream takes only the first, assuming a token per word — a language without a
 * grammar has the whole line in one token.
 */
function wordsOf(code: string): string[] {
    return code.match(new RegExp(DEFAULT_WORD_REGEXP.source, "g")) ?? [];
}

/** One line, as a message after a line's end must be; upstream's `...` past its length. */
function inlineText(text: string): string {
    // eslint-disable-next-line no-control-regex -- the control characters are what is replaced
    const oneLine = text.replace(/[\u0000-\u001f\u007f]/g, " ");
    return oneLine.length > MAX_INLINE_DECORATOR_LENGTH
        ? `${oneLine.substring(0, MAX_INLINE_DECORATOR_LENGTH)}...`
        : oneLine;
}

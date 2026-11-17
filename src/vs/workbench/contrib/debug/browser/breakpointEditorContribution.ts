/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/breakpointEditorContribution.ts
// Upstream's `BreakpointEditorContribution` and `CallStackEditorContribution` over every text editor of the tabs: the
// breakpoints' glyphs in the glyph lane by kind and state, the glyph lane's clicks, the breakpoints riding their
// lines through edits (sent to the adapters on save), and the stopped threads' top and focused frames — the line's
// background and the frame's glyph, the combined glyph on a line with a breakpoint. Deviations: the lane has one
// cell, so one glyph per line (a frame wins over a breakpoint, the first breakpoint of the line over the others);
// the combined glyph is upstream's `debug-stackframe-active` in the frame's color (upstream draws the breakpoint's
// dot over the frame's arrow); the lane is there only in a file where breakpoints can be set or that has glyphs
// (upstream's glyph margin is always on); the condition, the log message and the trigger are typed in a quick input
// (decision 2026-11-14, the breakpoint widget comes with conditions and logpoints), so is the "lose the condition?" question a modal message;
// an inline breakpoint and a candidate location (`debug.showInlineBreakpointCandidates`) are a glyph cell before
// their column that a click does not reach (upstream's `InlineBreakpointWidget` toggles on a click and has a context
// menu: here Shift+F9 at the column does it); no hint glyph on hover, no hover messages, no gutter context menu, no
// column of the stack frame (the `debug-top-stack-frame-column` decoration).

import { distinct } from "../../../../base/common/arrays.ts";
import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { firstNonWhitespaceIndex, lastNonWhitespaceIndex } from "../../../../base/common/strings.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { createRange, type IRange, rangesEqual } from "../../../../editor/common/core/iRange.ts";
import type {
    IGlyphMarginClick,
    IGlyphMarginDecoration,
    ILineHighlightDecoration,
} from "../../../../editor/common/model/iGlyphMarginDecoration.ts";
import type { IInlineInsertion } from "../../../../editor/common/model/iInlineInsertion.ts";
import type { ITextDocument } from "../../../../editor/common/model/iTextDocument.ts";
import { TrackedRangeStickiness } from "../../../../editor/common/model/trackedDecorations.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { IBreakpoint, IBreakpointUpdateData, IDebugService, IStackFrame } from "../common/debug.ts";

import { type BreakpointInput, BreakpointInputDIToken, BreakpointWidgetContext } from "./breakpointInput.ts";
import { breakpointIconColor, getBreakpointIcon } from "./breakpointsView.ts";
import { DebugServiceDIToken } from "./debugService.ts";

/** The owner of the debugger's glyphs in the editors' glyph lanes. */
export const DEBUG_GLYPH_OWNER = "debug";

/** Upstream's `zIndex` of the breakpoint and stack frame glyphs: over another owner's glyph of the line. */
const DEBUG_GLYPH_Z_INDEX = 9999;

const TOP_STACK_FRAME_BACKGROUND = "editor.stackFrameHighlightBackground";
const FOCUSED_STACK_FRAME_BACKGROUND = "editor.focusedStackFrameHighlightBackground";

/** `TextEditorPane` matches structurally; the DI module does the binding. */
export interface IBreakpointEditor {
    readonly uri: Uri;
    readonly languageId: string;
    readonly viewState: {
        readonly document: Pick<
            ITextDocument,
            "deltaDecorations" | "getDecorationRange" | "lineCount" | "getLineContent"
        >;
    };
    setGlyphMarginDecorations(owner: string, decorations: readonly IGlyphMarginDecoration[]): void;
    setGlyphMarginReserved(reserved: boolean): void;
    setLineHighlightDecorations(decorations: readonly ILineHighlightDecoration[]): void;
    setOwnedInlineInsertions(owner: string, insertions: readonly IInlineInsertion[]): void;
    onDidClickGlyphMargin(listener: (click: IGlyphMarginClick) => void): IDisposable;
    onDidChangeContent(listener: () => void): IDisposable;
    onDidChangeLanguage(listener: () => void): IDisposable;
}

export interface IBreakpointEditorSource {
    /** The tabs' text editors of every group. */
    getEditors(): readonly IBreakpointEditor[];
    onDidChangeEditors(listener: () => void): IDisposable;
}

export const BreakpointEditorSourceDIToken = token<IBreakpointEditorSource>("BreakpointEditorSource");
export const BreakpointEditorContributionDIToken = token<BreakpointEditorContribution>("BreakpointEditorContribution");

/** Upstream `IBreakpointDecoration`: the tracked document decoration a breakpoint rides its line with. */
interface IBreakpointDecoration {
    readonly decorationId: string;
    readonly breakpoint: IBreakpoint;
    range: IRange;
}

interface IAttachedEditor {
    readonly editor: IBreakpointEditor;
    readonly subscriptions: readonly IDisposable[];
    breakpointDecorations: readonly IBreakpointDecoration[];
    /** The glyphs of the candidate locations, from the last answer of the adapter. */
    candidates: readonly IInlineInsertion[];
    /** A later request for the candidates wins over an earlier one still waiting for the adapter. */
    candidatesGeneration: number;
}

/** Upstream `BreakpointsForLine`. */
interface IBreakpointsForLine {
    readonly lineNumber: number;
    readonly positions: readonly { readonly lineNumber: number; readonly column: number }[];
}

/** The glyph and the highlight of a stack frame shown in an editor (upstream `createDecorationsForStackFrame`). */
interface IStackFrameDecoration {
    /** 0-based. */
    readonly line: number;
    readonly top: boolean;
    /** The frame's session is the focused one: only then the frame has a glyph. */
    readonly glyph: boolean;
}

export class BreakpointEditorContribution extends Disposable {
    public static dependencies = [
        BreakpointEditorSourceDIToken,
        DebugServiceDIToken,
        IConfigurationServiceDIToken,
        ProductIconServiceDIToken,
        BreakpointInputDIToken,
    ] as const;

    private readonly attached = new Map<IBreakpointEditor, IAttachedEditor>();
    private refreshQueued = false;

    public constructor(
        private readonly editors: IBreakpointEditorSource,
        private readonly debugService: IDebugService,
        private readonly configuration: Pick<IConfigurationService, "get" | "onDidChangeConfiguration">,
        private readonly icons: Pick<IProductIconService, "codicon" | "onDidChange">,
        private readonly input: BreakpointInput,
    ) {
        super();
        const model = debugService.getModel();
        const queueRefresh = (): void => {
            this.queueRefresh();
        };
        this.register(
            editors.onDidChangeEditors(() => {
                this.syncEditors();
            }),
        );
        this.register(model.onDidChangeBreakpoints(queueRefresh));
        this.register(model.onDidChangeCallStack(queueRefresh));
        this.register(debugService.getViewModel().onDidFocusStackFrame(queueRefresh));
        // We need to update breakpoint decorations when state changes since the top stack frame and breakpoint
        // decoration might change
        this.register(debugService.onDidChangeState(queueRefresh));
        this.register(debugService.getAdapterManager().onDidChangeCanSetBreakpoints(queueRefresh));
        this.register(icons.onDidChange(queueRefresh));
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                if (
                    event.affectsConfiguration("debug.showBreakpointsInOverviewRuler") ||
                    event.affectsConfiguration("debug.showInlineBreakpointCandidates") ||
                    event.affectsConfiguration("debug.allowBreakpointsEverywhere")
                ) {
                    this.queueRefresh();
                }
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
                    editor.onDidClickGlyphMargin((click) => {
                        this.onGlyphMarginClick(state, click).catch(onUnexpectedError);
                    }),
                    editor.onDidChangeContent(() => {
                        this.onModelDecorationsChanged(state);
                    }),
                    editor.onDidChangeLanguage(() => {
                        this.refresh(state);
                    }),
                ],
                breakpointDecorations: [],
                candidates: [],
                candidatesGeneration: 0,
            };
            this.attached.set(editor, state);
            this.refresh(state);
        }
    }

    private detach(state: IAttachedEditor): void {
        for (const subscription of state.subscriptions) subscription.dispose();
        state.editor.viewState.document.deltaDecorations(
            state.breakpointDecorations.map((decoration) => decoration.decorationId),
            [],
        );
        state.editor.setOwnedInlineInsertions(DEBUG_GLYPH_OWNER, []);
        this.attached.delete(state.editor);
    }

    /** Upstream's `setDecorationsScheduler`: a batch of model events redraws once. */
    private queueRefresh(): void {
        if (this.refreshQueued) return;
        this.refreshQueued = true;
        queueMicrotask(() => {
            this.refreshQueued = false;
            for (const state of this.attached.values()) this.refresh(state);
        });
    }

    /** Upstream `setDecorations` and `createCallStackDecorations`. */
    private refresh(state: IAttachedEditor): void {
        const { editor } = state;
        const document = editor.viewState.document;
        const model = this.debugService.getModel();
        const breakpoints = model
            .getBreakpoints({ uri: editor.uri })
            .filter((breakpoint) => breakpoint.lineNumber <= document.lineCount);
        const ranges = breakpoints.map((breakpoint) => breakpointRange(document, breakpoint));
        const ids = document.deltaDecorations(
            state.breakpointDecorations.map((decoration) => decoration.decorationId),
            ranges.map((range) => ({
                range,
                options: {
                    // Stryker disable next-line StringLiteral: the description is for debugging only, as in upstream
                    description: "breakpoint-decoration",
                    stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                },
            })),
        );
        state.breakpointDecorations = breakpoints.map((breakpoint, index) => ({
            decorationId: ids[index],
            breakpoint,
            range: ranges[index],
        }));

        const frames = this.stackFrameDecorations(editor.uri, document.lineCount);
        editor.setLineHighlightDecorations(
            frames.map(({ line, top }) => ({
                key: `${top ? "top" : "focused"}:${String(line)}`,
                line,
                colorToken: top ? TOP_STACK_FRAME_BACKGROUND : FOCUSED_STACK_FRAME_BACKGROUND,
            })),
        );
        editor.setGlyphMarginDecorations(DEBUG_GLYPH_OWNER, this.glyphs(breakpoints, frames));
        editor.setGlyphMarginReserved(
            this.debugService.getAdapterManager().hasEnabledDebuggers() &&
                this.debugService.canSetBreakpointsIn(editor.languageId),
        );
        this.publishInlineGlyphs(state);
        this.requestCandidates(state).catch(onUnexpectedError);
    }

    /** The inline breakpoints' glyphs, then the candidates' at the columns no inline breakpoint takes. */
    private publishInlineGlyphs(state: IAttachedEditor): void {
        const model = this.debugService.getModel();
        const inline = state.breakpointDecorations
            .filter((decoration) => this.rendersInline(state, decoration))
            .map((decoration) =>
                this.inlineGlyph(
                    decoration.range.start,
                    getBreakpointIcon(this.debugService.state, model.areBreakpointsActivated(), decoration.breakpoint, model),
                ),
            );
        state.editor.setOwnedInlineInsertions(DEBUG_GLYPH_OWNER, [...inline, ...state.candidates]);
    }

    private inlineGlyph(position: { line: number; character: number }, icon: string): IInlineInsertion {
        return {
            line: position.line,
            offset: position.character,
            text: this.icons.codicon(icon),
            colorToken: breakpointIconColor(icon),
            // The terminal's block caret stays on the character, not on the glyph.
            caretSide: "right",
        };
    }

    /**
     * Upstream's `renderInline`: a column breakpoint shows before its column when the line has other breakpoints or
     * the column is past the line's first non-whitespace character.
     */
    private rendersInline(state: IAttachedEditor, decoration: IBreakpointDecoration): boolean {
        const { breakpoint } = decoration;
        if (!breakpoint.column) return false;
        const hasOtherBreakpointsOnLine = state.breakpointDecorations.some(
            (other) => other !== decoration && other.breakpoint.lineNumber === breakpoint.lineNumber,
        );
        const content = state.editor.viewState.document.getLineContent(breakpoint.lineNumber - 1);
        return hasOtherBreakpointsOnLine || breakpoint.column > firstNonWhitespaceIndex(content) + 1;
    }

    /**
     * Upstream `requestBreakpointCandidateLocations`: with `debug.showInlineBreakpointCandidates`, the focused
     * session's breakpoint locations on the lines with breakpoints.
     */
    private async requestCandidates(state: IAttachedEditor): Promise<void> {
        const generation = ++state.candidatesGeneration;
        const session = this.debugService.getViewModel().focusedSession;
        const lineNumbers = distinct(state.breakpointDecorations.map((decoration) => decoration.range.start.line + 1));
        let lineBreakpoints: IBreakpointsForLine[] = [];
        if (
            this.configuration.get("debug.showInlineBreakpointCandidates") &&
            session?.capabilities.supportsBreakpointLocationsRequest &&
            lineNumbers.length > 0
        ) {
            const uri = state.editor.uri;
            lineBreakpoints = await Promise.all(
                lineNumbers.map(async (lineNumber) => {
                    try {
                        return { lineNumber, positions: await session.breakpointsLocations(uri, lineNumber) };
                    } catch {
                        return { lineNumber, positions: [] };
                    }
                }),
            );
        }
        if (generation !== state.candidatesGeneration || !this.attached.has(state.editor)) return;
        state.candidates = this.candidateGlyphs(state, lineBreakpoints);
        this.publishInlineGlyphs(state);
    }

    /** Upstream `createCandidateDecorations`. */
    private candidateGlyphs(state: IAttachedEditor, lineBreakpoints: readonly IBreakpointsForLine[]): IInlineInsertion[] {
        const model = this.debugService.getModel();
        const document = state.editor.viewState.document;
        const result: IInlineInsertion[] = [];
        for (const { positions, lineNumber } of lineBreakpoints) {
            if (lineNumber > document.lineCount) continue;
            const content = document.getLineContent(lineNumber - 1);
            // Upstream's 1-based columns: of the first non-whitespace character, after the last one.
            const firstColumn = firstNonWhitespaceIndex(content) + 1;
            const lastColumn = lastNonWhitespaceIndex(content) + 2;
            for (const p of positions) {
                // Do not render candidates on the start of the line if there's no other breakpoint on the line.
                if (
                    (p.column <= firstColumn &&
                        !state.breakpointDecorations.some(
                            (bp) => bp.range.start.character + 1 > firstColumn && bp.range.start.line + 1 === p.lineNumber,
                        )) ||
                    p.column > lastColumn
                ) {
                    continue;
                }

                const breakpointAtPosition = state.breakpointDecorations.find(
                    (bpd) => bpd.range.start.line + 1 === p.lineNumber && bpd.range.start.character + 1 === p.column,
                );
                // Space already occupied, do not render candidate.
                if (breakpointAtPosition && this.rendersInline(state, breakpointAtPosition)) continue;
                const icon = breakpointAtPosition
                    ? getBreakpointIcon(
                          this.debugService.state,
                          model.areBreakpointsActivated(),
                          breakpointAtPosition.breakpoint,
                          model,
                      )
                    : "debug-breakpoint-disabled";
                result.push(this.inlineGlyph({ line: p.lineNumber - 1, character: p.column - 1 }, icon));
            }
        }
        return result;
    }

    /** One glyph per line: a frame's (combined with a breakpoint of the line), else the line's first breakpoint's. */
    private glyphs(
        breakpoints: readonly IBreakpoint[],
        frames: readonly IStackFrameDecoration[],
    ): IGlyphMarginDecoration[] {
        const model = this.debugService.getModel();
        const state = this.debugService.state;
        const activated = model.areBreakpointsActivated();
        const showInRuler = this.configuration.get("debug.showBreakpointsInOverviewRuler");
        const byLine = new Map<number, IGlyphMarginDecoration>();
        /** The icon of the breakpoint drawn on a line. */
        const iconByLine = new Map<number, string>();
        for (const breakpoint of breakpoints) {
            const line = breakpoint.lineNumber - 1;
            if (iconByLine.has(line)) continue;
            const icon = getBreakpointIcon(state, activated, breakpoint, model);
            iconByLine.set(line, icon);
            byLine.set(line, {
                key: breakpoint.getId(),
                line,
                glyph: this.icons.codicon(icon),
                colorToken: breakpointIconColor(icon),
                overviewRulerColorToken: showInRuler ? "debugIcon.breakpointForeground" : undefined,
                zIndex: DEBUG_GLYPH_Z_INDEX,
            });
        }
        for (const { line, top, glyph } of frames) {
            if (!glyph) continue;
            // Upstream's CSS puts the breakpoint's dot over the frame's arrow only for these two icons.
            const icon = iconByLine.get(line);
            const combined = icon === "debug-breakpoint" || icon === "debug-breakpoint-conditional";
            byLine.set(line, {
                key: top ? "top-stack-frame" : "focused-stack-frame",
                line,
                glyph: this.icons.codicon(
                    combined ? "debug-stackframe-active" : top ? "debug-stackframe" : "debug-stackframe-focused",
                ),
                colorToken: top
                    ? "debugIcon.breakpointCurrentStackframeForeground"
                    : "debugIcon.breakpointStackframeForeground",
                overviewRulerColorToken: top ? TOP_STACK_FRAME_BACKGROUND : FOCUSED_STACK_FRAME_BACKGROUND,
                zIndex: DEBUG_GLYPH_Z_INDEX,
            });
        }
        return [...byLine.values()];
    }

    /**
     * Upstream `createCallStackDecorations`: of every stopped thread the top frame, and the focused frame when it is
     * another one, in this file; only the focused session's frames have a glyph.
     */
    private stackFrameDecorations(uri: Uri, lineCount: number): IStackFrameDecoration[] {
        const focusedStackFrame = this.debugService.getViewModel().focusedStackFrame;
        const key = uri.toString();
        const result = new Map<string, IStackFrameDecoration>();
        for (const session of this.debugService.getModel().getSessions()) {
            const isSessionFocused = session === focusedStackFrame?.thread.session;
            for (const thread of session.getAllThreads()) {
                if (!thread.stopped) continue;
                const callStack = thread.getCallStack();
                const stackFrames: IStackFrame[] = [];
                if (callStack.length > 0) {
                    // Always decorate top stack frame, and decorate focused stack frame if it is not the top stack frame
                    if (focusedStackFrame && !focusedStackFrame.equals(callStack[0])) {
                        stackFrames.push(focusedStackFrame);
                    }
                    stackFrames.push(callStack[0]);
                }
                for (const frame of stackFrames) {
                    if (frame.source.uri.toString() !== key) continue;
                    const lineNumber = frame.range.startLineNumber;
                    if (lineNumber > lineCount || lineNumber < 1) continue;
                    const top = frame.getId() === frame.thread.getTopStackFrame()?.getId();
                    const decoration = { line: lineNumber - 1, top, glyph: isSessionFocused };
                    // Deduplicate same decorations so colors do not stack #109045
                    const dedupKey = `${String(top)} ${String(decoration.line)}`;
                    const existing = result.get(dedupKey);
                    // Stryker disable next-line LogicalOperator: `||` differs only when neither has a glyph, and then the decorations are equal
                    if (existing === undefined || (!existing.glyph && decoration.glyph))
                        result.set(dedupKey, decoration);
                }
            }
        }
        return [...result.values()];
    }

    /** Upstream `onModelDecorationsChanged`: the breakpoints follow their decorations, sent on save. */
    private onModelDecorationsChanged(state: IAttachedEditor): void {
        const document = state.editor.viewState.document;
        let somethingChanged = false;
        for (const decoration of state.breakpointDecorations) {
            // Only this class removes its decorations.
            const range = assertReturnsDefined(document.getDecorationRange(decoration.decorationId));
            if (!rangesEqual(range, decoration.range)) {
                somethingChanged = true;
                decoration.range = range;
            }
        }
        if (!somethingChanged) {
            // A deleted line takes its glyph with it while the breakpoint's decoration collapses onto the next line
            // (upstream's breakpoint moves there): the glyphs are drawn again where the breakpoints are.
            if (state.breakpointDecorations.length > 0) this.refresh(state);
            return;
        }

        const data = new Map<string, IBreakpointUpdateData>();
        for (const { breakpoint, range } of state.breakpointDecorations) {
            data.set(breakpoint.getId(), {
                lineNumber: range.start.line + 1,
                column: breakpoint.column ? range.start.character + 1 : undefined,
            });
        }
        this.debugService.updateBreakpoints(state.editor.uri, data, true).catch(onUnexpectedError);
    }

    /** Upstream's `onMouseDown` on the glyph margin. */
    private async onGlyphMarginClick(state: IAttachedEditor, click: IGlyphMarginClick): Promise<void> {
        if (!this.debugService.getAdapterManager().hasEnabledDebuggers()) {
            return;
        }
        // Another owner's glyph is its click (upstream `marginFreeFromNonDebugDecorations`); a right click is the
        // gutter's context menu.
        if ((click.owner !== undefined && click.owner !== DEBUG_GLYPH_OWNER) || click.button === "right") {
            return;
        }
        const { editor } = state;
        const canSetBreakpoints = this.debugService.canSetBreakpointsIn(editor.languageId);
        const lineNumber = click.line + 1;
        const uri = editor.uri;
        const breakpoints = this.debugService.getModel().getBreakpoints({ uri, lineNumber });

        if (breakpoints.length) {
            const enabled = breakpoints.some((bp) => bp.enabled);

            if (click.altKey) {
                // Alt+click on existing breakpoint opens the breakpoint widget for editing
                await this.input.show(uri, breakpoints[0].lineNumber, breakpoints[0].column);
            } else if (click.shiftKey) {
                await Promise.all(breakpoints.map((bp) => this.debugService.enableOrDisableBreakpoints(!enabled, bp)));
            } else if (
                breakpoints.some((bp) => !!bp.condition || !!bp.logMessage || !!bp.hitCondition || !!bp.triggeredBy)
            ) {
                // Show the dialog if there is a potential condition to be accidently lost.
                await this.input.confirmRemoval(breakpoints, enabled);
            } else if (!enabled) {
                await Promise.all(breakpoints.map((bp) => this.debugService.enableOrDisableBreakpoints(!enabled, bp)));
            } else {
                await Promise.all(breakpoints.map((bp) => this.debugService.removeBreakpoints(bp.getId())));
            }
        } else if (canSetBreakpoints) {
            if (click.altKey) {
                // Alt+click on empty gutter opens the breakpoint widget for adding a conditional breakpoint
                await this.input.show(uri, lineNumber, undefined, BreakpointWidgetContext.CONDITION);
            } else if (click.button === "middle") {
                const action = this.configuration.get("debug.gutterMiddleClickAction");
                if (action !== "none") {
                    await this.input.show(uri, lineNumber, undefined, MIDDLE_CLICK_CONTEXTS[action]);
                }
            } else {
                await this.debugService.addBreakpoints(uri, [{ lineNumber }]);
            }
        }
    }
}

const MIDDLE_CLICK_CONTEXTS = {
    logpoint: BreakpointWidgetContext.LOG_MESSAGE,
    conditionalBreakpoint: BreakpointWidgetContext.CONDITION,
    triggeredBreakpoint: BreakpointWidgetContext.TRIGGER_POINT,
} as const;

/** Upstream's decoration range: a column breakpoint's column, else the line's first non-whitespace character. */
function breakpointRange(document: Pick<ITextDocument, "getLineContent">, breakpoint: IBreakpoint): IRange {
    const line = breakpoint.lineNumber - 1;
    const content = document.getLineContent(line);
    const column = breakpoint.column ? breakpoint.column - 1 : Math.max(0, firstNonWhitespaceIndex(content));
    // Decoration has to have a width #20688; the document clamps it to the line.
    return createRange(line, column, line, Math.min(column + 1, content.length));
}

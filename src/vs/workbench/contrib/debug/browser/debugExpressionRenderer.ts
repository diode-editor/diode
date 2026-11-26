/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugExpressionRenderer.ts
// `renderVariable`/`renderValue` as colored spans of a tree row; the colors are upstream's `debugColors.ts` rules for
// `.expression .name/.type/.value.<kind>/.error`, `.unavailable` is italic. Deviations: the name and the value are
// split by `: ` (the approved look of the debug views spike, upstream writes `name =`); a changed value keeps its
// highlight for one second as a background (`debugView.valueChangedHighlight`, the spike's look of upstream's fading
// animation), not until the next render; a lazy value carries the eye glyph after the name. Not here yet: links in
// values (`LinkDetector`), ANSI-styled values, the hover with Copy Value (#1150). Not planned: debug visualizers.

import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";

import { codicon } from "../../../../base/common/codicons.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import type { IRowSpan } from "../../../browser/parts/views/lazyTreeControl.ts";
import type { IExpression, IExpressionValue } from "../common/debug.ts";
import { Expression, Variable } from "../common/debugModel.ts";
import { ReplEvaluationResult } from "../common/replModel.ts";

const MAX_VALUE_RENDER_LENGTH_IN_VIEWLET = 1024;
/** How long a changed value stays highlighted: upstream's `debugViewletValueChanged` animation. */
export const VALUE_CHANGED_HIGHLIGHT_MS = 1000;
const LAZY_ICON = codicon("eye");

const booleanRegex = /^(true|false)$/i;
const stringRegex = /^(['"]).*\1$/;

export interface IRenderValueOptions {
    readonly showChanged?: boolean;
    readonly colorize?: boolean;
}

/** What the renderer asks of its view: the setting, the glyphs, and a rerender once a highlight is over. */
export interface IDebugExpressionRendererHost {
    readonly icons: Pick<IProductIconService, "glyph">;
    showVariableTypes(): boolean;
    /** A highlighted value went back to its own color. */
    onHighlightsExpired(): void;
}

function isAvailable(expression: IExpressionValue): boolean {
    return (
        !(
            expression instanceof Expression ||
            expression instanceof Variable ||
            expression instanceof ReplEvaluationResult
        ) || expression.available
    );
}

/** Upstream's color classes of a value, as the theme color of the class. */
function valueColor(expression: IExpressionValue, value: string, colorize: boolean): StyleColor {
    if (!colorize) return "debugTokenExpression.value";
    if (expression.type === "number") return "debugTokenExpression.number";
    if (expression.type === "boolean") return "debugTokenExpression.boolean";
    if (expression.type === "string") return "debugTokenExpression.string";
    if (!isNaN(Number(value))) return "debugTokenExpression.number";
    if (booleanRegex.test(value)) return "debugTokenExpression.boolean";
    if (stringRegex.test(value)) return "debugTokenExpression.string";
    return "debugTokenExpression.value";
}

export class DebugExpressionRenderer {
    /** Ids of the expressions whose changed value is highlighted now. */
    private readonly highlighted = new Set<string>();
    private highlightTimer: ReturnType<typeof setTimeout> | undefined;

    public constructor(private readonly host: IDebugExpressionRendererHost) {}

    public dispose(): void {
        clearTimeout(this.highlightTimer);
    }

    /** Upstream `renderVariable`: `name: value`, or `name: type = value` with `debug.showVariableTypes`. */
    public renderVariable(variable: IExpression, options: IRenderValueOptions = {}): IRowSpan[] {
        const spans: IRowSpan[] = [];
        if (isAvailable(variable)) {
            spans.push({ text: variable.name, fg: "debugTokenExpression.name" });
            if (variable.value) {
                spans.push({ text: ": " });
                if (variable.type && this.host.showVariableTypes()) {
                    spans.push({ text: variable.type, fg: "debugTokenExpression.type" }, { text: " = " });
                }
            }
        } else if (variable.value && variable.name) {
            spans.push({ text: ": " });
        }
        if (variable.presentationHint?.lazy) {
            spans.push({ text: `${this.host.icons.glyph(LAZY_ICON)} `, fg: "textLink.foreground" });
        }
        return [...spans, ...this.renderValue(variable, { showChanged: options.showChanged, colorize: true })];
    }

    /** Upstream `WatchExpressionsRenderer.renderExpression`: the expression as typed, then its value. */
    public renderWatchExpression(expression: IExpression): IRowSpan[] {
        // Upstream checks `typeof value === 'string'`: an expression's value always is.
        const spans: IRowSpan[] = [{ text: expression.name, fg: "debugTokenExpression.name" }, { text: ": " }];
        if (expression.type && this.host.showVariableTypes()) {
            spans.push({ text: expression.type, fg: "debugTokenExpression.type" }, { text: " = " });
        }
        return [...spans, ...this.renderValue(expression, { showChanged: true, colorize: true })];
    }

    /** Upstream `renderValue` without links and ANSI. */
    public renderValue(expression: IExpressionValue, options: IRenderValueOptions = {}): IRowSpan[] {
        let value = expression.value;
        let span: { fg: StyleColor; bg?: StyleColor; style?: StyleFlags };
        if (!isAvailable(expression)) {
            span = {
                fg: value === Expression.DEFAULT_VALUE ? "debugTokenExpression.value" : "debugTokenExpression.error",
                style: StyleFlags.Italic,
            };
        } else if (options.showChanged === true && this.isHighlighted(expression)) {
            // value changed color has priority over other colors.
            span = { fg: "editor.background", bg: "debugView.valueChangedHighlight" };
        } else {
            span = { fg: valueColor(expression, value, options.colorize === true) };
        }
        if (value.length > MAX_VALUE_RENDER_LENGTH_IN_VIEWLET) {
            value = value.substring(0, MAX_VALUE_RENDER_LENGTH_IN_VIEWLET) + "...";
        }
        return value === "" ? [] : [{ text: value, ...span }];
    }

    /**
     * Upstream resets `valueChanged` on the first render; the highlight holds until a second has passed since the
     * latest one began.
     */
    private isHighlighted(expression: IExpressionValue): boolean {
        if (!(expression instanceof Expression || expression instanceof Variable)) return false;
        const id = expression.getId();
        if (expression.valueChanged && expression.value !== Expression.DEFAULT_VALUE) {
            expression.valueChanged = false;
            this.highlighted.add(id);
            this.scheduleExpiry();
        }
        return this.highlighted.has(id);
    }

    /** One timer from the latest highlight: it ends last, so every highlight is over when it fires. */
    private scheduleExpiry(): void {
        clearTimeout(this.highlightTimer);
        this.highlightTimer = setTimeout(() => {
            this.highlighted.clear();
            this.host.onHighlightsExpired();
        }, VALUE_CHANGED_HIGHLIGHT_MS);
    }
}

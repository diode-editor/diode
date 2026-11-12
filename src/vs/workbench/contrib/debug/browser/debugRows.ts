import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { HFlexElement, hflexFill, hflexFit } from "@tuidom/elements/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { IDebugValue, ValueKind } from "../common/debugStubModel.ts";

/** SPIKE: row builders of the debug views — a label of styled spans, optionally with a right-aligned part. */

export interface ISpan {
    readonly text: string;
    readonly fg?: StyleColor;
    readonly bg?: StyleColor;
    readonly italic?: boolean;
    readonly bold?: boolean;
}

export function spansLabel(spans: readonly ISpan[]): TextLabelElement {
    const label = new TextLabelElement(spans.map((s) => s.text).join(""));
    let offset = 0;
    for (const span of spans) {
        if (span.fg !== undefined || span.bg !== undefined || span.italic === true || span.bold === true) {
            for (let i = 0; i < span.text.length; i++) {
                label.setCharStyle(offset + i, {
                    ...(span.fg === undefined ? {} : { fg: span.fg }),
                    ...(span.bg === undefined ? {} : { bg: span.bg }),
                    ...(span.italic === true ? { style: StyleFlags.Italic } : {}),
                    ...(span.bold === true ? { style: StyleFlags.Bold } : {}),
                });
            }
        }
        offset += span.text.length;
    }
    return label;
}

/** A row with a part pinned to the right edge (upstream's line number of a frame or a breakpoint). */
export function splitRow(left: readonly ISpan[], right: readonly ISpan[]): TUIElement {
    const row = new HFlexElement();
    row.addChild(spansLabel(left), { width: hflexFill(), height: 1 });
    if (right.length > 0) row.addChild(spansLabel([...right, { text: " " }]), { width: hflexFit(), height: 1 });
    return row;
}

/** Upstream `renderExpressionValue`: the color by the kind of the value. */
export function valueColor(kind: ValueKind): StyleColor {
    switch (kind) {
        case "number":
            return "debugTokenExpression.number";
        case "string":
            return "debugTokenExpression.string";
        case "boolean":
            return "debugTokenExpression.boolean";
        case "error":
            return "debugTokenExpression.error";
        default:
            return "debugTokenExpression.value";
    }
}

/** Upstream `renderVariable`/`renderExpressionValue`: `name: value`, a scope or a chunk without a value. */
export function valueSpans(value: IDebugValue, highlightChanges: boolean): ISpan[] {
    if (value.isScope === true) return [{ text: value.name }];
    if (value.value === "") return [{ text: value.name, fg: "debugTokenExpression.name" }];
    const changed = highlightChanges && value.changed;
    return [
        { text: value.name, fg: "debugTokenExpression.name" },
        { text: ": " },
        {
            text: value.value,
            fg: changed ? "editor.background" : valueColor(value.kind),
            ...(changed ? { bg: "debugView.valueChangedHighlight" } : {}),
        },
    ];
}

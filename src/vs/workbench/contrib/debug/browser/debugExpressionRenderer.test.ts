import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IExpressionContainer } from "../common/debug.ts";
import { Expression, ExpressionContainer, Variable } from "../common/debugModel.ts";
import { ReplEvaluationResult } from "../common/replModel.ts";

import { DebugExpressionRenderer, VALUE_CHANGED_HIGHLIGHT_MS } from "./debugExpressionRenderer.ts";

const PARENT = new ExpressionContainer(undefined, undefined, 0, "parent") as IExpressionContainer;
let nextName = 0;

function variable(
    value: string,
    options: { name?: string; type?: string; lazy?: boolean; available?: boolean } = {},
): Variable {
    return new Variable(
        undefined,
        undefined,
        PARENT,
        0,
        options.name ?? `v${String(nextName++)}`,
        undefined,
        value,
        undefined,
        undefined,
        undefined,
        options.lazy === true ? { lazy: true } : undefined,
        options.type,
        undefined,
        options.available ?? true,
    );
}

function text(spans: readonly { text: string }[]): string {
    return spans.map((span) => span.text).join("");
}

describe("DebugExpressionRenderer", () => {
    let showTypes = false;
    let expired = 0;
    let renderer: DebugExpressionRenderer;

    beforeEach(() => {
        showTypes = false;
        expired = 0;
        renderer = new DebugExpressionRenderer({
            icons: { glyph: () => "◉" },
            showVariableTypes: () => showTypes,
            onHighlightsExpired: () => {
                expired++;
            },
        });
    });

    afterEach(() => {
        renderer.dispose();
        vi.useRealTimers();
    });

    it("a variable is `name: value`, the name and the value in their theme colors", () => {
        expect(renderer.renderVariable(variable("67", { name: "[5]" }))).toEqual([
            { text: "[5]", fg: "debugTokenExpression.name" },
            { text: ": " },
            { text: "67", fg: "debugTokenExpression.number" },
        ]);
    });

    it("the value color by the kind: the type first, then the text of the value", () => {
        const color = (value: string, type?: string): unknown =>
            renderer.renderValue(variable(value, { type }), { colorize: true })[0].fg;

        expect(color("x", "number")).toBe("debugTokenExpression.number");
        expect(color("x", "boolean")).toBe("debugTokenExpression.boolean");
        expect(color("x", "string")).toBe("debugTokenExpression.string");
        expect(color("-1.5", "double")).toBe("debugTokenExpression.number");
        expect(color("TRUE")).toBe("debugTokenExpression.boolean");
        expect(color("'a'")).toBe("debugTokenExpression.string");
        expect(color('"accumulator"')).toBe("debugTokenExpression.string");
        expect(color("\"a'")).toBe("debugTokenExpression.value");
        expect(color("{x:1.5, y:-2}", "Point")).toBe("debugTokenExpression.value");
        expect(color("x truex")).toBe("debugTokenExpression.value");
        // Without colorize everything is a plain value.
        expect(renderer.renderValue(variable("1"))[0].fg).toBe("debugTokenExpression.value");
    });

    it("debug.showVariableTypes: `name: type = value`, the type in its color; a variable without a type stays short", () => {
        showTypes = true;

        expect(text(renderer.renderVariable(variable("67", { name: "[5]", type: "int" })))).toBe("[5]: int = 67");
        expect(renderer.renderVariable(variable("67", { type: "int" }))[2]).toEqual({
            text: "int",
            fg: "debugTokenExpression.type",
        });
        expect(text(renderer.renderVariable(variable("67", { name: "n" })))).toBe("n: 67");
        showTypes = false;
        expect(text(renderer.renderVariable(variable("67", { name: "n", type: "int" })))).toBe("n: 67");
    });

    it("a variable without a value is its name alone (a chunk, an object without a summary)", () => {
        expect(renderer.renderVariable(variable("", { name: "[0..99]" }))).toEqual([
            { text: "[0..99]", fg: "debugTokenExpression.name" },
        ]);
    });

    it("an unavailable variable: the error in italic in the error color, without the name", () => {
        const spans = renderer.renderVariable(variable("Cannot read", { name: "x", available: false }));

        expect(spans).toEqual([
            { text: ": " },
            { text: "Cannot read", fg: "debugTokenExpression.error", style: StyleFlags.Italic },
        ]);
        expect(renderer.renderVariable(variable("Invalid", { name: "", available: false }))).toEqual([
            { text: "Invalid", fg: "debugTokenExpression.error", style: StyleFlags.Italic },
        ]);
        expect(renderer.renderVariable(variable("", { name: "x", available: false }))).toEqual([]);
    });

    it("a console evaluation that failed is an error in italic; one that succeeded has its value's color", async () => {
        const failed = new ReplEvaluationResult("foo + 1");
        // Without a session the model answers with the hint, as a failed evaluation.
        await failed.evaluateExpression("foo + 1", undefined, undefined, "repl");
        const succeeded = new ReplEvaluationResult("1");
        succeeded.value = "42";

        expect(renderer.renderValue(failed)).toEqual([
            { text: failed.value, fg: "debugTokenExpression.error", style: StyleFlags.Italic },
        ]);
        expect(renderer.renderValue(succeeded, { colorize: true })).toEqual([
            { text: "42", fg: "debugTokenExpression.number" },
        ]);
    });

    it("a lazy variable carries the eye after the name", () => {
        expect(text(renderer.renderVariable(variable("(...)", { name: "getter", lazy: true })))).toBe(
            "getter: ◉ (...)",
        );
        expect(renderer.renderVariable(variable("(...)", { lazy: true }))[2]).toEqual({
            text: "◉ ",
            fg: "textLink.foreground",
        });
    });

    it("a watch expression: `expression: value`, `not available` without a frame in italic, not as an error", () => {
        const expression = new Expression("total / count");

        expect(renderer.renderWatchExpression(expression)).toEqual([
            { text: "total / count", fg: "debugTokenExpression.name" },
            { text: ": " },
            { text: "not available", fg: "debugTokenExpression.value", style: StyleFlags.Italic },
        ]);
    });

    it("a watch expression shows its type with the setting; a new one without a name is an empty row", () => {
        const expression = new Expression("sum");
        expression.available = true;
        expression.value = "45";
        expression.type = "long";
        showTypes = true;

        expect(text(renderer.renderWatchExpression(expression))).toBe("sum: long = 45");
        expect(renderer.renderWatchExpression(expression)[2]).toEqual({
            text: "long",
            fg: "debugTokenExpression.type",
        });
        expression.type = undefined;
        expect(text(renderer.renderWatchExpression(expression))).toBe("sum: 45");
        expect(text(renderer.renderWatchExpression(new Expression("")))).toBe(": ");
    });

    it("a watch value is colored by its kind and highlighted for a second after it changes", () => {
        vi.useFakeTimers();
        const expression = new Expression("count");
        expression.available = true;
        expression.value = "3";

        expect(renderer.renderWatchExpression(expression)[2]).toEqual({ text: "3", fg: "debugTokenExpression.number" });
        expression.value = "4";
        expect(renderer.renderWatchExpression(expression)[2]).toEqual({
            text: "4",
            fg: "editor.background",
            bg: "debugView.valueChangedHighlight",
        });
    });

    it("a plain value, not a debug model object, is always available", () => {
        expect(renderer.renderValue({ value: "3" }, { colorize: true })).toEqual([
            { text: "3", fg: "debugTokenExpression.number" },
        ]);
    });

    it("a value longer than 1024 is cut with an ellipsis", () => {
        const [span] = renderer.renderValue(variable("x".repeat(1030)));

        expect(span.text).toBe("x".repeat(1024) + "...");
        expect(renderer.renderValue(variable("x".repeat(1024)))[0].text).toBe("x".repeat(1024));
    });

    it("a changed value is highlighted for a second from its first render, then its own color comes back", () => {
        vi.useFakeTimers();
        const changed = variable("1", { name: "sum" });
        changed.value = "2";
        expect(changed.valueChanged).toBe(true);

        const highlighted = { text: "2", fg: "editor.background", bg: "debugView.valueChangedHighlight" };
        expect(renderer.renderValue(changed, { showChanged: true })).toEqual([highlighted]);
        expect(changed.valueChanged).toBe(false);
        vi.advanceTimersByTime(VALUE_CHANGED_HIGHLIGHT_MS - 1);
        // A rerender within the second keeps it.
        expect(renderer.renderValue(changed, { showChanged: true })).toEqual([highlighted]);
        expect(expired).toBe(0);

        vi.advanceTimersByTime(1);

        expect(expired).toBe(1);
        expect(renderer.renderValue(changed, { showChanged: true, colorize: true })).toEqual([
            { text: "2", fg: "debugTokenExpression.number" },
        ]);
    });

    it("no highlight without showChanged, for a value that is not available, or for plain values", () => {
        const changed = variable("1", { name: "a" });
        changed.value = "2";

        expect(renderer.renderValue(changed)[0].bg).toBeUndefined();
        expect(changed.valueChanged).toBe(true);
        expect(renderer.renderValue({ value: "3", valueChanged: true }, { showChanged: true })[0].bg).toBeUndefined();
        const notAvailable = variable("1", { name: "b" });
        notAvailable.value = Expression.DEFAULT_VALUE;
        notAvailable.valueChanged = true;
        expect(renderer.renderValue(notAvailable, { showChanged: true })[0].bg).toBeUndefined();
    });

    it("highlights that end later keep the timer going; dispose stops it", () => {
        vi.useFakeTimers();
        const first = variable("1", { name: "first" });
        first.value = "2";
        renderer.renderValue(first, { showChanged: true });
        vi.advanceTimersByTime(500);
        const second = variable("1", { name: "second" });
        second.value = "2";
        renderer.renderValue(second, { showChanged: true });

        vi.advanceTimersByTime(VALUE_CHANGED_HIGHLIGHT_MS);
        expect(expired).toBe(1);
        expect(renderer.renderValue(first, { showChanged: true })[0].bg).toBeUndefined();
        expect(renderer.renderValue(second, { showChanged: true })[0].bg).toBeUndefined();

        const third = variable("1", { name: "third" });
        third.value = "2";
        renderer.renderValue(third, { showChanged: true });
        renderer.dispose();
        vi.advanceTimersByTime(VALUE_CHANGED_HIGHLIGHT_MS);
        expect(expired).toBe(1);
    });
});

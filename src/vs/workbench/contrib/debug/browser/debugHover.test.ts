import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type TestDebugService, testDebugService } from "../../../../../TestUtils/debugSessionFixture.ts";
import { type ITestFrame, testFrame, TestVariable } from "../../../../../TestUtils/debugViewsFixture.ts";
import { createMockDebugModel } from "../../../../../TestUtils/mockDebug.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { testLayoutService } from "../../../../../TestUtils/testLayoutService.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createPosition } from "../../../../editor/common/core/iPosition.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { type IExpression, State } from "../common/debug.ts";

import { VALUE_CHANGED_HIGHLIGHT_MS } from "./debugExpressionRenderer.ts";
import { DebugHoverWidget, type IDebugHoverEditor, ShowDebugHoverResult } from "./debugHover.ts";

/** One line per variable name: the cursor on line N is on the Nth name. */
function editorOver(line: string, anchored = true): IDebugHoverEditor {
    return {
        uri: Uri.file("/w/main.cpp"),
        languageId: "cpp",
        versionId: 1,
        getLineContent: () => line,
        getCaretAnchor: () => (anchored ? { screenX: 2, screenY: 20, preferBelow: true } : null),
    };
}

/** A frame of a session that has no evaluate for hovers: the hover looks the names up in the scopes. */
function testFrameWithScopes(scopes: Parameters<typeof testFrame>[0]): ITestFrame {
    const frame = testFrame(scopes);
    Object.assign(frame.thread, { session: { capabilities: {} } });
    return frame;
}

function frameWith(variables: readonly IExpression[]): ITestFrame {
    return testFrameWithScopes([{ name: "Locals", variables }]);
}

describe("DebugHoverWidget", () => {
    const disposables = new DisposableStore();
    let debugService: TestDebugService;
    let widget: DebugHoverWidget;
    let app: TestApp;
    let body: BodyElement;
    let features: LanguageFeaturesService;
    let states: Emitter<State>;

    beforeEach(() => {
        states = disposables.add(new Emitter<State>());
        debugService = testDebugService(createMockDebugModel(disposables));
        Object.assign(debugService, { onDidChangeState: states.event });
        body = new BodyElement();
        features = new LanguageFeaturesService();
        app = TestApp.create(body, new Size(80, 30));
        widget = disposables.add(
            new DebugHoverWidget(
                debugService,
                features,
                NULL_CONFIGURATION_SERVICE,
                new StaticProductIconService(false),
                testLayoutService(body),
            ),
        );
    });

    afterEach(() => {
        disposables.clear();
        debugService.viewModel.dispose();
        vi.useRealTimers();
    });

    function screen(): string {
        app.render();
        return app.backend.screenToString();
    }

    /** The rows of the hover's box, its borders included. */
    function boxRows(): string[] {
        return screen()
            .split("\n")
            .map((row) => row.trim())
            .filter((row) => /^[╭│├╰]/u.test(row));
    }

    /** The cell of the first `text` on the screen. */
    function cellOf(text: string): Point {
        const rows = screen().split("\n");
        const y = rows.findIndex((row) => row.includes(text));
        return new Point(rows[y].indexOf(text), y);
    }

    async function show(variable: IExpression): Promise<ShowDebugHoverResult | undefined> {
        return widget.showAt(editorOver(variable.name), createPosition(0, 0), frameWith([variable]));
    }

    it("lives on the overlay layer as #debugHoverWidget, the id the inspector and e2e look for", () => {
        expect(body.overlayLayer.querySelector("#debugHoverWidget")).toBe(widget.view);
    });

    it("closing the hover cancels the request on its way: it does not open afterwards", async () => {
        let release: (children: IExpression[]) => void = () => undefined;
        const slow = new TestVariable("slow", "{...}", [new TestVariable("x", "1")]);
        const frame = frameWith([slow, new TestVariable("count", "7")]);
        await widget.showAt(editorOver("count"), createPosition(0, 1), frame);
        vi.spyOn(slow, "getChildren").mockReturnValue(
            new Promise((resolve) => {
                release = resolve;
            }),
        );

        const pending = widget.showAt(editorOver("slow"), createPosition(0, 1), frame);
        await flushMicrotasks(20);
        app.sendKey("Escape");
        release([new TestVariable("x", "1")]);

        expect(await pending).toBe(ShowDebugHoverResult.CANCELLED);
        expect(widget.isVisible()).toBe(false);
    });

    it("an extension's expression is looked up by its parts, spaces and empty parts aside", async () => {
        features.evaluatableExpressionProvider.register("*", {
            provideEvaluatableExpression: () =>
                Promise.resolve({
                    range: { start: createPosition(0, 0), end: createPosition(0, 1) },
                    expression: " p . .x ",
                }),
        });
        const frame = frameWith([new TestVariable("p", "{...}", [new TestVariable("x", "1.5")])]);

        await widget.showAt(editorOver("p"), createPosition(0, 0), frame);

        expect(screen()).toMatch(/│1\.5 *│/u);
    });

    it("Enter on a lazy child evaluates it and the hover opens its children", async () => {
        const getter = new TestVariable("getter", "(...)", [new TestVariable("a", "1")], { lazy: { value: "{a}" } });
        const frame = frameWith([new TestVariable("obj", "{...}", [getter])]);

        await widget.showAt(editorOver("obj"), createPosition(0, 1), frame);
        expect(screen()).toContain("getter: ◉ (...)");

        app.sendKey("Enter");
        await flushMicrotasks(20);

        expect(screen()).toContain("getter: {a}");
        expect(screen()).toContain("a: 1");
    });

    it("Enter on a plain child evaluates nothing", async () => {
        const evaluate = vi.spyOn(debugService.viewModel, "evaluateLazyExpression");
        const frame = frameWith([new TestVariable("obj", "{...}", [new TestVariable("x", "1")])]);

        await widget.showAt(editorOver("obj"), createPosition(0, 1), frame);
        app.sendKey("Enter");
        await flushMicrotasks(20);

        expect(evaluate).not.toHaveBeenCalled();
    });

    it("a newer request wins: the older one is cancelled, whether it was evaluating or filling the tree", async () => {
        let release: (children: IExpression[]) => void = () => undefined;
        const slow = new TestVariable("slow", "{...}", [new TestVariable("x", "1")]);
        vi.spyOn(slow, "getChildren").mockReturnValue(
            new Promise((resolve) => {
                release = resolve;
            }),
        );
        const frame = frameWith([slow, new TestVariable("count", "7")]);

        // Cancelled while the tree waits for the children.
        const filling = widget.showAt(editorOver("slow"), createPosition(0, 1), frame);
        await flushMicrotasks(20);
        const plain = widget.showAt(editorOver("count"), createPosition(0, 1), frame);
        // Cancelled while it looks the name up.
        const evaluating = widget.showAt(editorOver("count"), createPosition(0, 1), frame);
        release([new TestVariable("x", "1")]);

        expect(await filling).toBe(ShowDebugHoverResult.CANCELLED);
        expect(await plain).toBe(ShowDebugHoverResult.CANCELLED);
        expect(await evaluating).toBeUndefined();
        expect(screen()).toMatch(/│7 *│/u);
    });

    it.each<[string, () => ITestFrame, string]>([
        ["a name no scope has", () => frameWith([new TestVariable("other", "1")]), "count"],
        [
            "a name twice in a scope",
            () => frameWith([new TestVariable("count", "1"), new TestVariable("count", "2")]),
            "count",
        ],
        [
            "a member its parent does not have",
            () => frameWith([new TestVariable("p", "{}", [new TestVariable("x", "1")])]),
            "p.y",
        ],
        [
            "a name with other values in two scopes",
            () =>
                testFrameWithScopes([
                    { name: "Locals", variables: [new TestVariable("count", "1")] },
                    { name: "Globals", variables: [new TestVariable("count", "2")] },
                ]),
            "count",
        ],
        [
            "a name only in an expensive scope",
            () =>
                testFrameWithScopes([
                    { name: "Registers", expensive: true, variables: [new TestVariable("count", "1")] },
                ]),
            "count",
        ],
        ["whitespace under the cursor", () => frameWith([new TestVariable("count", "1")]), "   "],
    ])("%s: no debug hover", async (_name, frame, line) => {
        expect(await widget.showAt(editorOver(line), createPosition(0, line.length), frame())).toBe(
            ShowDebugHoverResult.NOT_AVAILABLE,
        );
        expect(widget.isVisible()).toBe(false);
    });

    it("the same value of a name in two scopes is shown", async () => {
        const frame = testFrameWithScopes([
            { name: "Locals", variables: [new TestVariable("count", "7")] },
            { name: "Globals", variables: [new TestVariable("count", "7")] },
        ]);

        await widget.showAt(editorOver("count"), createPosition(0, 1), frame);

        expect(screen()).toMatch(/│7 *│/u);
    });

    it("no cursor on screen: nothing to anchor to, the language hover takes over", async () => {
        const frame = frameWith([new TestVariable("count", "7")]);

        expect(await widget.showAt(editorOver("count", false), createPosition(0, 1), frame)).toBe(
            ShowDebugHoverResult.NOT_AVAILABLE,
        );
        expect(widget.isVisible()).toBe(false);
    });

    it("an empty plain value is an empty box in the hover's colors", async () => {
        const frame = frameWith([new TestVariable("blank", "")]);

        await widget.showAt(editorOver("blank"), createPosition(0, 1), frame);

        expect(widget.isVisible()).toBe(true);
        expect(screen()).toContain("╭╮");
    });

    it("a changed value is highlighted for a second, then the row is painted again", async () => {
        vi.useFakeTimers();
        const changed = new TestVariable("x", "2");
        changed.valueChanged = true;
        const frame = frameWith([new TestVariable("obj", "{...}", [changed])]);
        await widget.showAt(editorOver("obj"), createPosition(0, 1), frame);
        const rerender = vi.spyOn(widget.tree, "rerender");

        await vi.advanceTimersByTimeAsync(VALUE_CHANGED_HIGHLIGHT_MS);

        expect(rerender).toHaveBeenCalledTimes(1);
    });
    it("opens above the cursor when there is room", async () => {
        await show(new TestVariable("count", "7"));

        // The cursor is on row 20: the box ends on the row above it.
        expect(cellOf("╰").y).toBe(19);
    });

    it("a long plain value wraps in a box as wide as the widest hover", async () => {
        await show(new TestVariable("text", "x".repeat(100)));

        expect(boxRows()).toEqual([
            `╭${"─".repeat(68)}╮`,
            `│${"x".repeat(68)}│`,
            `│${"x".repeat(32).padEnd(68)}│`,
            `╰${"─".repeat(68)}╯`,
        ]);
    });

    it("a plain value has the color of its kind, as in the Variables view", async () => {
        await show(new TestVariable("text", '"hi"'));
        const stringFg = app.backend.getFgAt(cellOf('"hi"'));
        widget.hide();
        await show(new TestVariable("count", "7"));

        expect(app.backend.getFgAt(cellOf("7│"))).not.toBe(stringFg);
    });

    it("a plain value after a tree: no title, no separator left from the tree", async () => {
        await show(new TestVariable("obj", "{...}", [new TestVariable("x", "1")]));
        await show(new TestVariable("count", "1234567890"));

        expect(boxRows()).toEqual(["╭──────────╮", "│1234567890│", "╰──────────╯"]);
    });

    it.each<[string, IExpression, number]>([
        ["short rows: the narrowest hover", new TestVariable("obj", "{...}", [new TestVariable("x", "1")]), 48],
        [
            "a wider row with its chevron and scrollbar",
            new TestVariable("obj", "{...}", [new TestVariable("x", "y".repeat(48))]),
            55,
        ],
        ["a wide title with its padding", new TestVariable("obj", "T".repeat(60), [new TestVariable("x", "1")]), 60],
        [
            "a wide row below the first screen does not count",
            new TestVariable(
                "obj",
                "{...}",
                Array.from(
                    { length: 20 },
                    (_, i) => new TestVariable(`k${String(i)}`, i === 17 ? "y".repeat(100) : "0"),
                ),
            ),
            48,
        ],
        [
            "a row wider than the widest hover",
            new TestVariable("obj", "{...}", [new TestVariable("x", "y".repeat(100))]),
            68,
        ],
    ])("a tree's width: %s", async (_name, variable, inner) => {
        await show(variable);

        expect(boxRows()[0]).toBe(`╭${"─".repeat(inner)}╮`);
    });

    it("a tree shown again starts from its first row", async () => {
        const many = new TestVariable(
            "obj",
            "{...}",
            Array.from({ length: 20 }, (_, i) => new TestVariable(`k${String(i)}`, String(i))),
        );
        await show(many);
        app.sendKey("End");
        expect(screen()).toContain("k19: 19");

        await show(many);

        expect(screen()).toContain("k0: 0");
    });

    it("an expression not available closes the hover that is open", async () => {
        await show(new TestVariable("count", "7"));

        expect(await widget.showAt(editorOver("other"), createPosition(0, 1), frameWith([]))).toBe(
            ShowDebugHoverResult.NOT_AVAILABLE,
        );
        expect(widget.isVisible()).toBe(false);
    });

    it("an older request that finds nothing does not close the newer hover", async () => {
        let release: (expression: string) => void = () => undefined;
        let calls = 0;
        const range = { start: createPosition(0, 0), end: createPosition(0, 5) };
        features.evaluatableExpressionProvider.register("*", {
            provideEvaluatableExpression: () =>
                calls++ === 0
                    ? new Promise((resolve) => {
                          release = (expression) => {
                              resolve({ range, expression });
                          };
                      })
                    : Promise.resolve({ range, expression: "count" }),
        });
        const frame = frameWith([new TestVariable("count", "7")]);

        const older = widget.showAt(editorOver("count"), createPosition(0, 1), frame);
        await flushMicrotasks(20);
        await widget.showAt(editorOver("count"), createPosition(0, 1), frame);
        release("missing");

        expect(await older).toBe(ShowDebugHoverResult.CANCELLED);
        expect(widget.isVisible()).toBe(true);
    });

    it("a stop keeps the hover open, any other state closes it", async () => {
        await show(new TestVariable("count", "7"));

        states.fire(State.Stopped);
        expect(widget.isVisible()).toBe(true);
        states.fire(State.Running);
        expect(widget.isVisible()).toBe(false);
    });

    it("a plain value takes the focus", async () => {
        await show(new TestVariable("count", "7"));

        expect(app.focusedElement).toBe(widget.view);
    });
});

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type TestDebugService, testDebugService } from "../../../../../TestUtils/debugSessionFixture.ts";
import {
    type ITestFrame,
    testExpressionRenderer,
    testFrame,
    TestVariable,
} from "../../../../../TestUtils/debugViewsFixture.ts";
import { createMockDebugModel } from "../../../../../TestUtils/mockDebug.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { bindWidgetGlyphs } from "../../../../platform/theme/browser/widgetGlyphs.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { VALUE_CHANGED_HIGHLIGHT_MS } from "./debugExpressionRenderer.ts";
import { expressionAndScopeLabel, VARIABLES_REFRESH_DELAY_MS, VariablesView } from "./variablesView.ts";

const vars = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));

describe("VariablesView", () => {
    const disposables = new DisposableStore();
    let debugService: TestDebugService;
    let view: VariablesView;
    let app: TestApp;

    beforeEach(() => {
        vi.useFakeTimers();
        debugService = testDebugService(createMockDebugModel(disposables));
        const renderer = testExpressionRenderer();
        view = disposables.add(new VariablesView(debugService, renderer));
        app = TestApp.createWithContent(view.tree.element, new Size(40, 12));
        bindWidgetGlyphs(app.root, new StaticProductIconService(false));
        view.focus();
    });

    afterEach(() => {
        disposables.clear();
        debugService.viewModel.dispose();
        vi.useRealTimers();
    });

    async function settle(): Promise<void> {
        await flushMicrotasks(20);
    }

    function screen(): string {
        app.render();
        return app.backend.screenToString();
    }

    function focus(frame: ITestFrame | undefined, explicit = false): void {
        debugService.viewModel.setFocus(frame, undefined, undefined, explicit);
    }

    const locals = (): ITestFrame =>
        testFrame([
            { name: "Registers", expensive: true, variables: [new TestVariable("rax", "0x1")] },
            { name: "Locals", variables: [new TestVariable("i", "5"), new TestVariable("name", '"x"')] },
            { name: "Globals", variables: [new TestVariable("g", "1")] },
        ]);

    it("without a focused frame the tree is empty", async () => {
        await settle();

        expect(view.tree.list.rowCount).toBe(0);
    });

    it("a frame focused by a step shows after the delay, the first non-expensive scope expanded", async () => {
        focus(locals());
        await settle();
        expect(screen()).not.toContain("Locals");

        await vi.advanceTimersByTimeAsync(VARIABLES_REFRESH_DELAY_MS);
        await settle();

        const text = screen();
        const rows = text.split("\n");
        const y = rows.findIndex((row) => row.includes("Locals"));
        // A scope is plain text, not a name.
        expect(app.backend.getFgAt(new Point(rows[y].indexOf("Locals"), y))).not.toBe(
            vars["debugTokenExpression.name"],
        );
        expect(text).toContain("▸ Registers");
        expect(text).toContain("▾ Locals");
        expect(text).toContain("i: 5");
        expect(text).toContain('name: "x"');
        expect(text).toContain("▸ Globals");
        expect(text).not.toContain("g: 1");
    });

    it("a frame the user picked shows at once", async () => {
        focus(locals(), true);
        await vi.advanceTimersByTimeAsync(0);
        await settle();

        expect(screen()).toContain("i: 5");
    });

    it("a scope that failed is its message in the error color", async () => {
        focus(testFrame([{ name: "Unable to read the scopes", error: true, variables: [] }]), true);
        await vi.advanceTimersByTimeAsync(0);
        await settle();

        const rows = screen().split("\n");
        const y = rows.findIndex((row) => row.includes("Unable to read"));
        const x = rows[y].indexOf("Unable");
        expect(app.backend.getFgAt(new Point(x, y))).toBe(vars["debugTokenExpression.error"]);
    });

    it("updateViews forgets the scopes of the frame and reads it anew", async () => {
        const frame = locals();
        focus(frame, true);
        await vi.advanceTimersByTimeAsync(0);
        await settle();
        const reads = frame.reads;

        debugService.viewModel.updateViews();
        await settle();

        expect(frame.forgotten).toBe(1);
        expect(frame.reads).toBe(reads + 1);
    });

    it("Enter on a lazy variable resolves it and opens its children", async () => {
        const getter = new TestVariable("getter", "(...)", [new TestVariable("a", "1")], { lazy: { value: "{a}" } });
        focus(testFrame([{ name: "Locals", variables: [getter, new TestVariable("plain", "2")] }]), true);
        await vi.advanceTimersByTimeAsync(0);
        await settle();
        expect(screen()).toContain("getter: ◉ (...)");

        app.sendKey("ArrowDown");
        app.sendKey("Enter");
        await settle();

        expect(screen()).toContain("getter: {a}");
        expect(screen()).toContain("a: 1");
    });

    it("Enter on a scope or a plain variable resolves nothing", async () => {
        const evaluate = vi.spyOn(debugService.viewModel, "evaluateLazyExpression");
        focus(testFrame([{ name: "Locals", variables: [new TestVariable("plain", "2")] }]), true);
        await vi.advanceTimersByTimeAsync(0);
        await settle();

        app.sendKey("Enter");
        app.sendKey("ArrowDown");
        app.sendKey("Enter");
        await settle();

        expect(view.tree.focused?.name).toBe("plain");
        expect(evaluate).not.toHaveBeenCalled();
    });

    it("a view made while a frame is focused shows it at once", async () => {
        focus(locals(), true);
        const late = disposables.add(new VariablesView(debugService, testExpressionRenderer()));
        const lateApp = TestApp.createWithContent(late.tree.element, new Size(40, 12));
        await settle();

        lateApp.render();
        expect(lateApp.backend.screenToString()).toContain("i: 5");
    });

    it("a value changed since the last stop has the highlight background until its second is over", async () => {
        const sum = new TestVariable("sum", "1");
        sum.value = "3";
        focus(testFrame([{ name: "Locals", variables: [sum] }]), true);
        await vi.advanceTimersByTimeAsync(0);
        await settle();
        const background = (): number => {
            const rows = screen().split("\n");
            const y = rows.findIndex((row) => row.includes("sum: 3"));
            return app.backend.getBgAt(new Point(rows[y].indexOf("3"), y));
        };
        expect(background()).toBe(vars["debugView.valueChangedHighlight"]);

        await vi.advanceTimersByTimeAsync(VALUE_CHANGED_HIGHLIGHT_MS);
        view.tree.rerender();

        expect(background()).not.toBe(vars["debugView.valueChangedHighlight"]);
    });

    it("typeahead reads `name: value`", () => {
        expect(expressionAndScopeLabel(new TestVariable("i", "5"))).toBe("i: 5");
    });
});

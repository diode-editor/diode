import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { testExpressionRenderer, TestVariable } from "../../../../../TestUtils/debugViewsFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { bindWidgetGlyphs } from "../../../../platform/theme/browser/widgetGlyphs.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import type { InputBoxOptions } from "../../../browser/parts/quickinput/quickInputService.ts";
import { type IStackFrame, State } from "../common/debug.ts";
import type { ViewModel } from "../common/debugViewModel.ts";

import { WATCH_REFRESH_DELAY_MS, WatchExpressionsView } from "./watchExpressionsView.ts";

describe("WatchExpressionsView", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;
    let view: WatchExpressionsView;
    let app: TestApp;
    /** The answers of the quick input, in order; `undefined` is Escape. */
    let answers: (string | undefined)[];
    let asked: InputBoxOptions[];

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
        answers = [];
        asked = [];
        const renderer = testExpressionRenderer();
        view = new WatchExpressionsView(fx.service, renderer, fx.contextKeys, {
            input: (options) => {
                asked.push(options ?? {});
                return Promise.resolve(answers.shift());
            },
        });
        app = TestApp.createWithContent(view.tree.element, new Size(60, 10));
        bindWidgetGlyphs(app.root, new StaticProductIconService(false));
        view.focus();
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();
        view.dispose();
        fx.service.dispose();
    });

    function screen(): string {
        app.render();
        return app.backend.screenToString();
    }

    function evaluations(): string[] {
        return factory.adapters.flatMap((a) =>
            a.requests
                .filter((r) => r.command === "evaluate")
                .map((r) => (r.arguments as { expression: string }).expression),
        );
    }

    async function start(): Promise<void> {
        expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG })).toBe(true);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
    }

    it("without a session every expression is not available, and watchExpressionsExist follows the list", async () => {
        expect(fx.contextKeys.getRaw("watchExpressionsExist")).toBe(false);

        fx.service.addWatchExpression("sum");
        fx.service.addWatchExpression("total / count");

        await vi.waitFor(() => {
            expect(screen()).toContain("sum: not available");
            expect(screen()).toContain("total / count: not available");
        });
        expect(fx.contextKeys.getRaw("watchExpressionsExist")).toBe(true);
        fx.service.removeWatchExpressions();
        expect(fx.contextKeys.getRaw("watchExpressionsExist")).toBe(false);
    });

    it("in a stop: evaluated in the focused frame; an object opens to its children", async () => {
        fx.service.addWatchExpression("p");
        fx.service.addWatchExpression("nums[5]");
        await start();

        await vi.waitFor(() => {
            expect(screen()).toContain("p: {x:1.5, y:-2}");
            expect(screen()).toContain("nums[5]: 67");
        });
        expect(evaluations()).toEqual(expect.arrayContaining(["p", "nums[5]"]));

        app.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(screen()).toContain("x: 1.5");
        });
        expect(view.tree.focused?.name).toBe("p");
    });

    it("Add Expression: an empty row is not evaluated; the answer names it and evaluates it once", async () => {
        await start();
        // The refresh that follows the focus of the stop is behind us.
        await new Promise((resolve) => setTimeout(resolve, WATCH_REFRESH_DELAY_MS * 2));
        answers.push("sum");

        fx.service.addWatchExpression();

        await vi.waitFor(() => {
            expect(screen()).toContain("sum: 0");
        });
        expect(asked).toEqual([{ placeholder: "Expression to watch", value: "" }]);
        expect(evaluations()).toEqual(["sum"]);
        expect(fx.contextKeys.getRaw("expressionSelected")).toBe(false);
    });

    it("Escape or an empty answer on a new expression removes it; on a named one it keeps the name", async () => {
        answers.push(undefined, "", undefined);

        fx.service.addWatchExpression();
        await vi.waitFor(() => {
            expect(fx.service.getModel().getWatchExpressions()).toHaveLength(0);
        });
        fx.service.addWatchExpression();
        await vi.waitFor(() => {
            expect(fx.service.getModel().getWatchExpressions()).toHaveLength(0);
        });

        fx.service.addWatchExpression("sum");
        const [sum] = fx.service.getModel().getWatchExpressions();
        fx.service.getViewModel().setSelectedExpression(sum, false);
        await vi.waitFor(() => {
            expect(asked).toHaveLength(3);
        });
        await flushMicrotasks(10);
        expect(asked[2]).toEqual({ placeholder: "Expression to watch", value: "sum" });
        expect(
            fx.service
                .getModel()
                .getWatchExpressions()
                .map((we) => we.name),
        ).toEqual(["sum"]);
    });

    it("setting a value (settingWatch) and selecting a variable do not open the input", async () => {
        fx.service.addWatchExpression("sum");
        const [sum] = fx.service.getModel().getWatchExpressions();

        fx.service.getViewModel().setSelectedExpression(sum, true);
        await flushMicrotasks(10);

        expect(asked).toEqual([]);
    });

    it("a rename evaluates once: updateViews from the rename is ignored, a later one evaluates again", async () => {
        fx.service.addWatchExpression("sum");
        await start();
        await vi.waitFor(() => {
            expect(screen()).toContain("sum: 0");
        });
        const [sum] = fx.service.getModel().getWatchExpressions();
        const before = evaluations().length;
        answers.push("total");

        fx.service.getViewModel().setSelectedExpression(sum, false);
        await vi.waitFor(() => {
            expect(screen()).toContain("total: 0");
        });
        await flushMicrotasks(10);
        expect(evaluations().slice(before)).toEqual(["total"]);

        fx.service.getViewModel().updateViews();
        await vi.waitFor(() => {
            expect(evaluations().slice(before)).toEqual(["total", "total"]);
        });
    });

    it("frame changes coalesce: one refresh 50 ms after the first, not postponed by the next", () => {
        vi.useFakeTimers();
        try {
            const refresh = vi.spyOn(view, "refresh");
            const viewModel = fx.service.getViewModel() as ViewModel;
            const frame = (id: string): IStackFrame => ({ getId: () => id }) as IStackFrame;

            viewModel.setFocus(frame("a"), undefined, undefined, false);
            vi.advanceTimersByTime(WATCH_REFRESH_DELAY_MS - 10);
            viewModel.setFocus(frame("b"), undefined, undefined, false);
            vi.advanceTimersByTime(10);

            expect(refresh).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("Enter on a lazy child resolves it and opens it; on anything else it does nothing", async () => {
        const getter = new TestVariable("getter", "(...)", [new TestVariable("a", "1")], { lazy: { value: "{a}" } });
        const expand = vi.spyOn(view.tree, "expand");

        view.tree.onActivate(new TestVariable("plain", "1"));
        view.tree.onActivate(getter);

        await vi.waitFor(() => {
            expect(expand).toHaveBeenCalledWith(getter);
        });
        expect(expand).toHaveBeenCalledTimes(1);
        expect(getter.value).toBe("{a}");
    });
});

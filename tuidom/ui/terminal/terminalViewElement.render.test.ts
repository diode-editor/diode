import { describe, expect, it, vi } from "vitest";

import { FakeTerminalSurface } from "../../testing/FakeTerminalSurface.ts";
import { TestApp } from "../../testing/TestApp.ts";
import { DEFAULT_COLOR, packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { StyleFlags } from "../../common/styleFlags.ts";
import { ROOT_STYLE_CONTEXT } from "../../dom/styles/tuiStyle.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import type { CellPatch } from "../../rendering/grid.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";

import { TerminalViewElement } from "./terminalViewElement.ts";

// Записывающий контекст — ловим точные CellPatch'и, чтобы проверить width/style/цвета,
// которые MockTerminalBackend наружу не отдаёт.
class RecordingContext extends RenderContext {
    public readonly calls: { x: number; y: number; patch: CellPatch }[] = [];
    public override setCell(x: number, y: number, patch: CellPatch): void {
        this.calls.push({ x, y, patch });
        super.setCell(x, y, patch);
    }
    public patchAt(x: number, y: number): CellPatch | undefined {
        return this.calls.find((c) => c.x === x && c.y === y)?.patch;
    }
}

function render(el: TUIElement, width: number, height: number): RecordingContext {
    const size = new Size(width, height);
    const context = new RecordingContext(new TerminalScreen(size));
    el.localPosition = new Offset(0, 0);
    el.layout(BoxConstraints.tight(size));
    el.performStyleResolution(ROOT_STYLE_CONTEXT);
    el.render(context);
    return context;
}

const FG = packRgb(10, 20, 30);
const BG = packRgb(40, 50, 60);

describe("TerminalViewElement — render", () => {
    it("blits characters from the fake grid", () => {
        const surface = new FakeTerminalSurface();
        surface.setGrid(["Hi", "yo"]);
        const context = render(new TerminalViewElement(surface), 2, 2);

        expect(context.patchAt(0, 0)?.char).toBe("H");
        expect(context.patchAt(1, 0)?.char).toBe("i");
        expect(context.patchAt(0, 1)?.char).toBe("y");
        expect(context.patchAt(1, 1)?.char).toBe("o");
    });

    it("passes fg/bg/style through unchanged", () => {
        const surface = new FakeTerminalSurface();
        surface.setCell(0, 0, "S", { fg: FG, bg: BG, style: StyleFlags.Bold | StyleFlags.Italic });
        const patch = render(new TerminalViewElement(surface), 1, 1).patchAt(0, 0);

        expect(patch?.fg).toBe(FG);
        expect(patch?.bg).toBe(BG);
        expect(patch?.style).toBe(StyleFlags.Bold | StyleFlags.Italic);
    });

    it("substitutes defaultFg/defaultBg for DEFAULT_COLOR cells", () => {
        const surface = new FakeTerminalSurface();
        surface.setGrid(["x"]); // ячейка с DEFAULT_COLOR fg/bg
        const el = new TerminalViewElement(surface);
        el.setStyleVars({ "terminal.foreground": FG, "terminal.background": BG });
        const patch = render(el, 1, 1).patchAt(0, 0);

        expect(patch?.fg).toBe(FG);
        expect(patch?.bg).toBe(BG);
    });

    it("keeps explicit colors even when defaults are set", () => {
        const explicitFg = packRgb(1, 2, 3);
        const surface = new FakeTerminalSurface();
        surface.setCell(0, 0, "x", { fg: explicitFg });
        const el = new TerminalViewElement(surface);
        el.setStyleVars({ "terminal.foreground": FG });
        const patch = render(el, 1, 1).patchAt(0, 0);

        expect(patch?.fg).toBe(explicitFg);
    });

    it("paints a wide-char head with width 2, skips its continuation, still paints following cells", () => {
        const surface = new FakeTerminalSurface();
        surface.setGrid(["  X"]); // ширина 3
        surface.setCell(0, 0, "世", { width: 2 }); // голова на 0, continuation на 1
        const context = render(new TerminalViewElement(surface), 3, 1);

        expect(context.patchAt(0, 0)).toEqual({ char: "世", fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, style: 0, width: 2 });
        expect(context.patchAt(1, 0)).toBeUndefined(); // continuation — не красим
        expect(context.patchAt(2, 0)?.char).toBe("X");
    });

    it("paints out-of-range/empty area with spaces so the widget is fully covered", () => {
        const surface = new FakeTerminalSurface();
        surface.setGrid(["Hi"]); // сетка 2x1, виджет 4x2
        const context = render(new TerminalViewElement(surface), 4, 2);

        // За пределами сетки по X на строке 0.
        expect(context.patchAt(2, 0)).toEqual({ char: " " });
        expect(context.patchAt(3, 0)).toEqual({ char: " " });
        // Целиком отсутствующая строка 1.
        for (let x = 0; x < 4; x++) {
            expect(context.patchAt(x, 1)).toEqual({ char: " " });
        }
    });
});

describe("TerminalViewElement — cursor", () => {
    function focusedApp(surface: FakeTerminalSurface): { app: TestApp; el: TerminalViewElement } {
        const el = new TerminalViewElement(surface);
        const app = TestApp.createWithContent(el, new Size(10, 4));
        el.focus();
        app.render();
        return { app, el };
    }

    it("sets the cursor position when focused and not exited", () => {
        const surface = new FakeTerminalSurface();
        surface.setGrid(["......"]);
        surface.setCursor({ x: 3, y: 1 });
        const { app, el } = focusedApp(surface);

        expect(el.isFocused).toBe(true);
        expect(app.backend.cursorPosition).toEqual(new Point(3, 1));
    });

    it("does not set the cursor when unfocused", () => {
        const surface = new FakeTerminalSurface();
        surface.setCursor({ x: 3, y: 1 });
        const el = new TerminalViewElement(surface);
        const app = TestApp.createWithContent(el, new Size(10, 4));
        app.render(); // без focus()

        expect(app.backend.cursorPosition).toBeNull();
    });

    it("does not set the cursor when the shell has exited", () => {
        const surface = new FakeTerminalSurface();
        surface.setCursor({ x: 3, y: 1 });
        surface.isExited = true;
        const { app } = focusedApp(surface);

        expect(app.backend.cursorPosition).toBeNull();
    });

    it("does not set the cursor while the viewport looks into the scrollback", () => {
        // Курсор шелла живёт на дне — над историей его показывать нельзя, и поверхность
        // сама отдаёт null, пока смещение > 0.
        const surface = new FakeTerminalSurface();
        surface.setCursor({ x: 3, y: 1 });
        surface.scrollbackLines = 10;
        surface.scrollLines(-4);
        const { app } = focusedApp(surface);

        expect(app.backend.cursorPosition).toBeNull();
    });

    it("does not set the cursor when getCursor returns null", () => {
        const surface = new FakeTerminalSurface();
        surface.setCursor(null);
        const { app } = focusedApp(surface);

        expect(app.backend.cursorPosition).toBeNull();
    });
});

describe("TerminalViewElement — updates", () => {
    it("re-renders on surface update", () => {
        const surface = new FakeTerminalSurface();
        surface.setGrid(["a"]);
        const el = new TerminalViewElement(surface);
        const context = new RecordingContext(new TerminalScreen(new Size(1, 1)));
        el.localPosition = new Offset(0, 0);
        el.layout(BoxConstraints.tight(new Size(1, 1)));

        // markDirty подписан на onUpdate — после emitUpdate элемент помечен грязным
        // и следующий render() возьмёт новую сетку.
        el.render(context);
        surface.setGrid(["b"]);
        surface.emitUpdate();
        const context2 = new RecordingContext(new TerminalScreen(new Size(1, 1)));
        el.render(context2);
        expect(context2.patchAt(0, 0)?.char).toBe("b");
    });

    it("re-renders on shell exit (to hide the cursor)", () => {
        const surface = new FakeTerminalSurface();
        const el = new TerminalViewElement(surface);
        const markDirty = vi.spyOn(el, "markDirty");

        surface.emitExit(0);

        // markDirty подписан на onExit — курсор прячется в ближайшем кадре (isExited в render).
        expect(markDirty).toHaveBeenCalled();
        markDirty.mockRestore();
        el.dispose();
    });

    it("stops reacting to the surface after dispose", () => {
        const surface = new FakeTerminalSurface();
        const el = new TerminalViewElement(surface);
        el.dispose();
        // После dispose подписки сняты — emit не должен бросать и не трогает элемент.
        expect(() => {
            surface.emitUpdate();
            surface.emitExit(0);
        }).not.toThrow();
    });
});

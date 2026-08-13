import { describe, expect, it } from "vitest";

import { FakeTerminalSurface } from "../../testing/FakeTerminalSurface.ts";
import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import type { WheelDirection } from "../../dom/events/tuiMouseEvent.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";

import { TerminalViewElement } from "./terminalViewElement.ts";

// Прокрутка вьюпорта по скролбэку: колесом и Shift+PageUp/PageDown. Виджет крутит сам,
// пока программа в шелле не включила mouse-tracking — тогда колесо целиком её
// (форвардинг проверяется в terminalViewElement.input.test.ts).

const WIDTH = 20;
const HEIGHT = 10;

function makeElement(scrollbackLines = 100): { el: TerminalViewElement; surface: FakeTerminalSurface } {
    const surface = new FakeTerminalSurface();
    surface.scrollbackLines = scrollbackLines;
    const el = new TerminalViewElement(surface);
    el.layout(BoxConstraints.tight(new Size(WIDTH, HEIGHT)));
    return { el, surface };
}

function wheel(direction: WheelDirection): TUIMouseEvent {
    return new TUIMouseEvent("wheel", {
        button: "none",
        screenX: 0,
        screenY: 0,
        localX: 0,
        localY: 0,
        wheelDirection: direction,
    });
}

describe("TerminalViewElement — прокрутка колесом", () => {
    it("крутит вьюпорт в скролбэк, пока mouse-tracking выключен", () => {
        const { el, surface } = makeElement();
        el.dispatchEvent(wheel("up"));
        expect(surface.scrollOffset).toBe(3);
        el.dispatchEvent(wheel("up"));
        expect(surface.scrollOffset).toBe(6);
        el.dispatchEvent(wheel("down"));
        expect(surface.scrollOffset).toBe(3);
    });

    it("не шлёт отчёт мыши в поверхность, когда крутит сам", () => {
        const { el, surface } = makeElement();
        el.dispatchEvent(wheel("up"));
        expect(surface.mouseEvents).toEqual([]);
    });

    it("не отдаёт колесо программе — событие потреблено", () => {
        const { el } = makeElement();
        const event = wheel("up");
        el.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it("упирается в дно: вниз с нулевого смещения ничего не меняет", () => {
        const { el, surface } = makeElement();
        el.dispatchEvent(wheel("down"));
        expect(surface.scrollOffset).toBe(0);
    });

    it("упирается в потолок скролбэка", () => {
        const { el, surface } = makeElement(4);
        el.dispatchEvent(wheel("up"));
        el.dispatchEvent(wheel("up"));
        expect(surface.scrollOffset).toBe(4);
    });

    it.each(["left", "right"] as const)("игнорирует горизонтальное колесо (%s)", (direction) => {
        const { el, surface } = makeElement();
        el.dispatchEvent(wheel(direction));
        expect(surface.scrollOffset).toBe(0);
        expect(surface.mouseEvents).toEqual([]);
    });

    it("отдаёт колесо программе, когда та включила mouse-tracking", () => {
        const { el, surface } = makeElement();
        surface.mouseEventsActive = true;
        el.dispatchEvent(wheel("up"));
        expect(surface.scrollOffset).toBe(0);
        expect(surface.mouseEvents).toHaveLength(1);
    });
});

describe("TerminalViewElement — прокрутка с клавиатуры", () => {
    function key(name: string, shiftKey: boolean): TUIKeyboardEvent {
        return new TUIKeyboardEvent("keydown", { key: name, shiftKey });
    }

    it("Shift+PageUp/PageDown листает страницами и не уходит в PTY", () => {
        const { el, surface } = makeElement();
        el.dispatchEvent(key("PageUp", true));
        expect(surface.scrollOffset).toBe(HEIGHT - 1);
        expect(surface.writes).toEqual([]);

        el.dispatchEvent(key("PageDown", true));
        expect(surface.scrollOffset).toBe(0);
        expect(surface.writes).toEqual([]);
    });

    it("PageUp без Shift — обычная клавиша шелла", () => {
        const { el, surface } = makeElement();
        el.dispatchEvent(key("PageUp", false));
        expect(surface.writes).toEqual(["\x1b[5~"]);
        expect(surface.scrollOffset).toBe(0);
    });

    it("ввод возвращает вьюпорт на дно", () => {
        const { el, surface } = makeElement();
        el.dispatchEvent(wheel("up"));
        expect(surface.scrollOffset).toBe(3);
        el.dispatchEvent(key("a", false));
        expect(surface.scrollOffset).toBe(0);
    });
});

describe("TerminalViewElement — перерисовка", () => {
    it("просит кадр после прокрутки (через onUpdate поверхности)", () => {
        const { el } = makeElement();
        el.setAsRoot();
        let renders = 0;
        el.setRequestRenderCallback(() => {
            renders++;
        });
        el.dispatchEvent(wheel("up"));
        expect(renders).toBeGreaterThan(0);
    });
});

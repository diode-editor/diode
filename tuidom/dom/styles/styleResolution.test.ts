import { describe, expect, it } from "vitest";

import { packRgb } from "../../common/colorUtils.ts";
import { TUIElement } from "../tuiElement.ts";

import { STYLE_TOKEN_DEFAULTS } from "./styleTokens.ts";
import { INHERITED_BG, ROOT_RESOLVED_STYLE, ROOT_STYLE_CONTEXT } from "./tuiStyle.ts";

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

describe("style setter triggers dirty", () => {
    it("marks self and all descendants dirty", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const mid = new ContainerElement();
        const leaf = new TUIElement();
        root.addChild(mid);
        mid.addChild(leaf);

        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        const fg = packRgb(100, 200, 50);
        root.style = { fg };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.resolvedStyle.fg).toBe(fg);
        expect(mid.resolvedStyle.fg).toBe(fg);
        expect(leaf.resolvedStyle.fg).toBe(fg);
    });

    it("triggers markDirty for render scheduling", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        let renderRequested = false;
        root.setRequestRenderCallback(() => {
            renderRequested = true;
        });

        root.style = { fg: packRgb(1, 2, 3) };
        expect(renderRequested).toBe(true);
    });

    it("пуш равного по значению стиля — no-op (не дирявит и не планирует кадр)", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.style = { fg: packRgb(1, 2, 3), bg: packRgb(4, 5, 6) };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        let renderRequested = false;
        root.setRequestRenderCallback(() => {
            renderRequested = true;
        });

        root.style = { fg: packRgb(1, 2, 3), bg: packRgb(4, 5, 6) };
        expect(renderRequested).toBe(false);
    });
});

describe("performStyleResolution", () => {
    it("clears dirty flags after resolution", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const child = new TUIElement();
        root.addChild(child);

        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        const fg = packRgb(255, 0, 0);
        root.style = { fg };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.resolvedStyle.fg).toBe(fg);
    });

    it("cascades fg through tree", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const mid = new ContainerElement();
        const leaf = new TUIElement();
        root.addChild(mid);
        mid.addChild(leaf);

        const green = packRgb(0, 255, 0);
        root.style = { fg: green };

        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.resolvedStyle.fg).toBe(green);
        expect(mid.resolvedStyle.fg).toBe(green);
        expect(leaf.resolvedStyle.fg).toBe(green);
    });

    it("mid-level fg override shadows parent", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const mid = new ContainerElement();
        const leaf = new TUIElement();
        root.addChild(mid);
        mid.addChild(leaf);

        const rootFg = packRgb(255, 255, 255);
        const midFg = packRgb(128, 128, 128);
        root.style = { fg: rootFg };
        mid.style = { fg: midFg };

        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.resolvedStyle.fg).toBe(rootFg);
        expect(mid.resolvedStyle.fg).toBe(midFg);
        expect(leaf.resolvedStyle.fg).toBe(midFg);
    });

    it("explicit fg on leaf overrides cascade", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const leaf = new TUIElement();
        root.addChild(leaf);

        const rootFg = packRgb(200, 200, 200);
        const leafFg = packRgb(255, 0, 0);
        root.style = { fg: rootFg };
        leaf.style = { fg: leafFg };

        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.resolvedStyle.fg).toBe(rootFg);
        expect(leaf.resolvedStyle.fg).toBe(leafFg);
    });

    it("early exit: clean subtree is not re-resolved", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const child = new TUIElement();
        root.addChild(child);

        const fg1 = packRgb(10, 20, 30);
        root.style = { fg: fg1 };

        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(child.resolvedStyle.fg).toBe(fg1);

        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(child.resolvedStyle.fg).toBe(fg1);
    });

    it("cascade change via style setter updates entire subtree", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const mid = new ContainerElement();
        const leaf = new TUIElement();
        root.addChild(mid);
        mid.addChild(leaf);

        const fg1 = packRgb(100, 100, 100);
        root.style = { fg: fg1 };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(leaf.resolvedStyle.fg).toBe(fg1);

        const fg2 = packRgb(200, 200, 200);
        root.style = { fg: fg2 };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.resolvedStyle.fg).toBe(fg2);
        expect(mid.resolvedStyle.fg).toBe(fg2);
        expect(leaf.resolvedStyle.fg).toBe(fg2);
    });

    it("child style change resolves when parent is clean", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const mid = new ContainerElement();
        const leaf = new TUIElement();
        root.addChild(mid);
        mid.addChild(leaf);

        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        const leafFg = packRgb(255, 0, 128);
        leaf.style = { fg: leafFg };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(leaf.resolvedStyle.fg).toBe(leafFg);
    });

    it("deeply nested child style change propagates through clean ancestors", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const a = new ContainerElement();
        const b = new ContainerElement();
        const c = new TUIElement();
        root.addChild(a);
        a.addChild(b);
        b.addChild(c);

        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        const bg = packRgb(0, 90, 180);
        c.style = { bg };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(c.resolvedStyle.bg).toBe(bg);
        expect(a.resolvedStyle.bg).toBe(ROOT_RESOLVED_STYLE.bg);
        expect(b.resolvedStyle.bg).toBe(ROOT_RESOLVED_STYLE.bg);
    });

    it("newly attached subtree with dirty styles resolves correctly", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const mid = new ContainerElement();
        root.addChild(mid);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        const detached = new ContainerElement();
        const leaf = new TUIElement();
        detached.addChild(leaf);
        const fg = packRgb(0, 128, 255);
        leaf.style = { fg };

        mid.addChild(detached);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(leaf.resolvedStyle.fg).toBe(fg);
    });

    it("newly created element attached to clean parent resolves styles", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        const child = new TUIElement();
        child.style = { bg: packRgb(0, 90, 180) };
        root.addChild(child);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(child.resolvedStyle.bg).toBe(packRgb(0, 90, 180));
    });
});

describe("состояния стиля и when-варианты", () => {
    function makeTree(): { root: ContainerElement; mid: ContainerElement; leaf: TUIElement } {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const mid = new ContainerElement();
        const leaf = new TUIElement();
        root.addChild(mid);
        mid.addChild(leaf);
        return { root, mid, leaf };
    }

    it("setStyleState применяет when-вариант, снятие — откатывает", () => {
        const { root, mid } = makeTree();
        const base = packRgb(10, 10, 10);
        const hoverBg = packRgb(40, 40, 40);
        mid.style = { bg: base, when: [{ states: ["hover"], bg: hoverBg }] };

        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(mid.resolvedStyle.bg).toBe(base);

        mid.setStyleState("hover", true);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(mid.resolvedStyle.bg).toBe(hoverBg);

        mid.setStyleState("hover", false);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(mid.resolvedStyle.bg).toBe(base);
    });

    it("ребёнок наследует РЕЗУЛЬТАТ родителя с учётом его состояний", () => {
        const { root, mid, leaf } = makeTree();
        const hoverBg = packRgb(70, 70, 70);
        mid.style = { bg: packRgb(20, 20, 20), when: [{ states: ["hover"], bg: hoverBg }] };

        mid.setStyleState("hover", true);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(leaf.resolvedStyle.bg).toBe(hoverBg);
    });

    it("in:-селектор — состояние предка активирует when потомка", () => {
        const { root, mid, leaf } = makeTree();
        const focusFg = packRgb(255, 255, 0);
        leaf.style = { when: [{ states: ["in:focus"], fg: focusFg }] };

        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(leaf.resolvedStyle.fg).not.toBe(focusFg);

        mid.setStyleState("focus", true);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(leaf.resolvedStyle.fg).toBe(focusFg);
    });

    it("in:-селектор видит и СОБСТВЕННОЕ состояние элемента", () => {
        const { root, leaf } = makeTree();
        const fg = packRgb(1, 2, 3);
        leaf.style = { when: [{ states: ["in:selected"], fg }] };
        leaf.setStyleState("selected", true);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(leaf.resolvedStyle.fg).toBe(fg);
    });

    it("состояние предка не задевает сиблинг-поддерево", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const a = new ContainerElement();
        const b = new TUIElement();
        root.addChild(a);
        root.addChild(b);
        const fg = packRgb(9, 9, 9);
        b.style = { when: [{ states: ["in:hover"], fg }] };

        a.setStyleState("hover", true);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(b.resolvedStyle.fg).not.toBe(fg);
    });

    it("when-вариант с сентинелом: bg: INHERITED_BG в состоянии", () => {
        const { root, mid } = makeTree();
        const rootBg = packRgb(5, 5, 5);
        root.style = { bg: rootBg };
        mid.style = { bg: packRgb(50, 50, 50), when: [{ states: ["ghost"], bg: INHERITED_BG }] };

        mid.setStyleState("ghost", true);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(mid.resolvedStyle.bg).toBe(rootBg);
    });

    it("setStyleState — no-op без смены значения", () => {
        const { root, mid } = makeTree();
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        let renderRequested = false;
        root.setRequestRenderCallback(() => {
            renderRequested = true;
        });
        mid.setStyleState("hover", false);
        expect(renderRequested).toBe(false);

        mid.setStyleState("hover", true);
        expect(renderRequested).toBe(true);
    });

    it("hasStyleState и activeStyleStates отражают набор", () => {
        const el = new TUIElement();
        expect(el.hasStyleState("hover")).toBe(false);
        expect(el.activeStyleStates).toEqual([]);
        el.setStyleState("hover", true);
        el.setStyleState("selected", true);
        expect(el.hasStyleState("hover")).toBe(true);
        expect(el.activeStyleStates).toEqual(["hover", "selected"]);
        el.setStyleState("hover", false);
        expect(el.activeStyleStates).toEqual(["selected"]);
    });

    it("перецепление ЧИСТОГО поддерева пере-резолвит его в новом контексте", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const red = new ContainerElement();
        red.style = { fg: packRgb(255, 0, 0) };
        const blue = new ContainerElement();
        blue.style = { fg: packRgb(0, 0, 255) };
        root.addChild(red);
        root.addChild(blue);

        const child = new TUIElement();
        red.addChild(child);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(child.resolvedStyle.fg).toBe(packRgb(255, 0, 0));

        // child чист; перецепляем под другой каскад (appendChild сам детачит)
        blue.addChild(child);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(child.resolvedStyle.fg).toBe(packRgb(0, 0, 255));
    });
});

describe("токены-переменные (var-scope)", () => {
    function makeTree(): { root: ContainerElement; mid: ContainerElement; leaf: TUIElement } {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        const mid = new ContainerElement();
        const leaf = new TUIElement();
        root.addChild(mid);
        mid.addChild(leaf);
        return { root, mid, leaf };
    }

    it("стиль ссылается на токен из корневой таблицы", () => {
        const { root, leaf } = makeTree();
        root.setStyleVars({ "editor.background": packRgb(30, 30, 30) });
        leaf.style = { bg: "editor.background" };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(leaf.resolvedStyle.bg).toBe(packRgb(30, 30, 30));
    });

    it("без хостовой таблицы работает дефолт tuidom", () => {
        const { root, leaf } = makeTree();
        leaf.style = { bg: "list.activeSelectionBackground" };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(leaf.resolvedStyle.bg).toBe(STYLE_TOKEN_DEFAULTS["list.activeSelectionBackground"]);
    });

    it("таблица в середине дерева перекрывает корневую для своего поддерева", () => {
        const { root, mid, leaf } = makeTree();
        root.setStyleVars({ "x.color": packRgb(1, 1, 1) });
        mid.setStyleVars({ "x.color": packRgb(2, 2, 2) });
        leaf.style = { fg: "x.color" };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(leaf.resolvedStyle.fg).toBe(packRgb(2, 2, 2));

        // сиблинг вне поддерева mid видит корневое значение
        const sibling = new TUIElement();
        sibling.style = { fg: "x.color" };
        root.addChild(sibling);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(sibling.resolvedStyle.fg).toBe(packRgb(1, 1, 1));
    });

    it("смена корневой таблицы (hot-swap темы) перерезолвит поддерево", () => {
        const { root, leaf } = makeTree();
        root.setStyleVars({ "t.bg": packRgb(10, 10, 10) });
        leaf.style = { bg: "t.bg" };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(leaf.resolvedStyle.bg).toBe(packRgb(10, 10, 10));

        root.setStyleVars({ "t.bg": packRgb(200, 200, 200) });
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(leaf.resolvedStyle.bg).toBe(packRgb(200, 200, 200));
    });

    it("токен в when-варианте", () => {
        const { root, leaf } = makeTree();
        root.setStyleVars({ "sel.bg": packRgb(4, 57, 94) });
        leaf.style = { bg: packRgb(0, 0, 0), when: [{ states: ["selected"], bg: "sel.bg" }] };
        leaf.setStyleState("selected", true);
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(leaf.resolvedStyle.bg).toBe(packRgb(4, 57, 94));
    });

    it("styleVar: чтение после резолва, throw на незнакомом", () => {
        const { root, mid } = makeTree();
        root.setStyleVars({ "panel.border": packRgb(70, 70, 70) });
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(mid.styleVar("panel.border")).toBe(packRgb(70, 70, 70));
        expect(mid.styleVar("list.activeSelectionBackground")).toBe(
            STYLE_TOKEN_DEFAULTS["list.activeSelectionBackground"],
        );
        expect(() => mid.styleVar("no.such")).toThrow('неизвестный цветовой токен "no.such"');
    });

    it("незнакомый токен в стиле — fail-fast с именем класса", () => {
        const { root, leaf } = makeTree();
        leaf.style = { fg: "missing.token" };
        expect(() => {
            root.performStyleResolution(ROOT_STYLE_CONTEXT);
        }).toThrow('TUIElement: неизвестный цветовой токен "missing.token"');
    });

    it("setStyleVars отвергает сентинелы", () => {
        const { root } = makeTree();
        expect(() => {
            root.setStyleVars({ bad: -100 });
        }).toThrow('токен "bad"');
    });

    it("setStyleVars: identity no-op, null снимает таблицу", () => {
        const { root, leaf } = makeTree();
        const table = { "v.fg": packRgb(5, 5, 5) };
        root.setStyleVars(table);
        leaf.style = { fg: "v.fg" };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        let renderRequested = false;
        root.setRequestRenderCallback(() => {
            renderRequested = true;
        });
        root.setStyleVars(table);
        expect(renderRequested).toBe(false);

        root.setStyleVars(null);
        expect(renderRequested).toBe(true);
        expect(() => {
            root.performStyleResolution(ROOT_STYLE_CONTEXT);
        }).toThrow("v.fg");
    });
});

describe("описание владельца в ошибках токенов", () => {
    it("включает id элемента, когда он задан", () => {
        const el = new TUIElement();
        el.id = "myButton";
        expect(() => el.styleVar("no.such.token")).toThrow('TUIElement#myButton.styleVar: неизвестный цветовой токен');
    });
});

describe("resolveColor — публичный резолв данных", () => {
    it("резолвит число/сентинел/токен и падает на незнакомом токене", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.setRequestRenderCallback(() => {
            /* noop */
        });
        root.style = { fg: packRgb(9, 9, 9) };
        root.setStyleVars({ "data.color": packRgb(1, 2, 3) });
        root.performStyleResolution(ROOT_STYLE_CONTEXT);

        expect(root.resolveColor(packRgb(7, 7, 7))).toBe(packRgb(7, 7, 7));
        expect(root.resolveColor(INHERITED_BG)).toBe(root.resolvedStyle.bg);
        expect(root.resolveColor("data.color")).toBe(packRgb(1, 2, 3));
        expect(() => root.resolveColor("no.such")).toThrow('ContainerElement: неизвестный цветовой токен "no.such"');
    });
});

describe("hasStyleStateWithin — рантайм-двойник `in:`-селектора", () => {
    it("видит состояние на себе и на любом предке, но не на потомке", () => {
        const root = new ContainerElement();
        const middle = new ContainerElement();
        const leaf = new ContainerElement();
        root.addChild(middle);
        middle.addChild(leaf);

        expect(leaf.hasStyleStateWithin("rowActive")).toBe(false);

        leaf.setStyleState("rowActive", true);
        expect(leaf.hasStyleStateWithin("rowActive")).toBe(true);
        leaf.setStyleState("rowActive", false);

        root.setStyleState("rowActive", true);
        expect(leaf.hasStyleStateWithin("rowActive")).toBe(true);
        expect(middle.hasStyleStateWithin("rowActive")).toBe(true);
        // Вверх, а не вниз: у предка состояние потомка не видно.
        leaf.setStyleState("checked", true);
        expect(root.hasStyleStateWithin("checked")).toBe(false);
    });

    it("не требует стилевого прохода — состояние читается сразу после установки", () => {
        const root = new ContainerElement();
        const leaf = new ContainerElement();
        root.addChild(leaf);

        root.setStyleStateDuringLayout("rowActive", true);
        expect(leaf.hasStyleStateWithin("rowActive")).toBe(true);
    });
});

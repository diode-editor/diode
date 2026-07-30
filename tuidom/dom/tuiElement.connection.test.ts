import { describe, expect, it } from "vitest";

import { FocusManager } from "./events/focusManager.ts";
import { TUIElement } from "./tuiElement.ts";

/** Пишущий лог подкласс: фиксирует connect/disconnect и состояние getRoot(). */
class ProbeElement extends TUIElement {
    public constructor(
        name: string,
        private readonly log: string[],
    ) {
        super();
        this.id = name;
    }

    public add(child: TUIElement): void {
        this.appendChild(child);
    }

    public remove(child: TUIElement): void {
        this.removeChild(child);
    }

    public swap(oldChild: TUIElement, newChild: TUIElement): void {
        this.replaceChild(oldChild, newChild);
    }

    public assign(children: TUIElement[]): void {
        this.setChildren(children);
    }

    protected override onDidConnect(root: TUIElement): void {
        this.log.push(`${this.id ?? "?"}:connect(${root.id ?? "?"})`);
        expect(this.getRoot()).toBe(root); // инвариант: внутри connect дерево укоренено
    }

    protected override onDidDisconnect(): void {
        this.log.push(`${this.id ?? "?"}:disconnect`);
        expect(this.getRoot()).toBeNull(); // инвариант: внутри disconnect корня нет
    }
}

function makeRoot(log: string[]): ProbeElement {
    const root = new ProbeElement("root", log);
    root.setAsRoot();
    return root;
}

describe("TUIElement — подключение к дереву (onDidConnect/onDidDisconnect)", () => {
    it("appendChild к укоренённому родителю подключает всё поддерево pre-order", () => {
        const log: string[] = [];
        const root = makeRoot(log);
        const parent = new ProbeElement("parent", log);
        const child = new ProbeElement("child", log);
        parent.add(child); // сборка отвязанно — хуков нет
        expect(log).toEqual(["root:connect(root)"]);

        root.add(parent);
        expect(log).toEqual(["root:connect(root)", "parent:connect(root)", "child:connect(root)"]);
    });

    it("removeChild отключает всё поддерево pre-order", () => {
        const log: string[] = [];
        const root = makeRoot(log);
        const parent = new ProbeElement("parent", log);
        const child = new ProbeElement("child", log);
        parent.add(child);
        root.add(parent);
        log.length = 0;

        root.remove(parent);
        expect(log).toEqual(["parent:disconnect", "child:disconnect"]);
    });

    it("сборка отвязанного поддерева молчит; последующее укоренение даёт ровно один connect на узел", () => {
        const log: string[] = [];
        const a = new ProbeElement("a", log);
        const b = new ProbeElement("b", log);
        const c = new ProbeElement("c", log);
        a.add(b);
        b.add(c);
        expect(log).toEqual([]);

        const root = makeRoot(log);
        root.add(a);
        expect(log).toEqual(["root:connect(root)", "a:connect(root)", "b:connect(root)", "c:connect(root)"]);
    });

    it("поздний setAsRoot подключает уже собранное поддерево", () => {
        const log: string[] = [];
        const top = new ProbeElement("top", log);
        const kid = new ProbeElement("kid", log);
        top.add(kid);

        top.setAsRoot();
        expect(log).toEqual(["top:connect(top)", "kid:connect(top)"]);
    });

    it("повторный setAsRoot — no-op без второго connect", () => {
        const log: string[] = [];
        const root = makeRoot(log);
        root.setAsRoot();
        expect(log).toEqual(["root:connect(root)"]);
    });

    it("setAsRoot у узла с родителем — исключение", () => {
        const log: string[] = [];
        const root = makeRoot(log);
        const child = new ProbeElement("child", log);
        root.add(child);
        expect(() => {
            child.setAsRoot();
        }).toThrow(/вершине цепочки/);
    });

    it("перенос внутри одного дерева — пара disconnect → connect", () => {
        const log: string[] = [];
        const root = makeRoot(log);
        const a = new ProbeElement("a", log);
        const b = new ProbeElement("b", log);
        const moved = new ProbeElement("moved", log);
        root.add(a);
        root.add(b);
        a.add(moved);
        log.length = 0;

        b.add(moved); // insertChild сначала снимает со старого родителя
        expect(log).toEqual(["moved:disconnect", "moved:connect(root)"]);
    });

    it("перенос между двумя деревьями — disconnect от старого корня, connect с новым", () => {
        const log: string[] = [];
        const root1 = new ProbeElement("root1", log);
        root1.setAsRoot();
        const root2 = new ProbeElement("root2", log);
        root2.setAsRoot();
        const moved = new ProbeElement("moved", log);
        root1.add(moved);
        log.length = 0;

        root2.add(moved);
        expect(log).toEqual(["moved:disconnect", "moved:connect(root2)"]);
    });

    it("replaceChild: снятый — disconnect, поставленный — connect", () => {
        const log: string[] = [];
        const root = makeRoot(log);
        const before = new ProbeElement("before", log);
        const after = new ProbeElement("after", log);
        root.add(before);
        log.length = 0;

        root.swap(before, after);
        expect(log).toEqual(["before:disconnect", "after:connect(root)"]);
    });

    it("setChildren: лишние — disconnect, новые — connect, оставшиеся — тишина", () => {
        const log: string[] = [];
        const root = makeRoot(log);
        const stays = new ProbeElement("stays", log);
        const leaves = new ProbeElement("leaves", log);
        const joins = new ProbeElement("joins", log);
        root.assign([stays, leaves]);
        log.length = 0;

        root.assign([stays, joins]);
        expect(log).toEqual(["leaves:disconnect", "joins:connect(root)"]);
    });

    it("hidden-поддерево получает хуки наравне с видимыми (connection ≠ visibility)", () => {
        const log: string[] = [];
        const root = makeRoot(log);
        const panel = new ProbeElement("panel", log);
        const inner = new ProbeElement("inner", log);
        panel.add(inner);
        panel.hidden = true;
        log.length = 0;

        root.add(panel);
        expect(log).toEqual(["panel:connect(root)", "inner:connect(root)"]);
        log.length = 0;
        root.remove(panel);
        expect(log).toEqual(["panel:disconnect", "inner:disconnect"]);
    });

    it("detached → detached перецепка: connection-хуки молчат, onDidChangeParent зовётся", () => {
        const log: string[] = [];
        const parentChanges: string[] = [];
        class ParentProbe extends ProbeElement {
            protected override onDidChangeParent(_o: TUIElement | null, n: TUIElement | null): void {
                parentChanges.push(`parent→${n === null ? "null" : (n.id ?? "?")}`);
            }
        }
        const a = new ProbeElement("a", log);
        const b = new ProbeElement("b", log);
        const moved = new ParentProbe("moved", log);
        a.add(moved);
        b.add(moved);

        expect(log).toEqual([]);
        expect(parentChanges).toEqual(["parent→a", "parent→null", "parent→b"]);
    });

    it("onDidChangeParent срабатывает раньше connection-хуков", () => {
        const order: string[] = [];
        class OrderProbe extends TUIElement {
            protected override onDidChangeParent(): void {
                order.push("parentChange");
            }

            protected override onDidConnect(): void {
                order.push("connect");
            }
        }
        const log: string[] = [];
        const root = makeRoot(log);
        root.add(new OrderProbe());

        expect(order).toEqual(["parentChange", "connect"]);
    });

    it("blur фокусированного поддерева уходит раньше disconnect", () => {
        const order: string[] = [];
        class FocusProbe extends TUIElement {
            public constructor() {
                super();
                this.focusable = true;
                this.addEventListener("blur", () => order.push("blur"));
            }

            protected override onDidDisconnect(): void {
                order.push("disconnect");
            }
        }
        const log: string[] = [];
        const root = makeRoot(log);
        root.focusManager = new FocusManager(root);
        const el = new FocusProbe();
        root.add(el);
        el.focus();
        expect(root.focusManager.activeElement).toBe(el);

        root.remove(el);
        expect(order).toEqual(["blur", "disconnect"]);
    });

    it("реентерабельность: ребёнок, добавленный из onDidConnect, получает свой connect ровно один раз", () => {
        const log: string[] = [];
        class SpawningProbe extends ProbeElement {
            protected override onDidConnect(root: TUIElement): void {
                super.onDidConnect(root);
                if (this.getChildren().length === 0) {
                    this.add(new ProbeElement("spawned", log));
                }
            }
        }
        const root = makeRoot(log);
        const spawner = new SpawningProbe("spawner", log);
        root.add(spawner);

        expect(log).toEqual(["root:connect(root)", "spawner:connect(root)", "spawned:connect(root)"]);
    });

    it("реентерабельность: узел, удалённый из onDidConnect соседа, получает disconnect и не получает поздний connect", () => {
        const log: string[] = [];
        const container = new ProbeElement("container", log);
        const victim = new ProbeElement("victim", log);
        class RemovingProbe extends ProbeElement {
            protected override onDidConnect(root: TUIElement): void {
                super.onDidConnect(root);
                container.remove(victim);
            }
        }
        // Порядок детей: сначала remover, потом victim — remover удаляет victim
        // из ещё не обойдённой части снимка.
        const remover = new RemovingProbe("remover", log);
        container.add(remover);
        container.add(victim);

        const root = makeRoot(log);
        log.length = 0;
        root.add(container);

        // victim подключился фактом коммита топологии (до обхода) и удалён до
        // своей очереди в обходе: он получает disconnect (удаление из живого
        // дерева), а его connect из снимка пропускается по протухшей связи.
        expect(log).toEqual(["container:connect(root)", "remover:connect(root)", "victim:disconnect"]);
    });

    it("реентерабельность: узел, удалённый из onDidDisconnect соседа, пропускается по протухшей связи", () => {
        const log: string[] = [];
        const root = makeRoot(log);
        const container = new ProbeElement("container", log);
        const victim = new ProbeElement("victim", log);
        class RemovingProbe extends ProbeElement {
            protected override onDidDisconnect(): void {
                super.onDidDisconnect();
                container.remove(victim);
            }
        }
        const remover = new RemovingProbe("remover", log);
        container.add(remover);
        container.add(victim);
        root.add(container);
        log.length = 0;

        root.remove(container);
        // victim снят хуком уже ПОСЛЕ отключения поддерева (его собственный
        // setParent не видит смены укоренённости: null → null), а обход
        // пропускает его по протухшей связи — уведомление молчит.
        expect(log).toEqual(["container:disconnect", "remover:disconnect"]);
        expect(victim.getParent()).toBeNull();
    });

    it("исключение из хука пролетает наружу, топология остаётся консистентной", () => {
        const log: string[] = [];
        class ThrowingProbe extends TUIElement {
            protected override onDidConnect(): void {
                throw new Error("boom");
            }
        }
        const root = makeRoot(log);
        const bad = new ThrowingProbe();
        expect(() => {
            root.add(bad);
        }).toThrow("boom");
        // Топология закоммичена до хуков: связь родитель-ребёнок цела.
        expect(bad.getParent()).toBe(root);
        expect(root.getChildren()).toContain(bad);
    });

    it("isConnected — производное от подключённости", () => {
        const log: string[] = [];
        const root = makeRoot(log);
        const el = new ProbeElement("el", log);
        expect(el.isConnected).toBe(false);
        root.add(el);
        expect(el.isConnected).toBe(true);
        root.remove(el);
        expect(el.isConnected).toBe(false);
    });
});

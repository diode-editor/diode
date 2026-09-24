import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import type { IStubRpc } from "./testStubRpc.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { StatusBarAlignment } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import type { IWireStatusBarItem } from "./wireTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeWindow(): { stub: IStubRpc; window: typeof vscode.window } {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    return { stub, window: createWindowNamespace(ctx) };
}

/** Только сообщения статус-бара из журнала нотификаций стаба. */
function statusBarTraffic(stub: IStubRpc): { method: string; params: IWireStatusBarItem }[] {
    return stub.notifies
        .filter((n) => n.method.startsWith("window.statusBarItem."))
        .map((n) => ({ method: n.method, params: n.params as IWireStatusBarItem }));
}

function lastUpdate(stub: IStubRpc): IWireStatusBarItem {
    const updates = statusBarTraffic(stub).filter((n) => n.method === "window.statusBarItem.update");
    const last = updates.at(-1);
    if (last === undefined) throw new Error("ни одного window.statusBarItem.update");
    return last.params;
}

describe("window.createStatusBarItem — состояние пункта в субпроцессе", () => {
    it("созданный, но не показанный пункт в проводе не появляется", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.text = "Demo";
        item.name = "Status Bar Demo";
        item.command = "demo.click";

        expect(statusBarTraffic(stub)).toEqual([]);
    });

    it("show() шлёт полное состояние пункта", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem(StatusBarAlignment.Right as vscode.StatusBarAlignment, 100);
        item.text = "$(check) Demo";
        item.name = "Status Bar Demo";
        item.command = "demo.click";
        item.show();

        // toStrictEqual, а не toEqual: сообщение не должно нести ключей со
        // значением undefined — у полосы их нечем отличить от «не задано».
        expect(lastUpdate(stub)).toStrictEqual({
            handle: 1,
            id: "status-bar-demo",
            alignment: "right",
            priority: 100,
            text: "$(check) Demo",
            name: "Status Bar Demo",
            command: "demo.click",
        });
    });

    it("у пункта без имени, команды и приоритета этих ключей в сообщении нет", () => {
        const { stub, window } = makeWindow();
        window.createStatusBarItem().show();

        expect(lastUpdate(stub)).toStrictEqual({
            handle: 1,
            id: "item-1",
            alignment: "left",
            text: "",
        });
    });

    it("правка показанного пункта доезжает до полосы", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.text = "Demo";
        item.show();
        item.text = "Demo 42";

        expect(lastUpdate(stub).text).toBe("Demo 42");
    });

    it("alignment по умолчанию — левый, приоритет отсутствует", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.text = "Demo";
        item.show();

        const update = lastUpdate(stub);
        expect(update.alignment).toBe("left");
        expect(update.priority).toBeUndefined();
        expect(item.priority).toBeUndefined();
        expect(item.alignment).toBe(StatusBarAlignment.Left);
    });

    it("перегрузка с явным id: id уезжает как есть, alignment и priority сдвинуты", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem("my.item", StatusBarAlignment.Right as vscode.StatusBarAlignment, 7);
        item.name = "Игнорируем имя, id задан явно";
        item.show();

        expect(item.id).toBe("my.item");
        expect(item.priority).toBe(7);
        expect(item.alignment).toBe(StatusBarAlignment.Right);
        expect(lastUpdate(stub)).toMatchObject({ id: "my.item", alignment: "right", priority: 7 });
    });

    it("без имени id синтезируется по счётчику и не пересекается у двух пунктов", () => {
        const { window } = makeWindow();
        const first = window.createStatusBarItem();
        const second = window.createStatusBarItem();

        expect(first.id).toBe("item-1");
        expect(second.id).toBe("item-2");
    });

    it("id по имени устойчив: то же имя — тот же id (переживает перезапуск)", () => {
        const { window } = makeWindow();
        const item = window.createStatusBarItem();
        item.name = "Status Bar Demo";

        expect(item.id).toBe("status-bar-demo");
    });

    it("имя без латиницы и цифр не даёт пустой id", () => {
        const { window } = makeWindow();
        const item = window.createStatusBarItem();
        item.name = "Привет";

        expect(item.id).toBe("item-1");
    });

    it("выставленные поля читаются обратно (расширения так и делают)", () => {
        const { window } = makeWindow();
        const item = window.createStatusBarItem();
        item.text = "Demo";
        item.name = "Status Bar Demo";
        item.command = "demo.click";

        expect(item.text).toBe("Demo");
        expect(item.name).toBe("Status Bar Demo");
        expect(item.command).toBe("demo.click");
    });

    it("hide() снимает пункт с полосы, повторный hide молчит", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.show();
        item.hide();
        item.hide();

        expect(statusBarTraffic(stub).map((n) => n.method)).toEqual([
            "window.statusBarItem.update",
            "window.statusBarItem.dispose",
        ]);
    });

    it("правка скрытого пункта в провод не уходит, а show() возвращает его с новым текстом", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.text = "Demo";
        item.show();
        item.hide();
        item.text = "Demo 42";
        expect(statusBarTraffic(stub)).toHaveLength(2);

        item.show();
        expect(lastUpdate(stub).text).toBe("Demo 42");
    });

    it("повторный show() показанного пункта не шлёт лишнего", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.show();
        item.show();

        expect(statusBarTraffic(stub)).toHaveLength(1);
    });

    it("dispose() показанного пункта снимает его с полосы", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.show();
        item.dispose();

        expect(statusBarTraffic(stub).map((n) => n.method)).toEqual([
            "window.statusBarItem.update",
            "window.statusBarItem.dispose",
        ]);
    });

    it("dispose() снимает пункт, а ручка становится инертной", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.text = "Demo";
        item.show();
        item.dispose();
        item.text = "Demo 42";
        item.show();
        item.hide();
        item.dispose();

        expect(statusBarTraffic(stub).map((n) => n.method)).toEqual([
            "window.statusBarItem.update",
            "window.statusBarItem.dispose",
        ]);
    });

    it("dispose() непоказанного пункта ничего не шлёт", () => {
        const { stub, window } = makeWindow();
        window.createStatusBarItem().dispose();

        expect(statusBarTraffic(stub)).toEqual([]);
    });

    it("команда объектом: уезжают id и аргументы", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.command = { title: "Click", command: "demo.click", arguments: [1, "two"] };
        item.show();

        expect(lastUpdate(stub)).toMatchObject({ command: "demo.click", arguments: [1, "two"] });
    });

    it("команда объектом без аргументов: ключа arguments нет", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.command = { title: "Click", command: "demo.click" };
        item.show();

        expect(lastUpdate(stub).arguments).toBeUndefined();
    });

    it("снятая команда перестаёт уезжать", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.command = "demo.click";
        item.show();
        item.command = undefined;

        expect(lastUpdate(stub).command).toBeUndefined();
    });

    it("tooltip/цвета принимаются, читаются обратно и провод не тревожат", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.show();
        const before = statusBarTraffic(stub).length;
        item.tooltip = "Подсказка";
        item.color = "#ff0000";
        item.backgroundColor = { id: "statusBarItem.errorBackground" } as vscode.ThemeColor;
        item.accessibilityInformation = { label: "Demo" };

        expect(statusBarTraffic(stub)).toHaveLength(before);
        expect(item.tooltip).toBe("Подсказка");
        expect(item.color).toBe("#ff0000");
        expect(item.backgroundColor).toEqual({ id: "statusBarItem.errorBackground" });
        expect(item.accessibilityInformation).toEqual({ label: "Demo" });
    });

    it("смена имени показанного пункта меняет и его id в проводе", () => {
        const { stub, window } = makeWindow();
        const item = window.createStatusBarItem();
        item.show();
        expect(lastUpdate(stub).id).toBe("item-1");

        item.name = "Status Bar Demo";
        expect(lastUpdate(stub)).toMatchObject({ id: "status-bar-demo", name: "Status Bar Demo" });
    });

    it("два пункта ведут независимые handle'ы", () => {
        const { stub, window } = makeWindow();
        const first = window.createStatusBarItem();
        const second = window.createStatusBarItem();
        first.show();
        second.show();
        first.hide();

        expect(statusBarTraffic(stub).map((n) => [n.method, n.params.handle])).toEqual([
            ["window.statusBarItem.update", 1],
            ["window.statusBarItem.update", 2],
            ["window.statusBarItem.dispose", 1],
        ]);
    });

    it("нечисловой priority в провод не попадает", () => {
        const { stub, window } = makeWindow();
        // Расширение может передать что угодно — типы у него необязательны.
        const item = window.createStatusBarItem(undefined, Number.NaN);
        item.show();

        expect(lastUpdate(stub).priority).toBeUndefined();
    });
});

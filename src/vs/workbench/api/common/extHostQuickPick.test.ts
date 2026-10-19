import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { ExtHostQuickPick } from "./extHostQuickPick.ts";
import { createQuickInputApi } from "./quickInputNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { QuickPickItemKind } from "./vscodeTypes.ts";

interface IValueItem extends vscode.QuickPickItem {
    readonly value?: string;
}

function setup() {
    const stub = makeStubRpc();
    const api = createQuickInputApi(stub.rpc);
    const pick = api.createQuickPick<IValueItem>();
    const updates = (): Record<string, unknown>[] =>
        stub.notifies
            .filter((n) => n.method === "window.quickPick.update")
            .map((n) => n.params as Record<string, unknown>);
    const hostEvent = (event: Record<string, unknown>): void => {
        stub.fire("window.quickPick.event", { handle: updates()[0]?.handle ?? 1, ...event });
    };
    return { stub, api, pick, updates, hostEvent };
}

const A: IValueItem = { label: "Alpha", description: "first", value: "a" };
const B: IValueItem = { label: "Beta", detail: "second", value: "b" };
const SEP: IValueItem = { label: "Group", kind: QuickPickItemKind.Separator as unknown as vscode.QuickPickItemKind };
const C: IValueItem = { label: "Gamma", alwaysShow: true };

const WIRE_A = { handle: 0, label: "Alpha", description: "first", detail: undefined, alwaysShow: false };

describe("ExtHostQuickPick — состояние и провод", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("до show() ничего не шлёт; show() отправляет накопленное одним диффом", () => {
        const { pick, updates } = setup();
        pick.title = "Pick";
        pick.placeholder = "type";
        pick.matchOnDescription = true;
        pick.items = [A, B];
        vi.runAllTimers();
        expect(updates()).toEqual([]);

        pick.show();

        expect(updates()).toEqual([
            {
                handle: expect.any(Number) as number,
                title: "Pick",
                placeholder: "type",
                matchOnDescription: true,
                items: [
                    WIRE_A,
                    { handle: 1, label: "Beta", description: undefined, detail: "second", alwaysShow: false },
                ],
                visible: true,
            },
        ]);
    });

    it("видимый пикер шлёт пачку присваиваний одним диффом на следующем тике", () => {
        const { pick, updates } = setup();
        pick.show();
        pick.prompt = "loading";
        pick.items = [A];
        pick.prompt = undefined;
        expect(updates()).toHaveLength(1);

        vi.runAllTimers();

        expect(updates()).toHaveLength(2);
        expect(updates()[1]).toEqual({ handle: expect.any(Number) as number, prompt: null, items: [WIRE_A] });
    });

    // Каждый сеттер обязан положить в дифф СВОЁ поле — под своим именем.
    it.each([
        ["title", "T"],
        ["step", 2],
        ["totalSteps", 3],
        ["value", "v"],
        ["placeholder", "ph"],
        ["prompt", "pr"],
        ["canSelectMany", true],
        ["matchOnDescription", false],
        ["matchOnDetail", false],
        ["keepScrollPosition", true],
    ] as const)("сеттер %s уходит хосту и читается обратно", (key, value) => {
        const { pick, updates } = setup();
        pick.show();
        (pick as unknown as Record<string, unknown>)[key] = value;
        vi.runAllTimers();
        expect(updates().at(-1)).toEqual({ handle: expect.any(Number) as number, [key]: value });
        expect((pick as unknown as Record<string, unknown>)[key]).toBe(value);
    });

    it("busy, enabled и ignoreFocusOut хранятся, но хосту не едут: рисовать их нечем", () => {
        const { pick, updates } = setup();
        pick.show();
        pick.busy = true;
        pick.enabled = false;
        pick.ignoreFocusOut = false;
        vi.runAllTimers();
        expect(updates()).toHaveLength(1);
        expect(pick).toMatchObject({ busy: true, enabled: false, ignoreFocusOut: false });
    });

    it("сброс в undefined едет null-ом, а hide() — немедленно", () => {
        const { pick, updates } = setup();
        pick.title = "x";
        pick.show();
        pick.title = undefined;
        pick.hide();
        expect(updates().at(-1)).toEqual({ handle: expect.any(Number) as number, title: null, visible: false });
        // Отложенный дифф ушёл вместе с hide() — пустой второй не нужен.
        vi.runAllTimers();
        expect(updates()).toHaveLength(2);
    });

    it("после показа, снявшего отложенный дифф, новые присваивания снова доходят", () => {
        const { pick, updates } = setup();
        pick.show();
        pick.title = "a";
        pick.show();
        pick.title = "b";
        vi.runAllTimers();
        expect(updates().at(-1)).toEqual({ handle: expect.any(Number) as number, title: "b" });
    });

    it("разделитель не едет строкой, а handle'ы остальных — индексы в массиве расширения", () => {
        const { pick, updates } = setup();
        pick.items = [A, SEP, C];
        pick.show();
        expect(updates()[0]?.items).toEqual([
            WIRE_A,
            { handle: 2, label: "Gamma", description: undefined, detail: undefined, alwaysShow: true },
        ]);
    });

    it("items — копия: правка своего массива после присваивания пикер не трогает", () => {
        const { pick } = setup();
        const mine = [A, B];
        pick.items = mine;
        mine.push(C);
        expect(pick.items).toEqual([A, B]);
    });

    it("activeItems/selectedItems — handle'ами; чужие предметы отсеиваются", () => {
        const { pick, updates } = setup();
        pick.items = [A, B];
        pick.activeItems = [B, { label: "чужой" }];
        pick.selectedItems = [{ label: "чужой" }, A];
        pick.show();
        expect(updates()[0]).toMatchObject({ activeItems: [1], selectedItems: [0] });
        expect(pick.activeItems).toEqual([B]);
        expect(pick.selectedItems).toEqual([A]);
    });

    it("после замены items прежние предметы — уже чужие", () => {
        const { pick, hostEvent } = setup();
        pick.items = [A, B];
        pick.items = [C];
        pick.activeItems = [A];
        expect(pick.activeItems).toEqual([]);
        pick.show();
        hostEvent({ kind: "changeSelection", items: [0, 1] });
        expect(pick.selectedItems).toEqual([C]);
    });

    it("геттеры по умолчанию — дефолты эталона", () => {
        const { pick } = setup();
        expect(pick).toMatchObject({
            value: "",
            enabled: true,
            busy: false,
            ignoreFocusOut: true,
            canSelectMany: false,
            matchOnDescription: true,
            matchOnDetail: true,
            keepScrollPosition: false,
            title: undefined,
            step: undefined,
            totalSteps: undefined,
            placeholder: undefined,
            prompt: undefined,
            items: [],
            activeItems: [],
            selectedItems: [],
        });
    });

    it("dispose шлёт снятие со своим handle, гасит отложенный дифф и дальше молчит", () => {
        const { stub, pick, updates } = setup();
        pick.show();
        pick.title = "late";
        pick.dispose();
        pick.dispose();
        vi.runAllTimers();
        pick.title = "after";
        pick.show();

        expect(updates()).toHaveLength(1);
        const disposes = stub.notifies.filter((n) => n.method === "window.quickPick.dispose");
        expect(disposes.map((n) => n.params)).toEqual([{ handle: updates()[0]?.handle }]);
    });

    it("снятый пикер забыт: события хоста про него больше ничего не меняют", () => {
        const { pick, hostEvent } = setup();
        pick.show();
        pick.dispose();
        hostEvent({ kind: "changeValue", value: "late" });
        expect(pick.value).toBe("");
    });

    it("handle'ы пикеров и show*-показов — из одного счётчика", () => {
        const { api, pick, updates, stub } = setup();
        pick.show();
        void api.showInputBox();
        const second = api.createQuickPick();
        second.show();
        const handles = updates().map((u) => u.handle as number);
        const inputHandle = (stub.requests.at(-1)?.params as { handle: number }).handle;
        expect(new Set([...handles, inputHandle]).size).toBe(3);
    });
});

describe("ExtHostQuickPick — события хоста", () => {
    it("changeValue обновляет value и файрит onDidChangeValue", () => {
        const { pick, hostEvent } = setup();
        pick.show();
        const seen: string[] = [];
        pick.onDidChangeValue((value) => seen.push(value));
        hostEvent({ kind: "changeValue", value: "be" });
        expect(seen).toEqual(["be"]);
        expect(pick.value).toBe("be");
    });

    it("changeActive/changeSelection отдают СВОИ объекты расширения, чужой handle выпадает", () => {
        const { pick, hostEvent } = setup();
        pick.items = [A, SEP, B];
        pick.show();
        const active: (readonly IValueItem[])[] = [];
        const selected: (readonly IValueItem[])[] = [];
        pick.onDidChangeActive((items) => active.push(items));
        pick.onDidChangeSelection((items) => selected.push(items));

        hostEvent({ kind: "changeActive", items: [2] });
        hostEvent({ kind: "changeSelection", items: [0, 99, -1] });

        expect(active[0]?.[0]).toBe(B);
        expect(selected[0]).toEqual([A]);
        expect(selected[0]?.[0]).toBe(A);
        expect(pick.activeItems).toEqual([B]);
        expect(pick.selectedItems).toEqual([A]);
    });

    it("accept — onDidAccept", () => {
        const { pick, hostEvent } = setup();
        pick.show();
        let accepted = 0;
        pick.onDidAccept(() => accepted++);
        hostEvent({ kind: "accept" });
        expect(accepted).toBe(1);
    });

    it("hide() расширения: onDidHide один раз — на ответ хоста, dispose после него молчит", () => {
        const { pick, hostEvent } = setup();
        let hides = 0;
        pick.onDidHide(() => hides++);
        pick.show();
        pick.hide();
        hostEvent({ kind: "hide" });
        pick.dispose();
        expect(hides).toBe(1);
    });

    it("Escape (hide хоста без hide() расширения) и затем dispose — два onDidHide, как в эталоне", () => {
        const { pick, hostEvent } = setup();
        let hides = 0;
        pick.onDidHide(() => hides++);
        pick.show();
        hostEvent({ kind: "hide" });
        pick.dispose();
        expect(hides).toBe(2);
    });

    it("show → hide → show → hide: два onDidHide (эталон, #135747)", () => {
        const { pick, hostEvent } = setup();
        let hides = 0;
        pick.onDidHide(() => hides++);
        pick.show();
        pick.hide();
        pick.show();
        // Ответ хоста на первый hide() приходит уже во время второго показа.
        hostEvent({ kind: "hide" });
        pick.hide();
        hostEvent({ kind: "hide" });
        expect(hides).toBe(2);
    });

    it("show → hide → hide: один onDidHide", () => {
        const { pick, hostEvent } = setup();
        let hides = 0;
        pick.onDidHide(() => hides++);
        pick.show();
        pick.hide();
        pick.hide();
        hostEvent({ kind: "hide" });
        hostEvent({ kind: "hide" });
        expect(hides).toBe(1);
    });

    it("dispose видимого пикера сам сообщает о скрытии; нескрытого — нет", () => {
        const visible = setup();
        let hides = 0;
        visible.pick.onDidHide(() => hides++);
        visible.pick.show();
        visible.pick.dispose();
        expect(hides).toBe(1);

        const never = setup();
        let neverHides = 0;
        never.pick.onDidHide(() => neverHides++);
        never.pick.dispose();
        expect(neverHides).toBe(0);
    });

    it("после dispose подписчики отписаны: ни одно событие до них не доходит", () => {
        const stub = makeStubRpc();
        const pick = new ExtHostQuickPick<IValueItem>(stub.rpc, 1, () => undefined);
        pick.items = [A];
        const heard: string[] = [];
        pick.onDidChangeValue(() => heard.push("value"));
        pick.onDidAccept(() => heard.push("accept"));
        pick.onDidChangeActive(() => heard.push("active"));
        pick.onDidChangeSelection(() => heard.push("selection"));
        pick.onDidHide(() => heard.push("hide"));
        pick.dispose();

        pick.acceptEvent({ handle: 1, kind: "changeValue", value: "x" });
        pick.acceptEvent({ handle: 1, kind: "accept" });
        pick.acceptEvent({ handle: 1, kind: "changeActive", items: [0] });
        pick.acceptEvent({ handle: 1, kind: "changeSelection", items: [0] });
        pick.show();
        pick.acceptEvent({ handle: 1, kind: "hide" });
        expect(heard).toEqual([]);
    });

    it("событие снятого пикера и мусорное событие никого не роняют", () => {
        const { pick, hostEvent, stub } = setup();
        pick.show();
        pick.dispose();
        expect(() => {
            hostEvent({ kind: "accept" });
            stub.fire("window.quickPick.event", { kind: "accept" });
            stub.fire("window.quickPick.event", null);
        }).not.toThrow();
    });
});

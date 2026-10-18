import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

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
                    { handle: 0, label: "Alpha", description: "first", detail: undefined, alwaysShow: false },
                    { handle: 1, label: "Beta", description: undefined, detail: "second", alwaysShow: false },
                ],
                visible: true,
            },
        ]);
    });

    it("видимый пикер шлёт пачку присваиваний одним диффом на следующем тике", () => {
        const { pick, updates } = setup();
        pick.show();
        pick.busy = true;
        pick.items = [A];
        pick.busy = false;
        expect(updates()).toHaveLength(1);

        vi.runAllTimers();

        expect(updates()).toHaveLength(2);
        expect(updates()[1]).toEqual({
            handle: expect.any(Number) as number,
            busy: false,
            items: [{ handle: 0, label: "Alpha", description: "first", detail: undefined, alwaysShow: false }],
        });
    });

    it("сброс в undefined едет null-ом, а hide() — немедленно", () => {
        const { pick, updates } = setup();
        pick.title = "x";
        pick.show();
        pick.title = undefined;
        pick.hide();
        expect(updates().at(-1)).toEqual({ handle: expect.any(Number) as number, title: null, visible: false });
    });

    it("разделитель не едет строкой, а handle'ы остальных — индексы в массиве расширения", () => {
        const { pick, updates } = setup();
        pick.items = [A, SEP, C];
        pick.show();
        expect(updates()[0]?.items).toEqual([
            { handle: 0, label: "Alpha", description: "first", detail: undefined, alwaysShow: false },
            { handle: 2, label: "Gamma", description: undefined, detail: undefined, alwaysShow: true },
        ]);
    });

    it("activeItems/selectedItems — handle'ами; чужие предметы отсеиваются", () => {
        const { pick, updates } = setup();
        pick.items = [A, B];
        pick.activeItems = [B, { label: "чужой" }];
        pick.selectedItems = [A];
        pick.show();
        expect(updates()[0]).toMatchObject({ activeItems: [1], selectedItems: [0] });
        expect(pick.activeItems).toEqual([B]);
        expect(pick.selectedItems).toEqual([A]);
    });

    it("геттеры отвечают своим состоянием сразу, с дефолтами эталона", () => {
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
        });
        pick.step = 2;
        pick.totalSteps = 3;
        pick.enabled = false;
        pick.prompt = "p";
        pick.value = "v";
        pick.canSelectMany = true;
        pick.matchOnDetail = false;
        pick.keepScrollPosition = true;
        pick.ignoreFocusOut = false;
        expect(pick).toMatchObject({
            step: 2,
            totalSteps: 3,
            enabled: false,
            prompt: "p",
            value: "v",
            canSelectMany: true,
            matchOnDetail: false,
            keepScrollPosition: true,
            ignoreFocusOut: false,
        });
    });

    it("ignoreFocusOut хосту не уезжает: у оверлея такой опции нет", () => {
        const { pick, updates } = setup();
        pick.ignoreFocusOut = false;
        pick.show();
        expect(updates()[0]).not.toHaveProperty("ignoreFocusOut");
    });

    it("dispose шлёт снятие, гасит отложенный дифф и дальше молчит", () => {
        const { stub, pick, updates } = setup();
        pick.show();
        pick.title = "late";
        pick.dispose();
        pick.dispose();
        vi.runAllTimers();
        pick.title = "after";
        pick.show();

        expect(updates()).toHaveLength(1);
        expect(stub.notifies.filter((n) => n.method === "window.quickPick.dispose")).toHaveLength(1);
    });

    it("handle'ы пикеров и show*-показов — из одного счётчика", () => {
        const { api, pick, updates, stub } = setup();
        const second = api.createQuickPick();
        pick.show();
        second.show();
        void api.showInputBox();
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
        hostEvent({ kind: "changeSelection", items: [0, 99] });

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

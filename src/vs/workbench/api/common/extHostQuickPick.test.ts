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

describe("ExtHostQuickPick: state and wire", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("sends nothing before show(); show() sends the accumulated state as one diff", () => {
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

    it("a visible picker sends a batch of assignments as one diff on the next tick", () => {
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
    ] as const)("setter %s goes to the host and reads back", (key, value) => {
        const { pick, updates } = setup();
        pick.show();
        (pick as unknown as Record<string, unknown>)[key] = value;
        vi.runAllTimers();
        expect(updates().at(-1)).toEqual({ handle: expect.any(Number) as number, [key]: value });
        expect((pick as unknown as Record<string, unknown>)[key]).toBe(value);
    });

    it("busy, enabled and ignoreFocusOut are stored but not sent to the host: nothing renders them", () => {
        const { pick, updates } = setup();
        pick.show();
        pick.busy = true;
        pick.enabled = false;
        pick.ignoreFocusOut = false;
        vi.runAllTimers();
        expect(updates()).toHaveLength(1);
        expect(pick).toMatchObject({ busy: true, enabled: false, ignoreFocusOut: false });
    });

    it("reset to undefined is sent as null, and hide() is sent immediately", () => {
        const { pick, updates } = setup();
        pick.title = "x";
        pick.show();
        pick.title = undefined;
        pick.hide();
        expect(updates().at(-1)).toEqual({ handle: expect.any(Number) as number, title: null, visible: false });
        vi.runAllTimers();
        expect(updates()).toHaveLength(2);
    });

    it("after a show that flushed the pending diff, new assignments get through again", () => {
        const { pick, updates } = setup();
        pick.show();
        pick.title = "a";
        pick.show();
        pick.title = "b";
        vi.runAllTimers();
        expect(updates().at(-1)).toEqual({ handle: expect.any(Number) as number, title: "b" });
    });

    it("a separator is not sent as a row, and the others' handles are indices in the extension's array", () => {
        const { pick, updates } = setup();
        pick.items = [A, SEP, C];
        pick.show();
        expect(updates()[0]?.items).toEqual([
            WIRE_A,
            { handle: 2, label: "Gamma", description: undefined, detail: undefined, alwaysShow: true },
        ]);
    });

    it("items is a copy: editing your own array after assignment leaves the picker alone", () => {
        const { pick } = setup();
        const mine = [A, B];
        pick.items = mine;
        mine.push(C);
        expect(pick.items).toEqual([A, B]);
    });

    it("activeItems/selectedItems are sent as handles; foreign items are filtered out", () => {
        const { pick, updates } = setup();
        pick.items = [A, B];
        pick.activeItems = [B, { label: "foreign" }];
        pick.selectedItems = [{ label: "foreign" }, A];
        pick.show();
        expect(updates()[0]).toMatchObject({ activeItems: [1], selectedItems: [0] });
        expect(pick.activeItems).toEqual([B]);
        expect(pick.selectedItems).toEqual([A]);
    });

    it("after items are replaced, the previous items are foreign", () => {
        const { pick, hostEvent } = setup();
        pick.items = [A, B];
        pick.items = [C];
        pick.activeItems = [A];
        expect(pick.activeItems).toEqual([]);
        pick.show();
        hostEvent({ kind: "changeSelection", items: [0, 1] });
        expect(pick.selectedItems).toEqual([C]);
    });

    it("getters default to upstream defaults", () => {
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

    it("dispose sends a removal with its handle, drops the pending diff and stays silent afterwards", () => {
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

    it("a disposed picker is forgotten: host events about it no longer change anything", () => {
        const { pick, hostEvent } = setup();
        pick.show();
        pick.dispose();
        hostEvent({ kind: "changeValue", value: "late" });
        expect(pick.value).toBe("");
    });

    it("picker handles and show* input handles come from one counter", () => {
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

describe("ExtHostQuickPick: host events", () => {
    it("changeValue updates value and fires onDidChangeValue", () => {
        const { pick, hostEvent } = setup();
        pick.show();
        const seen: string[] = [];
        pick.onDidChangeValue((value) => seen.push(value));
        hostEvent({ kind: "changeValue", value: "be" });
        expect(seen).toEqual(["be"]);
        expect(pick.value).toBe("be");
    });

    it("changeActive/changeSelection yield the extension's OWN objects, a foreign handle is dropped", () => {
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

    it("extension hide(): onDidHide fires once on the host's reply, dispose after it is silent", () => {
        const { pick, hostEvent } = setup();
        let hides = 0;
        pick.onDidHide(() => hides++);
        pick.show();
        pick.hide();
        hostEvent({ kind: "hide" });
        pick.dispose();
        expect(hides).toBe(1);
    });

    it("Escape (host hide without extension hide()) then dispose: two onDidHide, as upstream", () => {
        const { pick, hostEvent } = setup();
        let hides = 0;
        pick.onDidHide(() => hides++);
        pick.show();
        hostEvent({ kind: "hide" });
        pick.dispose();
        expect(hides).toBe(2);
    });

    it("show -> hide -> show -> hide: two onDidHide (upstream, #135747)", () => {
        const { pick, hostEvent } = setup();
        let hides = 0;
        pick.onDidHide(() => hides++);
        pick.show();
        pick.hide();
        pick.show();
        hostEvent({ kind: "hide" });
        pick.hide();
        hostEvent({ kind: "hide" });
        expect(hides).toBe(2);
    });

    it("show -> hide -> hide: one onDidHide", () => {
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

    it("dispose of a visible picker reports hiding itself; of a hidden one it does not", () => {
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

    it("after dispose subscribers are unsubscribed: no event reaches them", () => {
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

    it("an event for a disposed picker and a garbage event crash nothing", () => {
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

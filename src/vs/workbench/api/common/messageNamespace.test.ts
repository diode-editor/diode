import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createMessageApi, messageItemsOf, notifyMessage } from "./messageNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";

function makeApi() {
    const stub = makeStubRpc();
    return { stub, api: createMessageApi(stub.rpc) };
}

/** Параметры последнего исходящего `window.showMessage`. */
function lastShowMessage(stub: ReturnType<typeof makeStubRpc>): Record<string, unknown> {
    const found = [...stub.requests].reverse().find((r) => r.method === "window.showMessage");
    if (found === undefined) throw new Error('нет запроса "window.showMessage"');
    return found.params as Record<string, unknown>;
}

describe("messageItemsOf", () => {
    it("строки-пункты идут как есть", () => {
        expect(messageItemsOf(["Yes", "No"])).toEqual(["Yes", "No"]);
    });

    it("первый объект БЕЗ title — это MessageOptions: он не пункт", () => {
        const items = messageItemsOf([{ modal: true }, "Yes"]);
        expect(items).toEqual(["Yes"]);
    });

    it("первый объект С title — это MessageItem, а не опции", () => {
        const item: vscode.MessageItem = { title: "Retry" };
        expect(messageItemsOf([item])).toEqual([item]);
    });

    it("пустой хвост аргументов — пустой список пунктов", () => {
        expect(messageItemsOf([])).toEqual([]);
    });

    it("null на месте опций не роняет разбор (расширение на JS)", () => {
        expect(messageItemsOf([null as unknown as vscode.MessageOptions, "Yes"])).toEqual([null, "Yes"]);
    });
});

describe("createMessageApi", () => {
    it("severity по методу; пункты уезжают подписями", async () => {
        const { stub, api } = makeApi();
        await api.showErrorMessage("boom");
        await api.showWarningMessage("careful");
        await api.showInformationMessage("fyi", "Activate", "Use free version");
        expect(stub.requests).toEqual([
            { method: "window.showMessage", params: { severity: "error", message: "boom", items: [] } },
            { method: "window.showMessage", params: { severity: "warn", message: "careful", items: [] } },
            {
                method: "window.showMessage",
                params: { severity: "info", message: "fyi", items: ["Activate", "Use free version"] },
            },
        ]);
    });

    it("ответ индексом резолвится выбранной СТРОКОЙ", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ index: 1 });
        await expect(api.showInformationMessage("fyi", "Activate", "Free")).resolves.toBe("Free");
    });

    it("перегрузка MessageItem возвращает ТОТ ЖЕ объект расширения", async () => {
        const { stub, api } = makeApi();
        const retry: vscode.MessageItem = { title: "Retry" };
        const cancel: vscode.MessageItem = { title: "Cancel", isCloseAffordance: true };
        stub.responder = () => ({ index: 0 });
        const picked = await api.showErrorMessage("boom", retry, cancel);
        expect(picked).toBe(retry);
        expect(lastShowMessage(stub).items).toEqual(["Retry", "Cancel"]);
    });

    it("`MessageOptions` не уезжает кнопкой (и не возвращается ответом)", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ index: 0 });
        const picked = await api.showWarningMessage("careful", { modal: true, detail: "подробности" }, "OK");
        expect(lastShowMessage(stub).items).toEqual(["OK"]);
        expect(picked).toBe("OK");
    });

    it("`index: null` (человек закрыл) — undefined", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ index: null });
        await expect(api.showInformationMessage("fyi", "Activate")).resolves.toBeUndefined();
    });

    it("индекс за пределами списка — undefined, а не дыра в предметах", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ index: 7 });
        await expect(api.showInformationMessage("fyi", "Activate")).resolves.toBeUndefined();
    });

    it("молчание хоста — undefined (сообщение без кнопок никого не держит)", async () => {
        const { api } = makeApi();
        await expect(api.showInformationMessage("fyi")).resolves.toBeUndefined();
    });

    it("нестроковый title уезжает как есть — нормализует разбор на проводе", async () => {
        const { stub, api } = makeApi();
        await api.showInformationMessage("fyi", { title: 7 } as unknown as vscode.MessageItem);
        expect(lastShowMessage(stub).items).toEqual([7]);
    });
});

describe("notifyMessage", () => {
    it("шлёт запрос и не ждёт ответа", () => {
        const stub = makeStubRpc();
        notifyMessage(stub.rpc, "warn", "не поддержано");
        expect(stub.requests).toEqual([
            { method: "window.showMessage", params: { severity: "warn", message: "не поддержано", items: [] } },
        ]);
    });

    it("отказ канала проглатывается: необработанный rejection убил бы субпроцесс", async () => {
        const stub = makeStubRpc();
        // Настоящий RpcEndpoint.request отказывает ПРОМИСОМ (канал закрыт, хост
        // умер), синхронно он не кидает никогда — воспроизводим именно это.
        stub.responder = () => Promise.reject(new Error("channel closed"));
        notifyMessage(stub.rpc, "info", "x");
        // Прокручиваем микротаски: незаглушенный rejection всплыл бы здесь
        // unhandled-ошибкой и уронил бы прогон.
        await Promise.resolve();
        await Promise.resolve();
        expect(stub.requests).toHaveLength(1);
    });
});

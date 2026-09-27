import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createMessageApi, parseMessageArgs, toWireMessageItem } from "./messageNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";

describe("parseMessageArgs — четыре перегрузки show*Message", () => {
    it("без аргументов после текста кнопок нет", () => {
        expect(parseMessageArgs(undefined, [])).toEqual({ modal: false, items: [] });
    });

    it("строки после текста — это кнопки", () => {
        expect(parseMessageArgs("Activate", ["Free"])).toEqual({
            modal: false,
            items: ["Activate", "Free"],
        });
    });

    it("объект с `title` — это кнопка, а не опции", () => {
        const item = { title: "Retry" };
        expect(parseMessageArgs(item, [])).toEqual({ modal: false, items: [item] });
    });

    it("объект без `title` — это MessageOptions, кнопки начинаются с третьего аргумента", () => {
        expect(parseMessageArgs({ modal: true, detail: "нельзя отменить" }, ["Delete"])).toEqual({
            modal: true,
            detail: "нельзя отменить",
            items: ["Delete"],
        });
    });

    it("пустой detail — то же, что его отсутствие", () => {
        expect(parseMessageArgs({ modal: true, detail: "" }, [])).toEqual({ modal: true, items: [] });
    });

    it("не-строковый detail отбрасывается, а не едет как есть", () => {
        expect(parseMessageArgs({ modal: true, detail: 7 }, [])).toEqual({ modal: true, items: [] });
    });

    it("мусор вместо опций читается как «опций нет», а не роняет показ", () => {
        // Расширение на JS вправе прислать что угодно; ронять его показ нельзя.
        expect(parseMessageArgs(null, ["One"])).toEqual({ modal: false, items: ["One"] });
        expect(parseMessageArgs(7, ["One"])).toEqual({ modal: false, items: ["One"] });
    });

    it("modal только по строгому true", () => {
        expect(parseMessageArgs({ modal: "yes" }, []).modal).toBe(false);
    });

    it("опции без modal дают немодальное сообщение", () => {
        expect(parseMessageArgs({ detail: "текст" }, ["One"])).toEqual({
            modal: false,
            detail: "текст",
            items: ["One"],
        });
    });
});

describe("toWireMessageItem", () => {
    it("строковая кнопка сама себе заголовок", () => {
        expect(toWireMessageItem("Activate")).toEqual({ title: "Activate", isCloseAffordance: false });
    });

    it("MessageItem переносит isCloseAffordance", () => {
        expect(toWireMessageItem({ title: "Cancel", isCloseAffordance: true })).toEqual({
            title: "Cancel",
            isCloseAffordance: true,
        });
    });

    it("MessageItem без флага — не close affordance", () => {
        expect(toWireMessageItem({ title: "Retry" })).toEqual({ title: "Retry", isCloseAffordance: false });
    });
});

describe("createMessageApi", () => {
    it("шлёт запрос с severity, текстом и кнопками", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: null });
        const api = createMessageApi(stub.rpc);

        await api.showWarningMessage("careful", "Activate", "Free");

        expect(stub.requests).toEqual([
            {
                method: "window.showMessage",
                params: {
                    severity: "warn",
                    message: "careful",
                    modal: false,
                    items: [
                        { title: "Activate", isCloseAffordance: false },
                        { title: "Free", isCloseAffordance: false },
                    ],
                },
            },
        ]);
    });

    it("severity у трёх перегрузок разная", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: null });
        const api = createMessageApi(stub.rpc);

        await api.showInformationMessage("i");
        await api.showWarningMessage("w");
        await api.showErrorMessage("e");

        expect(stub.requests.map((r) => (r.params as { severity: string }).severity)).toEqual([
            "info",
            "warn",
            "error",
        ]);
    });

    it("modal и detail уезжают из MessageOptions", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: null });
        const api = createMessageApi(stub.rpc);

        await api.showWarningMessage("Delete?", { modal: true, detail: "нельзя отменить" }, "Delete");

        expect(stub.requests[0]?.params).toMatchObject({ modal: true, detail: "нельзя отменить" });
    });

    it("возвращает ТОТ ЖЕ объект кнопки, что прислало расширение", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: 1 });
        const api = createMessageApi(stub.rpc);

        const retry: vscode.MessageItem = { title: "Retry" };
        const cancel: vscode.MessageItem = { title: "Cancel", isCloseAffordance: true };
        const answer = await api.showErrorMessage("failed", retry, cancel);

        expect(answer).toBe(cancel);
    });

    it("null в ответе — закрыто без выбора", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: null });
        const api = createMessageApi(stub.rpc);

        await expect(api.showInformationMessage("hi", "One")).resolves.toBeUndefined();
    });

    it("индекс за пределами кнопок — ответ не про этот показ, отдаём undefined", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: 7 });
        const api = createMessageApi(stub.rpc);

        await expect(api.showInformationMessage("hi", "One")).resolves.toBeUndefined();
    });

    it("не-строку в тексте показываем строковым представлением, а не роняем показ", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ index: null });
        const api = createMessageApi(stub.rpc);

        await api.showInformationMessage(7 as unknown as string);

        expect((stub.requests[0]?.params as { message: string }).message).toBe("7");
    });
});

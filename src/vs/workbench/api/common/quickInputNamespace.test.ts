import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createQuickInputApi, toWireQuickPickItem, toWireValidation } from "./quickInputNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { CancellationTokenSource, InputBoxValidationSeverity } from "./vscodeTypes.ts";

function makeApi() {
    const stub = makeStubRpc();
    return { stub, api: createQuickInputApi(stub.rpc) };
}

/**
 * Ответ хоста, который тест резолвит руками, — им держим показ открытым, пока
 * идут запросы валидации.
 */
function pendingAnswer(): { promise: Promise<unknown>; answer: (value: unknown) => void } {
    let answer!: (value: unknown) => void;
    const promise = new Promise<unknown>((resolve) => {
        answer = resolve;
    });
    return { promise, answer };
}

/** Последний исходящий запрос указанного метода. */
function lastRequest(stub: ReturnType<typeof makeStubRpc>, method: string): Record<string, unknown> {
    const found = [...stub.requests].reverse().find((r) => r.method === method);
    if (found === undefined) throw new Error(`нет запроса "${method}"`);
    return found.params as Record<string, unknown>;
}

describe("toWireValidation", () => {
    it("голая строка — ошибка", () => {
        expect(toWireValidation("нельзя")).toEqual({ message: "нельзя", severity: "error" });
    });

    it("пустая строка, null и undefined — значение в порядке", () => {
        expect(toWireValidation("")).toBeNull();
        expect(toWireValidation(null)).toBeNull();
        expect(toWireValidation(undefined)).toBeNull();
    });

    it("объектная форма несёт свою строгость", () => {
        expect(toWireValidation({ message: "ой", severity: InputBoxValidationSeverity.Warning } as never)).toEqual({
            message: "ой",
            severity: "warning",
        });
        expect(toWireValidation({ message: "к сведению", severity: InputBoxValidationSeverity.Info } as never)).toEqual(
            { message: "к сведению", severity: "info" },
        );
        expect(toWireValidation({ message: "беда", severity: InputBoxValidationSeverity.Error } as never)).toEqual({
            message: "беда",
            severity: "error",
        });
    });

    it("объект без внятного сообщения — значение в порядке", () => {
        expect(toWireValidation({ message: "", severity: InputBoxValidationSeverity.Error } as never)).toBeNull();
        expect(toWireValidation({ severity: InputBoxValidationSeverity.Error } as never)).toBeNull();
    });

    it("незнакомая строгость трактуется как ошибка", () => {
        expect(toWireValidation({ message: "x", severity: 99 } as never)).toEqual({ message: "x", severity: "error" });
    });
});

describe("toWireQuickPickItem", () => {
    it("строковый пункт сам себе лейбл", () => {
        expect(toWireQuickPickItem("apple")).toEqual({ label: "apple" });
    });

    it("описание уезжает как есть", () => {
        expect(toWireQuickPickItem({ label: "TS", description: ".ts" })).toEqual({ label: "TS", description: ".ts" });
    });

    it("detail показывается на месте описания, когда описания нет", () => {
        expect(toWireQuickPickItem({ label: "TS", detail: "подробности" })).toEqual({
            label: "TS",
            description: "подробности",
        });
    });

    it("при обоих заполненных полях побеждает описание", () => {
        expect(toWireQuickPickItem({ label: "TS", description: ".ts", detail: "подробности" })).toEqual({
            label: "TS",
            description: ".ts",
        });
    });

    it("пустое описание уступает место detail", () => {
        expect(toWireQuickPickItem({ label: "TS", description: "", detail: "подробности" })).toEqual({
            label: "TS",
            description: "подробности",
        });
    });

    it("без обоих полей описания в проводе нет", () => {
        expect(toWireQuickPickItem({ label: "TS" })).toEqual({ label: "TS" });
    });
});

describe("window.showInputBox (шим)", () => {
    it("шлёт опции хосту и резолвится введённым", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "Ада" });
        const result = await api.showInputBox({
            title: "Your name",
            prompt: "Как к вам обращаться",
            placeHolder: "имя",
            value: "seed",
        });
        expect(result).toBe("Ада");
        expect(lastRequest(stub, "window.showInputBox")).toMatchObject({
            title: "Your name",
            prompt: "Как к вам обращаться",
            placeHolder: "имя",
            value: "seed",
            validates: false,
        });
    });

    it("отмена хоста — undefined", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: null });
        await expect(api.showInputBox({})).resolves.toBeUndefined();
    });

    it("пустая строка — не отмена", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "" });
        await expect(api.showInputBox({})).resolves.toBe("");
    });

    it("наличие validateInput объявляется хосту флагом", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "x" });
        await api.showInputBox({ validateInput: () => null });
        expect(lastRequest(stub, "window.showInputBox").validates).toBe(true);
    });

    it("хост спрашивает валидацию по handle и получает разобранный ответ", async () => {
        const { stub, api } = makeApi();
        let handle = 0;
        stub.responder = (_method, params) => {
            handle = (params as { handle: number }).handle;
            return { value: "x" };
        };
        const pending = api.showInputBox({
            validateInput: (value) => (value === "плохо" ? "Только цифры" : null),
        });
        await pending;
        // Валидатор живёт, пока показ не закрылся: спрашиваем в рамках того же handle.
        const { api: api2, stub: stub2 } = makeApi();
        let liveHandle = 0;
        const show = pendingAnswer();
        stub2.responder = (_m, params) => {
            liveHandle = (params as { handle: number }).handle;
            return show.promise;
        };
        const live = api2.showInputBox({ validateInput: (value) => (value === "плохо" ? "Только цифры" : null) });
        await Promise.resolve();
        await expect(
            stub2.callRequest("window.inputBox.validate", { handle: liveHandle, value: "плохо" }),
        ).resolves.toEqual({ message: "Только цифры", severity: "error" });
        await expect(
            stub2.callRequest("window.inputBox.validate", { handle: liveHandle, value: "8080" }),
        ).resolves.toBeNull();
        show.answer({ value: "8080" });
        await live;
        expect(handle).toBeGreaterThan(0);
    });

    it("валидация асинхронного валидатора дожидается его ответа", async () => {
        const { stub, api } = makeApi();
        let liveHandle = 0;
        const show = pendingAnswer();
        stub.responder = (_m, params) => {
            liveHandle = (params as { handle: number }).handle;
            return show.promise;
        };
        const live = api.showInputBox({
            validateInput: async (value) => (value === "" ? null : `Проверено: ${value}`),
        });
        await Promise.resolve();
        await expect(
            stub.callRequest("window.inputBox.validate", { handle: liveHandle, value: "ab" }),
        ).resolves.toEqual({ message: "Проверено: ab", severity: "error" });
        show.answer({ value: "ab" });
        await live;
    });

    it("запрос валидации с чужим или закрытым handle — «в порядке»", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "x" });
        await api.showInputBox({ validateInput: () => "нельзя" });
        // Показ закрыт — валидатора по этому handle больше нет.
        await expect(stub.callRequest("window.inputBox.validate", { handle: 1, value: "y" })).resolves.toBeNull();
        await expect(stub.callRequest("window.inputBox.validate", { handle: 999, value: "y" })).resolves.toBeNull();
    });

    it("мусорные параметры валидации не роняют шим", async () => {
        const { stub } = makeApi();
        await expect(stub.callRequest("window.inputBox.validate", {})).resolves.toBeNull();
        await expect(stub.callRequest("window.inputBox.validate", { handle: 1 })).resolves.toBeNull();
    });

    it("токен отмены шлёт хосту снятие показа с его handle", async () => {
        const { stub, api } = makeApi();
        const show = pendingAnswer();
        let liveHandle = 0;
        stub.responder = (_m, params) => {
            liveHandle = (params as { handle: number }).handle;
            return show.promise;
        };
        const source = new CancellationTokenSource();
        const pending = api.showInputBox({}, source.token as unknown as vscode.CancellationToken);
        await Promise.resolve();
        source.cancel();
        expect(stub.notifies).toContainEqual({
            method: "window.quickInput.cancel",
            params: { handle: liveHandle },
        });
        show.answer({ value: null });
        await expect(pending).resolves.toBeUndefined();
    });

    it("без опций вовсе показ поднимается на дефолтах", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "x" });
        await expect(api.showInputBox()).resolves.toBe("x");
        expect(lastRequest(stub, "window.showInputBox")).toMatchObject({ validates: false });
    });

    it("handle показа монотонно растёт — два показа не путаются", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "x" });
        await api.showInputBox({});
        const first = lastRequest(stub, "window.showInputBox").handle as number;
        await api.showInputBox({});
        const second = lastRequest(stub, "window.showInputBox").handle as number;
        expect(second).toBeGreaterThan(first);
    });

    it("нестроковое значение в запросе валидации до валидатора не доходит", async () => {
        const { stub, api } = makeApi();
        const show = pendingAnswer();
        let liveHandle = 0;
        let asked = 0;
        stub.responder = (_m, params) => {
            liveHandle = (params as { handle: number }).handle;
            return show.promise;
        };
        const live = api.showInputBox({
            validateInput: () => {
                asked++;
                return "нельзя";
            },
        });
        await Promise.resolve();
        await expect(
            stub.callRequest("window.inputBox.validate", { handle: liveHandle, value: 7 }),
        ).resolves.toBeNull();
        expect(asked).toBe(0);
        show.answer({ value: "x" });
        await live;
    });

    it("токен, отменённый ПОСЛЕ закрытия показа, хосту уже не пишет", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ value: "x" });
        const source = new CancellationTokenSource();
        await api.showInputBox({}, source.token as unknown as vscode.CancellationToken);
        source.cancel();
        expect(stub.notifies.filter((n) => n.method === "window.quickInput.cancel")).toHaveLength(0);
    });

    it("уже отменённый токен не поднимает показ вовсе", async () => {
        const { stub, api } = makeApi();
        const source = new CancellationTokenSource();
        source.cancel();
        await expect(
            api.showInputBox({}, source.token as unknown as vscode.CancellationToken),
        ).resolves.toBeUndefined();
        expect(stub.requests).toHaveLength(0);
    });
});

describe("window.showQuickPick (шим)", () => {
    it("строки: резолвится выбранной строкой", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [1] });
        await expect(api.showQuickPick(["apple", "banana", "cherry"])).resolves.toBe("banana");
    });

    it("предметы: возвращается ТОТ ЖЕ объект, что прислало расширение", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [2] });
        const items = [{ label: "a" }, { label: "b" }, { label: "c" }];
        await expect(api.showQuickPick(items)).resolves.toBe(items[2]);
    });

    it("отмена — undefined", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: null });
        await expect(api.showQuickPick(["a"])).resolves.toBeUndefined();
    });

    it("canPickMany резолвится массивом, пустой набор — пустым массивом", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [0, 2] });
        await expect(api.showQuickPick(["a", "b", "c"], { canPickMany: true })).resolves.toEqual(["a", "c"]);
        stub.responder = () => ({ indices: [] });
        await expect(api.showQuickPick(["a", "b", "c"], { canPickMany: true })).resolves.toEqual([]);
    });

    it("canPickMany отменённый — undefined, а не пустой массив", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: null });
        await expect(api.showQuickPick(["a"], { canPickMany: true })).resolves.toBeUndefined();
    });

    it("список-промис дожидается и уезжает хосту уже заполненным", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [0] });
        const items = Promise.resolve(["готово-1", "готово-2"]);
        await expect(api.showQuickPick(items)).resolves.toBe("готово-1");
        expect(lastRequest(stub, "window.showQuickPick").items).toEqual([{ label: "готово-1" }, { label: "готово-2" }]);
    });

    it("предотмеченные пункты уезжают индексами — и только при canPickMany", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [] });
        const items = [{ label: "a" }, { label: "b", picked: true }, { label: "c", picked: true }];
        await api.showQuickPick(items, { canPickMany: true });
        expect(lastRequest(stub, "window.showQuickPick").picked).toEqual([1, 2]);

        await api.showQuickPick(items);
        expect(lastRequest(stub, "window.showQuickPick").picked).toEqual([]);
    });

    it("индекс за пределами списка выбрасывается, а не превращается в undefined", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [0, 99] });
        await expect(api.showQuickPick(["a", "b"], { canPickMany: true })).resolves.toEqual(["a"]);
    });

    it("индекс, равный длине списка, — тоже за пределами", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [2] });
        await expect(api.showQuickPick(["a", "b"], { canPickMany: true })).resolves.toEqual([]);
    });

    it("у строкового списка предотмеченных пунктов не бывает", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [] });
        await api.showQuickPick(["a", "b"], { canPickMany: true });
        expect(lastRequest(stub, "window.showQuickPick").picked).toEqual([]);
    });

    it("без опций вовсе список поднимается на дефолтах", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: [0] });
        await expect(api.showQuickPick(["a"])).resolves.toBe("a");
        expect(lastRequest(stub, "window.showQuickPick")).toMatchObject({ canPickMany: false, picked: [] });
    });

    it("handle списка монотонно растёт", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: null });
        await api.showQuickPick(["a"]);
        const first = lastRequest(stub, "window.showQuickPick").handle as number;
        await api.showQuickPick(["a"]);
        const second = lastRequest(stub, "window.showQuickPick").handle as number;
        expect(second).toBeGreaterThan(first);
    });

    it("токен, отменённый ПОСЛЕ закрытия списка, хосту уже не пишет", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: null });
        const source = new CancellationTokenSource();
        await api.showQuickPick(["a"], {}, source.token as unknown as vscode.CancellationToken);
        source.cancel();
        expect(stub.notifies.filter((n) => n.method === "window.quickInput.cancel")).toHaveLength(0);
    });

    it("заголовок и плейсхолдер уезжают хосту", async () => {
        const { stub, api } = makeApi();
        stub.responder = () => ({ indices: null });
        await api.showQuickPick(["a"], { title: "Кто", placeHolder: "Выберите" });
        expect(lastRequest(stub, "window.showQuickPick")).toMatchObject({
            title: "Кто",
            placeHolder: "Выберите",
            canPickMany: false,
        });
    });

    it("токен, отменённый пока считался список, не поднимает показ", async () => {
        const { stub, api } = makeApi();
        const source = new CancellationTokenSource();
        const items = Promise.resolve(["a"]).then((value) => {
            source.cancel();
            return value;
        });
        await expect(
            api.showQuickPick(items, {}, source.token as unknown as vscode.CancellationToken),
        ).resolves.toBeUndefined();
        expect(stub.requests).toHaveLength(0);
    });

    it("токен отмены шлёт хосту снятие показа", async () => {
        const { stub, api } = makeApi();
        const show = pendingAnswer();
        stub.responder = () => show.promise;
        const source = new CancellationTokenSource();
        const pending = api.showQuickPick(["a"], {}, source.token as unknown as vscode.CancellationToken);
        await Promise.resolve();
        source.cancel();
        expect(stub.notifies.filter((n) => n.method === "window.quickInput.cancel")).toHaveLength(1);
        show.answer({ indices: null });
        await expect(pending).resolves.toBeUndefined();
    });
});

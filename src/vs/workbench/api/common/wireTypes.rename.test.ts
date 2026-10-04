import { describe, expect, it, vi } from "vitest";

import { type IRequestOptions, TimeoutError } from "./rpcEndpoint.ts";
import { parseWireRenamePrepare, requestPrepareRename, requestRename } from "./wireTypes.ts";

const PARAMS = {
    handle: 3,
    uri: "file:///a.ts",
    languageId: "typescript",
    version: 1,
    line: 0,
    character: 8,
};

/**
 * Субпроцесс, который не отвечает, за транспортом, который держит срок, как
 * `RpcEndpoint.request`: по истечении `options.timeoutMs` — `TimeoutError`.
 */
function hanging(method: string, _params: unknown, options: IRequestOptions): Promise<unknown> {
    return new Promise((_resolve, reject) => {
        setTimeout(() => {
            reject(new TimeoutError(method, options.timeoutMs ?? 0));
        }, options.timeoutMs);
    });
}

describe("wireTypes — parseWireRenamePrepare", () => {
    it("имя символа доезжает placeholder'ом", () => {
        expect(parseWireRenamePrepare({ placeholder: "value" })).toEqual({ kind: "name", name: "value" });
    });

    it("отказ бьёт имя: провайдер, сказавший «здесь нельзя», поля ввода не открывает", () => {
        expect(parseWireRenamePrepare({ rejectReason: "You cannot rename this element." })).toEqual({
            kind: "reject",
            reason: "You cannot rename this element.",
        });
        expect(parseWireRenamePrepare({ placeholder: "value", rejectReason: "nope" })).toEqual({
            kind: "reject",
            reason: "nope",
        });
    });

    it("пусто, мусор и пустые строки — null (ядро спросит следующего провайдера)", () => {
        expect(parseWireRenamePrepare(null)).toBeNull();
        expect(parseWireRenamePrepare("junk")).toBeNull();
        expect(parseWireRenamePrepare({})).toBeNull();
        expect(parseWireRenamePrepare({ placeholder: "" })).toBeNull();
        expect(parseWireRenamePrepare({ placeholder: 42 })).toBeNull();
        expect(parseWireRenamePrepare({ rejectReason: "" })).toBeNull();
        expect(parseWireRenamePrepare({ rejectReason: 42 })).toBeNull();
    });
});

describe("wireTypes — requestPrepareRename", () => {
    it("успешный ответ отдаёт текущее имя символа, параметры уезжают целиком", async () => {
        const location = await requestPrepareRename(
            (method, params) => {
                expect(method).toBe("languages.prepareRename");
                expect(params).toEqual(PARAMS);
                return Promise.resolve({ placeholder: "value" });
            },
            PARAMS,
            1000,
        );
        expect(location).toEqual({ kind: "name", name: "value" });
    });

    it("отказ провайдера доезжает причиной", async () => {
        const location = await requestPrepareRename(
            () => Promise.resolve({ rejectReason: "not an identifier" }),
            PARAMS,
            1000,
        );
        expect(location).toEqual({ kind: "reject", reason: "not an identifier" });
    });

    it("таймаут, отказ RPC и мусор — null: слово под кареткой доберёт ядро", async () => {
        const request = vi.fn(hanging);
        expect(await requestPrepareRename(request, PARAMS, 5)).toBeNull();
        expect(request).toHaveBeenCalledWith("languages.prepareRename", PARAMS, { timeoutMs: 5 });
        expect(await requestPrepareRename(() => Promise.reject(new Error("boom")), PARAMS, 1000)).toBeNull();
        expect(await requestPrepareRename(() => Promise.resolve("junk"), PARAMS, 1000)).toBeNull();
    });
});

describe("wireTypes — requestRename", () => {
    const renameParams = { ...PARAMS, newName: "renamed" };

    it("применилось — applied без сообщения, параметры уезжают с новым именем", async () => {
        const result = await requestRename(
            (method, params) => {
                expect(method).toBe("languages.provideRenameEdits");
                expect(params).toEqual(renameParams);
                return Promise.resolve({ applied: true });
            },
            renameParams,
            1000,
        );
        expect(result).toEqual({ applied: true });
    });

    it("отказ с сообщением провайдера доезжает дословно", async () => {
        const result = await requestRename(
            () => Promise.resolve({ applied: false, error: "Invalid name" }),
            renameParams,
            1000,
        );
        expect(result).toEqual({ applied: false, error: "Invalid name" });
    });

    it("отказ без сообщения остаётся без сообщения (переименовывать было нечего)", async () => {
        expect(await requestRename(() => Promise.resolve({ applied: false }), renameParams, 1000)).toEqual({
            applied: false,
        });
        expect(await requestRename(() => Promise.resolve({ applied: false, error: "" }), renameParams, 1000)).toEqual({
            applied: false,
        });
    });

    it("таймаут — отказ С сообщением: человек ввёл имя и обязан узнать, что ничего не произошло", async () => {
        const request = vi.fn(hanging);
        expect(await requestRename(request, renameParams, 5)).toEqual({
            applied: false,
            error: "Rename timed out",
        });
        expect(request).toHaveBeenCalledWith("languages.provideRenameEdits", renameParams, { timeoutMs: 5 });
    });

    it("мусорный ответ — родовой отказ", async () => {
        expect(await requestRename(() => Promise.resolve("junk"), renameParams, 1000)).toEqual({
            applied: false,
            error: "Rename failed",
        });
        expect(await requestRename(() => Promise.resolve(null), renameParams, 1000)).toEqual({
            applied: false,
            error: "Rename failed",
        });
    });

    it("отказ самого RPC читается как неответ субпроцесса (любой сбой запроса — тот же исход)", async () => {
        expect(await requestRename(() => Promise.reject(new Error("boom")), renameParams, 1000)).toEqual({
            applied: false,
            error: "Rename timed out",
        });
    });

    it("нестроковая причина отказа отбрасывается, а не едет в UI как есть", async () => {
        expect(await requestRename(() => Promise.resolve({ applied: false, error: 42 }), renameParams, 1000)).toEqual({
            applied: false,
        });
    });

    it("`applied` не строгое `true` — отказ, а не успех", async () => {
        expect(await requestRename(() => Promise.resolve({ applied: "yes" }), renameParams, 1000)).toEqual({
            applied: false,
        });
    });
});

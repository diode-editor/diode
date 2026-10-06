import { describe, expect, it, vi } from "vitest";

import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../api/common/extHostProtocol.ts";
import { type IRequestOptions, TimeoutError } from "../../../api/common/rpcEndpoint.ts";

import { DEFAULT_REQUEST_TIMEOUTS, loggingRequest } from "./requestPolicy.ts";

function spyLogger() {
    return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function rpcAnswering(answer: () => Promise<unknown>) {
    const calls: { method: string; params: unknown; options: IRequestOptions }[] = [];
    const rpc = {
        request: (method: string, params: unknown, options: IRequestOptions) => {
            calls.push({ method, params, options });
            return answer();
        },
    } as unknown as HostRpc;
    return { rpc, calls };
}

describe("loggingRequest", () => {
    it("ответ проходит как есть, параметры и опции — до транспорта; лог молчит", async () => {
        const logger = spyLogger();
        const { rpc, calls } = rpcAnswering(() => Promise.resolve("ok"));
        const request = loggingRequest(rpc, logger as unknown as ILogger);
        await expect(request("workspace.fs.readFile", { uri: "file:///a" }, { timeoutMs: 7 })).resolves.toBe("ok");
        expect(calls).toEqual([
            { method: "workspace.fs.readFile", params: { uri: "file:///a" }, options: { timeoutMs: 7 } },
        ]);
        expect(logger.debug).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("истёкший срок — debug с текстом таймаута, отказ пробрасывается", async () => {
        const logger = spyLogger();
        const timeout = new TimeoutError("workspace.fs.readFile", 5);
        const { rpc } = rpcAnswering(() => Promise.reject(timeout));
        const request = loggingRequest(rpc, logger as unknown as ILogger);
        await expect(request("workspace.fs.readFile", { uri: "file:///a" }, {})).rejects.toBe(timeout);
        expect(logger.debug).toHaveBeenCalledWith('request "workspace.fs.readFile" timed out after 5ms');
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("отказ — warn с методом и самой ошибкой (стек расширения), отказ пробрасывается", async () => {
        const logger = spyLogger();
        const failure = new Error("provider crashed");
        const { rpc } = rpcAnswering(() => Promise.reject(failure));
        const request = loggingRequest(rpc, logger as unknown as ILogger);
        await expect(request("workspace.fs.readFile", { uri: "file:///a" }, {})).rejects.toBe(failure);
        expect(logger.warn).toHaveBeenCalledWith('request "workspace.fs.readFile" failed', failure);
        expect(logger.debug).not.toHaveBeenCalled();
    });

    it("без логгера отказы просто пробрасываются", async () => {
        const { rpc } = rpcAnswering(() => Promise.reject(new TimeoutError("workspace.fs.readFile", 1)));
        await expect(
            loggingRequest(rpc, undefined)("workspace.fs.readFile", { uri: "file:///a" }, {}),
        ).rejects.toBeInstanceOf(TimeoutError);
        const { rpc: failing } = rpcAnswering(() => Promise.reject(new Error("x")));
        await expect(
            loggingRequest(failing, undefined)("workspace.fs.readFile", { uri: "file:///a" }, {}),
        ).rejects.toThrow("x");
    });
});

describe("DEFAULT_REQUEST_TIMEOUTS", () => {
    // `languages.provideCompletionItems` здесь нет намеренно: автодополнение ждёт без срока.
    it("сроки по методам провода — прежние дефолты опций хоста", () => {
        expect(DEFAULT_REQUEST_TIMEOUTS).toEqual({
            "workspace.willSaveTextDocument": 1500,
            "languages.resolveCompletionItem": 1500,
            "languages.provideInlineCompletions": 5000,
            "languages.provideFoldingRanges": 1500,
            "languages.provideDefinition": 5000,
            "languages.provideHover": 5000,
            "languages.provideReferences": 5000,
            "languages.provideSignatureHelp": 5000,
            "languages.provideFormattingEdits": 5000,
            "languages.provideCodeActions": 5000,
            "languages.applyCodeAction": 10000,
            "languages.prepareRename": 5000,
            "languages.provideRenameEdits": 10000,
        });
    });
});

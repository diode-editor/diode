import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks, settle } from "../../../../../TestUtils/timing.ts";
import type { ISignatureHelpRequest } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";

/**
 * Запрос подсказки параметров по handle: субпроцесса нет, канал сшит
 * in-process — так проверяются ветки, недостижимые через настоящий fork
 * (отсечка по размеру документа, дефолтный таймаут, доставка триггер-символов
 * метаданными регистрации). Образец —
 * `extensionHost.referencesInProcess.test.ts`.
 */

const NOOP_EDITOR_OPTIONS = {
    getActiveEditorOptions: () => null,
    setActiveEditorOptions: () => undefined,
    getActiveEditorFilePath: () => null,
    getActiveEditorMeta: () => ({ uri: null, languageId: null, isDirty: false }),
    onActiveEditorChanged: () => ({ dispose: () => undefined }),
    onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
} as unknown as IEditorOptionsService;

const NOOP_COMMANDS = {
    execute: () => undefined,
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

const MAX_TEXT_BYTES = 8 * 1024 * 1024;

const HELP = {
    signatures: [{ label: "greet(name: string): void", parameters: [{ label: "name: string" }] }],
    activeSignature: 0,
    activeParameter: 0,
};

function requestOf(text: string, patch: Partial<ISignatureHelpRequest> = {}): ISignatureHelpRequest {
    return {
        uri: "file:///a.ts",
        languageId: "typescript",
        text,
        line: 0,
        character: 6,
        triggerKind: SignatureHelpTriggerKind.Invoke,
        isRetrigger: false,
        ...patch,
    };
}

function makeHost(options: { warn?: ILogger["warn"]; signatureHelpTimeoutMs?: number } = {}): {
    host: ExtensionHost;
    peer: RpcEndpoint;
} {
    const logger =
        options.warn === undefined
            ? undefined
            : ({ warn: options.warn, info: () => undefined, error: () => undefined } as unknown as ILogger);
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {
        ...(logger === undefined ? {} : { logger }),
        ...(options.signatureHelpTimeoutMs === undefined
            ? {}
            : { signatureHelpTimeoutMs: options.signatureHelpTimeoutMs }),
    });
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    (host as unknown as { rpc: RpcEndpoint }).rpc = hostRpc;
    return { host, peer };
}

describe("ExtensionHost — подсказка параметров по handle (in-process)", () => {
    it("LSP-контекст уходит в субпроцесс как есть, пустые поля не выдумываются", async () => {
        const { host, peer } = makeHost();
        const seen: unknown[] = [];
        peer.handleRequest("languages.provideSignatureHelp", (params) => {
            seen.push(params);
            return Promise.resolve(null);
        });

        await host.provideSignatureHelp(0, requestOf("x"));
        await host.provideSignatureHelp(
            0,
            requestOf("x", {
                triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
                triggerCharacter: ",",
                isRetrigger: true,
                activeSignatureHelp: HELP,
            }),
        );

        expect(seen[0]).toEqual({
            handle: 0,
            uri: "file:///a.ts",
            languageId: "typescript",
            text: "x",
            line: 0,
            character: 6,
            triggerKind: SignatureHelpTriggerKind.Invoke,
            isRetrigger: false,
        });
        // Ключей `triggerCharacter`/`activeSignatureHelp` в проводе быть не должно
        // вовсе: `{ x: undefined }` — лишний байт на каждом нажатии клавиши.
        expect(Object.keys(seen[0] as Record<string, unknown>).sort()).toEqual([
            "character",
            "handle",
            "isRetrigger",
            "languageId",
            "line",
            "text",
            "triggerKind",
            "uri",
        ]);
        expect(seen[1]).toEqual({
            handle: 0,
            uri: "file:///a.ts",
            languageId: "typescript",
            text: "x",
            line: 0,
            character: 6,
            triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
            triggerCharacter: ",",
            isRetrigger: true,
            activeSignatureHelp: HELP,
        });
        expect(Object.keys(seen[1] as Record<string, unknown>)).toContain("activeSignatureHelp");
    });

    it("триггер-символы едут метаданными регистрации — хост отдаёт их адаптеру как есть", async () => {
        const { host, peer } = makeHost();

        peer.notify("languages.register", {
            handle: 2,
            kind: "signatureHelp",
            selector: [{ language: "typescript" }],
            triggerCharacters: ["(", ",", 7, ""],
            retriggerCharacters: [")"],
        });
        await flushMicrotasks();

        // Нестроковый элемент и пустая строка отброшены: «пустой символ» совпал
        // бы с любым событием каретки без набора.
        expect(host.getLanguageProviders()).toEqual([
            {
                handle: 2,
                kind: "signatureHelp",
                selector: [{ language: "typescript" }],
                triggerCharacters: ["(", ","],
                retriggerCharacters: [")"],
            },
        ]);
    });

    it("документ ровно в лимит проходит, больше лимита — отсекается с записью в лог", async () => {
        const warn = vi.fn();
        const { host, peer } = makeHost({ warn });
        const provide = vi.fn(() => Promise.resolve(HELP));
        peer.handleRequest("languages.provideSignatureHelp", provide);

        expect(await host.provideSignatureHelp(0, requestOf("x".repeat(MAX_TEXT_BYTES)))).toEqual(HELP);
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();

        expect(await host.provideSignatureHelp(0, requestOf("x".repeat(MAX_TEXT_BYTES + 1)))).toBeNull();
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith("skipping signature help: document too large", {
            uri: "file:///a.ts",
            length: MAX_TEXT_BYTES + 1,
        });
    });

    it("после остановки субпроцесса запрос не уходит", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve(HELP));
        peer.handleRequest("languages.provideSignatureHelp", provide);
        expect(await host.provideSignatureHelp(0, requestOf("x"))).toEqual(HELP);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideSignatureHelp(0, requestOf("x"))).toBeNull();
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("дефолт таймаута — 5000 мс: тот же холодный language server, что у hover", () => {
        const { host } = makeHost();
        // Читаем разрешённую опцию, а не ждём вживую: реальное ожидание в
        // мутационном прогоне стоит полсекунды на каждом покрывающем мутанте.
        expect(
            (host as unknown as { options: { signatureHelpTimeoutMs: number } }).options.signatureHelpTimeoutMs,
        ).toBe(5000);
    });

    it("по истечении таймаута ответ отбрасывается", async () => {
        const { host, peer } = makeHost({ signatureHelpTimeoutMs: 5 });
        peer.handleRequest("languages.provideSignatureHelp", async () => {
            await settle(200);
            return HELP;
        });

        expect(await host.provideSignatureHelp(0, requestOf("x"))).toBeNull();
    });
});

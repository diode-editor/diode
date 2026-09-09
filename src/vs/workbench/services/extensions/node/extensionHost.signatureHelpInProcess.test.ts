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
 * Гейт запроса подсказки параметров: субпроцесса нет, канал сшит in-process —
 * так проверяются ветки, недостижимые через настоящий fork (подписка ещё не
 * пришла, чужая форма нотификации, отсечка по размеру документа, дефолтный
 * таймаут, доставка триггер-символов). Образец —
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

function makeHost(
    options: { warn?: ILogger["warn"]; signatureHelpTimeoutMs?: number } = {},
): { host: ExtensionHost; peer: RpcEndpoint } {
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

describe("ExtensionHost — гейт подсказки параметров (in-process)", () => {
    it("без подписки RPC не гоняется; после hasSignatureHelpProviders — гоняется", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve(HELP));
        peer.handleRequest("languages.provideSignatureHelp", provide);

        expect(await host.provideSignatureHelp(requestOf("greet(\n"))).toBeNull();
        expect(provide).not.toHaveBeenCalled();

        peer.notify("languages.updateSubscriptions", { hasSignatureHelpProviders: true });
        await flushMicrotasks();

        expect(await host.provideSignatureHelp(requestOf("greet(\n"))).toEqual(HELP);
        expect(provide).toHaveBeenCalledTimes(1);
    });

    it("LSP-контекст уходит в субпроцесс как есть, пустые поля не выдумываются", async () => {
        const { host, peer } = makeHost();
        const seen: unknown[] = [];
        peer.handleRequest("languages.provideSignatureHelp", (params) => {
            seen.push(params);
            return Promise.resolve(null);
        });
        peer.notify("languages.updateSubscriptions", { hasSignatureHelpProviders: true });
        await flushMicrotasks();

        await host.provideSignatureHelp(requestOf("x"));
        await host.provideSignatureHelp(
            requestOf("x", {
                triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
                triggerCharacter: ",",
                isRetrigger: true,
                activeSignatureHelp: HELP,
            }),
        );

        expect(seen[0]).toEqual({
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
            "isRetrigger",
            "languageId",
            "line",
            "text",
            "triggerKind",
            "uri",
        ]);
        expect(seen[1]).toEqual({
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

    it("чужая форма подписки читается как «провайдеров нет»", async () => {
        const { host, peer } = makeHost();
        peer.handleRequest("languages.provideSignatureHelp", () => Promise.resolve(HELP));

        peer.notify("languages.updateSubscriptions", { hasSignatureHelpProviders: true });
        await flushMicrotasks();
        expect(await host.provideSignatureHelp(requestOf("x"))).toEqual(HELP);

        peer.notify("languages.updateSubscriptions", { hasSignatureHelpProviders: "true" });
        await flushMicrotasks();
        expect(await host.provideSignatureHelp(requestOf("x"))).toBeNull();

        peer.notify("languages.updateSubscriptions", { hasSignatureHelpProviders: true });
        await flushMicrotasks();
        peer.notify("languages.updateSubscriptions", {});
        await flushMicrotasks();
        expect(await host.provideSignatureHelp(requestOf("x"))).toBeNull();
    });

    it("триггер- и ретриггер-символы доезжают до ядра и фаерят событие только на смену", async () => {
        const { host, peer } = makeHost();
        const changed = vi.fn();
        const subscription = host.onSignatureHelpTriggerCharactersChanged(changed);

        expect(host.signatureHelpTriggerCharacters).toEqual([]);
        expect(host.signatureHelpRetriggerCharacters).toEqual([]);

        peer.notify("languages.updateSubscriptions", {
            hasSignatureHelpProviders: true,
            signatureHelpTriggerCharacters: ["(", ",", 7],
            signatureHelpRetriggerCharacters: [")"],
        });
        await flushMicrotasks();

        // Нестроковый элемент отброшен, остальное доехало.
        expect(host.signatureHelpTriggerCharacters).toEqual(["(", ","]);
        expect(host.signatureHelpRetriggerCharacters).toEqual([")"]);
        expect(changed).toHaveBeenCalledTimes(1);

        // Тот же набор — события нет.
        peer.notify("languages.updateSubscriptions", {
            hasSignatureHelpProviders: true,
            signatureHelpTriggerCharacters: ["(", ","],
            signatureHelpRetriggerCharacters: [")"],
        });
        await flushMicrotasks();
        expect(changed).toHaveBeenCalledTimes(1);

        // Сменился только ретриггер — событие обязано прийти.
        peer.notify("languages.updateSubscriptions", {
            hasSignatureHelpProviders: true,
            signatureHelpTriggerCharacters: ["(", ","],
            signatureHelpRetriggerCharacters: [")", "]"],
        });
        await flushMicrotasks();
        expect(changed).toHaveBeenCalledTimes(2);

        // Границы элементов важны: ["ab"] и ["a", "b"] — разные наборы, хотя
        // склейка без разделителя уравняла бы их.
        peer.notify("languages.updateSubscriptions", {
            hasSignatureHelpProviders: true,
            signatureHelpTriggerCharacters: ["ab"],
            signatureHelpRetriggerCharacters: [],
        });
        await flushMicrotasks();
        expect(changed).toHaveBeenCalledTimes(3);
        peer.notify("languages.updateSubscriptions", {
            hasSignatureHelpProviders: true,
            signatureHelpTriggerCharacters: ["a", "b"],
            signatureHelpRetriggerCharacters: [],
        });
        await flushMicrotasks();
        expect(changed).toHaveBeenCalledTimes(4);

        // Второй слушатель — чтобы двойной dispose первого не снял ЕГО:
        // `splice` по индексу -1 срезал бы последнего в списке.
        const other = vi.fn();
        host.onSignatureHelpTriggerCharactersChanged(other);
        subscription.dispose();
        subscription.dispose();

        peer.notify("languages.updateSubscriptions", { hasSignatureHelpProviders: true });
        await flushMicrotasks();
        expect(host.signatureHelpTriggerCharacters).toEqual([]);
        expect(changed).toHaveBeenCalledTimes(4);
        expect(other).toHaveBeenCalledTimes(1);
    });

    it("документ ровно в лимит проходит, больше лимита — отсекается с записью в лог", async () => {
        const warn = vi.fn();
        const { host, peer } = makeHost({ warn });
        const provide = vi.fn(() => Promise.resolve(HELP));
        peer.handleRequest("languages.provideSignatureHelp", provide);
        peer.notify("languages.updateSubscriptions", { hasSignatureHelpProviders: true });
        await flushMicrotasks();

        expect(await host.provideSignatureHelp(requestOf("x".repeat(MAX_TEXT_BYTES)))).toEqual(HELP);
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();

        expect(await host.provideSignatureHelp(requestOf("x".repeat(MAX_TEXT_BYTES + 1)))).toBeNull();
        expect(provide).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith("skipping signature help: document too large", {
            uri: "file:///a.ts",
            length: MAX_TEXT_BYTES + 1,
        });
    });

    it("после остановки субпроцесса подписка сброшена — запрос не уходит до новой", async () => {
        const { host, peer } = makeHost();
        const provide = vi.fn(() => Promise.resolve(HELP));
        peer.handleRequest("languages.provideSignatureHelp", provide);
        peer.notify("languages.updateSubscriptions", { hasSignatureHelpProviders: true });
        await flushMicrotasks();
        expect(await host.provideSignatureHelp(requestOf("x"))).toEqual(HELP);

        await (host as unknown as { shutdownSubprocess(): Promise<void> }).shutdownSubprocess();

        expect(await host.provideSignatureHelp(requestOf("x"))).toBeNull();
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
        peer.notify("languages.updateSubscriptions", { hasSignatureHelpProviders: true });
        await flushMicrotasks();

        expect(await host.provideSignatureHelp(requestOf("x"))).toBeNull();
    });
});

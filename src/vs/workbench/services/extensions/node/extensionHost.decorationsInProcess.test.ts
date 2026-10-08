import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorDecorationsService } from "../../../api/common/iEditorDecorationsService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import type { IFileDecorationsService } from "../../../api/common/iFileDecorationsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import type { IThemeColorResolver } from "../../../api/common/iThemeColorResolver.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import { ColorThemeKind } from "../../../api/common/vscodeTypes.ts";

import { ExtensionHost } from "./extensionHost.ts";

// Детерминированный in-process тест decoration-хендлеров host'а: вместо форка
// subprocess'а гоняем `installHostHandlers` на in-process RPC-паре и шлём
// нотификации сами. Так покрытие хендлеров стабильно (один воркер, без гонок
// subprocess-RPC), и легко пробить guard-ветки/пути очистки.

const editorWriteCalls: { method: string; uri: string; payload: unknown }[] = [];
const NOOP_EDITOR_OPTIONS = {
    getActiveEditorOptions: () => null,
    setActiveEditorOptions: () => undefined,
    getActiveEditorFilePath: () => null,
    getActiveEditorMeta: () => ({ uri: null, languageId: null, isDirty: false }),
    onActiveEditorChanged: () => ({ dispose: () => undefined }),
    onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
    setActiveEditorSelections: (uri: string, selections: unknown) =>
        editorWriteCalls.push({ method: "setSelection", uri, payload: selections }),
    applyActiveEditorEdits: (uri: string, edits: unknown) => {
        editorWriteCalls.push({ method: "applyEdit", uri, payload: edits });
        return true;
    },
} as unknown as IEditorOptionsService;

const NOOP_COMMANDS = {
    execute: () => undefined,
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

function makeLogger(): { logger: ILogger; lines: string[] } {
    const lines: string[] = [];
    const log = (level: string) => (msg: string) => lines.push(`${level}:${msg}`);
    const logger = {
        trace: log("trace"),
        debug: log("debug"),
        info: log("info"),
        warn: log("warn"),
        error: log("error"),
        isEnabled: () => true,
    } as unknown as ILogger;
    return { logger, lines };
}

function makeHost(colors: Record<string, number>) {
    const editorCalls: { uri: string; decorations: readonly IGutterChangeDecoration[] }[] = [];
    const fileCalls: { path: string; color?: number; badge?: string }[][] = [];
    const editorDecorations: IEditorDecorationsService = {
        setGutterChangeDecorations: (uri, decorations) => editorCalls.push({ uri, decorations }),
    };
    const fileDecorations: IFileDecorationsService = {
        setFileDecorations: (entries) => fileCalls.push([...entries]),
    };
    const themeListeners: (() => void)[] = [];
    const themeColorResolver: IThemeColorResolver = {
        resolve: (id) => colors[id],
        kind: () => ColorThemeKind.Dark,
        onDidChange: (cb) => {
            themeListeners.push(cb);
            return { dispose: () => undefined };
        },
    };
    const configListeners: ((keys: string[]) => void)[] = [];
    const configuration = {
        getSnapshot: () => ({ defaults: {}, user: { some: "config" }, workspace: {} }),
        getWorkspaceFolders: () => [],
        onDidChange: (cb: (keys: string[]) => void) => {
            configListeners.push(cb);
            return { dispose: () => undefined };
        },
    };
    const { logger, lines } = makeLogger();

    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {
        logger,
        editorDecorations,
        fileDecorations,
        themeColorResolver,
        configuration,
    });

    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);

    const configChanges: unknown[] = [];
    peer.handleNotification("workspace.configurationChanged", (p) => configChanges.push(p));

    return {
        peer,
        editorCalls,
        fileCalls,
        logLines: lines,
        configChanges,
        fireTheme: () => {
            themeListeners.forEach((cb) => {
                cb();
            });
        },
        fireConfig: (keys: string[]) => {
            configListeners.forEach((cb) => {
                cb(keys);
            });
        },
        latestEditor: (file: string) => editorCalls.filter((c) => c.uri === Uri.file(file).toString()).at(-1),
    };
}

const range = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } });

describe("ExtensionHost — обработчики хоста (in-process, deterministic)", () => {
    it("window.showMessage маршрутизирует severity в логгер; конфиг-изменение шлёт в subprocess", async () => {
        const h = makeHost({});
        // Показ — запрос (ответа ждут), но в логгер сообщение попадает всегда:
        // тост гаснет, а прочитать, что расширение сказало, надо и потом.
        await h.peer.request("window.showMessage", { severity: "error", message: "boom" });
        await h.peer.request("window.showMessage", { severity: "warn", message: "careful" });
        await h.peer.request("window.showMessage", { severity: "info", message: "fyi" });
        await flushMicrotasks(10);
        expect(h.logLines).toEqual(["error:[extension] boom", "warn:[extension] careful", "info:[extension] fyi"]);

        h.fireConfig(["git.enabled"]);
        await flushMicrotasks(10);
        expect(h.configChanges.at(-1)).toEqual({
            configuration: { defaults: {}, user: { some: "config" }, workspace: {} },
            affectedKeys: ["git.enabled"],
        });
    });

    it("editor.setSelection / editor.applyEdit: guard на uri + проброс в порт", async () => {
        editorWriteCalls.length = 0;
        const h = makeHost({ "editorGutter.modifiedBackground": 0xff, "editor.background": 0 });

        // Нет uri (не строка) — ранний выход, порт не дёргается.
        h.peer.notify("editor.setSelection", { selections: [] });
        const guarded = await h.peer.request("editor.applyEdit", { edits: [] });
        expect(guarded).toBe(false);
        expect(editorWriteCalls).toHaveLength(0);

        // С uri — проброс в порт.
        const uri = Uri.file("/a.ts").toString();
        h.peer.notify("editor.setSelection", {
            uri,
            selections: [{ anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 1 }],
        });
        const applied = await h.peer.request("editor.applyEdit", {
            uri,
            edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, text: "x" }],
        });
        await flushMicrotasks(5);
        expect(applied).toBe(true);
        expect(editorWriteCalls.map((c) => c.method)).toEqual(["setSelection", "applyEdit"]);
    });
});

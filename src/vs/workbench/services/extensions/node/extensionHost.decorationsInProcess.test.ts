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
        getSnapshot: () => ({ some: "config" }),
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

describe("ExtensionHost decoration handlers (in-process, deterministic)", () => {
    it("gutter: create/set/dispose, non-gutter игнор, пустой набор чистит, смена темы пере-push'ит", async () => {
        const MOD = 0x0000ff;
        const h = makeHost({ "editorGutter.modifiedBackground": MOD, "editor.background": 0x1e1e1e });

        // Битые параметры — ранний выход без throw (guard-ветки).
        h.peer.notify("window.createTextEditorDecorationType", { key: "nope" });
        h.peer.notify("editor.setDecorations", { key: 5, uri: 42 });
        h.peer.notify("window.disposeTextEditorDecorationType", { key: "nope" });
        await flushMicrotasks(10);

        // gutter-тип (overviewRulerColor) + не-gutter тип (без него — игнорируется).
        // Типы регистрируем и ждём доставки ДО setDecorations (иначе тип ещё не в реестре).
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: { overviewRulerColor: { $themeColor: "editorGutter.modifiedBackground" }, isWholeLine: true },
        });
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 2,
            options: { backgroundColor: { $themeColor: "editor.background" } },
        });
        // options не-объект → трактуется как {} (не gutter).
        h.peer.notify("window.createTextEditorDecorationType", { key: 9, options: "not-an-object" });
        await flushMicrotasks(10);

        h.peer.notify("editor.setDecorations", { key: 1, uri: Uri.file("/a.ts").toString(), ranges: [range(1)] });
        h.peer.notify("editor.setDecorations", { key: 2, uri: Uri.file("/a.ts").toString(), ranges: [range(0)] });
        await flushMicrotasks(10);

        // dispose типа, которого нет ни в одном файле (key 9) — файл /a.ts есть, но без key 9.
        h.peer.notify("window.disposeTextEditorDecorationType", { key: 9 });
        await flushMicrotasks(10);

        const decos = h.latestEditor("/a.ts")!.decorations;
        expect(decos).toHaveLength(1);
        expect(decos[0].color).toBe(MOD);
        expect(decos[0].range.start.line).toBe(1);

        // Смена темы → пере-push держимых декораций.
        const before = h.editorCalls.length;
        h.fireTheme();
        await flushMicrotasks(10);
        expect(h.editorCalls.length).toBeGreaterThan(before);

        // Пустой набор → снятие баров.
        h.peer.notify("editor.setDecorations", { key: 1, uri: Uri.file("/a.ts").toString(), ranges: [] });
        await flushMicrotasks(10);
        expect(h.latestEditor("/a.ts")!.decorations).toEqual([]);

        // dispose типа → гасит его декорации.
        h.peer.notify("editor.setDecorations", { key: 1, uri: Uri.file("/a.ts").toString(), ranges: [range(2)] });
        await flushMicrotasks(10);
        h.peer.notify("window.disposeTextEditorDecorationType", { key: 1 });
        await flushMicrotasks(10);
        expect(h.latestEditor("/a.ts")!.decorations).toEqual([]);
    });

    it("modified-гуттер помечается dashed; added/deleted — сплошные (обе ветки)", async () => {
        const MOD = 0x1b81a8;
        const ADD = 0x487e02;
        const h = makeHost({
            "editorGutter.modifiedBackground": MOD,
            "editorGutter.addedBackground": ADD,
        });
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 1,
            options: { overviewRulerColor: { $themeColor: "editorGutter.modifiedBackground" }, isWholeLine: true },
        });
        h.peer.notify("window.createTextEditorDecorationType", {
            key: 2,
            options: { overviewRulerColor: { $themeColor: "editorGutter.addedBackground" }, isWholeLine: true },
        });
        await flushMicrotasks(10);
        h.peer.notify("editor.setDecorations", { key: 1, uri: Uri.file("/f.ts").toString(), ranges: [range(2)] });
        h.peer.notify("editor.setDecorations", { key: 2, uri: Uri.file("/f.ts").toString(), ranges: [range(5)] });
        await flushMicrotasks(10);

        const decos = h.latestEditor("/f.ts")!.decorations;
        const modified = decos.find((d) => d.color === MOD)!;
        const added = decos.find((d) => d.color === ADD)!;
        expect(modified.dashed).toBe(true);
        expect(added.dashed).toBeUndefined();
    });

    it("файловые декорации: badge/colorId по отдельности, не-объект, non-file отбрасывается, битый uri, снятие", async () => {
        const FILE = 0x112233;
        const h = makeHost({ "gitDecoration.modifiedResourceForeground": FILE });

        h.peer.notify("window.fileDecorationsChanged", {
            decorations: [
                null, // не-объект → пропуск (parseWireFileDecorations)
                { uri: "file:///both.md", badge: "M", colorId: "gitDecoration.modifiedResourceForeground" },
                { uri: "file:///badge.md", badge: "A" }, // только badge (colorId undefined)
                { uri: "file:///color.md", colorId: "gitDecoration.modifiedResourceForeground" }, // только colorId (badge undefined)
                { uri: "untitled:scratch", badge: "U" }, // не file: → отбрасывается, дерево адресуется путями
                { uri: "file:///%E0%A4%A", badge: "D" }, // битый percent-encoding → путь остаётся как есть
            ],
        });
        await flushMicrotasks(10);
        const entries = h.fileCalls.at(-1)!;
        expect(entries).toContainEqual({ path: "/both.md", color: FILE, badge: "M" });
        expect(entries).toContainEqual({ path: "/badge.md", badge: "A" }); // без color
        expect(entries).toContainEqual({ path: "/color.md", color: FILE }); // без badge
        // Не-file ресурс отбрасывается целиком: раньше схема уезжала в ключ
        // ("untitled:scratch" как «путь») и молча не совпадала ни с чем в дереве.
        expect(entries.some((e) => e.path.includes("scratch"))).toBe(false);
        expect(entries).toContainEqual({ path: "/%E0%A4%A", badge: "D" }); // битый uri → путь как есть

        // Голый uri (без badge/colorId) → снятие.
        h.peer.notify("window.fileDecorationsChanged", { decorations: [{ uri: "file:///both.md" }] });
        await flushMicrotasks(10);
        expect(h.fileCalls.at(-1)!.some((e) => e.path === "/both.md")).toBe(false);
    });

    it("window.showMessage маршрутизирует severity в логгер; конфиг-изменение шлёт в subprocess", async () => {
        const h = makeHost({});
        h.peer.notify("window.showMessage", { severity: "error", message: "boom" });
        h.peer.notify("window.showMessage", { severity: "warn", message: "careful" });
        h.peer.notify("window.showMessage", { severity: "info", message: 7 });
        await flushMicrotasks(10);
        expect(h.logLines).toEqual(["error:[extension] boom", "warn:[extension] careful", "info:[extension] 7"]);

        h.fireConfig(["git.enabled"]);
        await flushMicrotasks(10);
        expect(h.configChanges.at(-1)).toEqual({ configuration: { some: "config" }, affectedKeys: ["git.enabled"] });
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
            edits: [{ range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 }, text: "x" }],
        });
        await flushMicrotasks(5);
        expect(applied).toBe(true);
        expect(editorWriteCalls.map((c) => c.method)).toEqual(["setSelection", "applyEdit"]);
    });
});

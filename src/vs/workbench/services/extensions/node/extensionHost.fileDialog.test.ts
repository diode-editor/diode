import { describe, expect, it } from "vitest";

import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import type { IFileDialogSink } from "../../../api/common/iExtensionWindowSinks.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { IWireOpenDialogRequest, IWireSaveDialogRequest } from "../../../api/common/wireTypes.ts";

import { ExtensionHost } from "./extensionHost.ts";
import { parseWireOpenDialogRequest, parseWireSaveDialogRequest } from "./hostWireParsers.ts";

// Диалоги файлов расширений (`window.showOpenDialog` / `showSaveDialog`) на
// стороне хоста: installHostHandlers на in-process RPC-паре.

const NOOP_EDITOR_OPTIONS = {
    getActiveEditorOptions: () => null,
    setActiveEditorOptions: () => undefined,
    getActiveEditorFilePath: () => null,
    getActiveEditorMeta: () => ({ uri: null, languageId: null, isDirty: false }),
    onActiveEditorChanged: () => ({ dispose: () => undefined }),
    onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
    setActiveEditorSelections: () => undefined,
    applyActiveEditorEdits: () => true,
} as unknown as IEditorOptionsService;

const NOOP_COMMANDS = {
    execute: () => undefined,
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

function makeHost(sink?: IFileDialogSink) {
    const host = new ExtensionHost(
        NOOP_EDITOR_OPTIONS,
        NOOP_COMMANDS,
        sink === undefined ? {} : { fileDialogSink: sink },
    );
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(new RpcEndpoint(a));
    return { peer };
}

describe("ExtensionHost — window.showOpenDialog / showSaveDialog", () => {
    it("просьба доезжает до стока, выбранное — обратно расширению", async () => {
        const opens: IWireOpenDialogRequest[] = [];
        const saves: IWireSaveDialogRequest[] = [];
        const { peer } = makeHost({
            showOpenDialog: (request) => {
                opens.push(request);
                return Promise.resolve(["file:///ws/a.go"]);
            },
            showSaveDialog: (request) => {
                saves.push(request);
                return Promise.resolve("file:///ws/new.txt");
            },
        });
        await expect(peer.request("window.showOpenDialog", { title: "Pick", canSelectFiles: true })).resolves.toEqual({
            uris: ["file:///ws/a.go"],
        });
        await expect(peer.request("window.showSaveDialog", { saveLabel: "Save" })).resolves.toEqual({
            uri: "file:///ws/new.txt",
        });
        expect(opens[0]).toMatchObject({ title: "Pick", canSelectFiles: true });
        expect(saves[0]).toMatchObject({ saveLabel: "Save" });
    });

    it("отмена — null", async () => {
        const { peer } = makeHost({
            showOpenDialog: () => Promise.resolve(undefined),
            showSaveDialog: () => Promise.resolve(undefined),
        });
        await expect(peer.request("window.showOpenDialog", {})).resolves.toEqual({ uris: null });
        await expect(peer.request("window.showSaveDialog", {})).resolves.toEqual({ uri: null });
    });

    it("без стока — «отменено» сразу, а не вечное ожидание", async () => {
        const { peer } = makeHost();
        await expect(peer.request("window.showOpenDialog", {})).resolves.toEqual({ uris: null });
        await expect(peer.request("window.showSaveDialog", {})).resolves.toEqual({ uri: null });
    });
});

describe("parseWireOpenDialogRequest / parseWireSaveDialogRequest", () => {
    it("все поля доезжают; фильтры — парами, мусорные пары и расширения отсеиваются", () => {
        expect(
            parseWireOpenDialogRequest({
                defaultUri: "file:///ws",
                openLabel: "Select",
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: true,
                filters: [{ name: "Go", extensions: ["go", 5] }, { name: 1 }, null, { name: "x", extensions: "go" }],
                title: "T",
            }),
        ).toEqual({
            defaultUri: "file:///ws",
            openLabel: "Select",
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            filters: [{ name: "Go", extensions: ["go"] }],
            title: "T",
        });
        expect(
            parseWireSaveDialogRequest({ defaultUri: "file:///a", saveLabel: "S", filters: [], title: "T" }),
        ).toEqual({ defaultUri: "file:///a", saveLabel: "S", filters: [], title: "T" });
    });

    it("чужие типы и пустой запрос — поля не заданы", () => {
        const empty = {
            defaultUri: undefined,
            openLabel: undefined,
            canSelectFiles: undefined,
            canSelectFolders: undefined,
            canSelectMany: undefined,
            filters: undefined,
            title: undefined,
        };
        expect(parseWireOpenDialogRequest(null)).toEqual(empty);
        expect(parseWireOpenDialogRequest({ title: 5, canSelectMany: "да", filters: "go" })).toEqual(empty);
        expect(parseWireSaveDialogRequest(undefined)).toEqual({
            defaultUri: undefined,
            saveLabel: undefined,
            filters: undefined,
            title: undefined,
        });
    });
});

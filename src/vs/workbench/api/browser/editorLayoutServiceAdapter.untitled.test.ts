import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../base/common/uri.ts";
import { isTextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import { EditorServiceDIToken, type IEditorService } from "../../services/editor/common/editorService.ts";
import type { IDocumentSyncSource, IDocumentSyncTarget } from "../common/iDocumentSyncTarget.ts";

import { bindDocumentSync, openDocumentSyncSources } from "./documentSyncAdapter.ts";
import { EditorLayoutServiceAdapter } from "./editorLayoutServiceAdapter.ts";

describe("EditorLayoutServiceAdapter — untitled document without a tab", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let service: IEditorService;
    let adapter: EditorLayoutServiceAdapter;
    let log: string[];
    let opened: IDocumentSyncSource[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-untitled-doc-", files: { "a.txt": "a" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(100, 20) });
        service = h.container.get(EditorServiceDIToken);
        adapter = new EditorLayoutServiceAdapter(service, service.editorGroups);
        log = [];
        opened = [];
        const host: IDocumentSyncTarget = {
            didOpenTextDocument: (snapshot) => {
                opened.push(snapshot);
                log.push(`open ${snapshot.uri}`);
            },
            didChangeTextDocument: (snapshot) => log.push(`flush ${snapshot.uri}`),
            didChangeTextDocumentContent: (event) => log.push(`change ${event.uri}`),
            didCloseTextDocument: (uri) => log.push(`close ${uri}`),
            didChangeTextDocumentState: () => undefined,
        };
        bindDocumentSync(service, service.editorGroups, host);
    });

    afterEach(() => {
        adapter.dispose();
        h.dispose();
        ws.dispose();
    });

    it("document is open to extensions immediately: dirty, with text and language, but without a tab", async () => {
        const { uri } = await adapter.createUntitledDocument({ content: "# Tools\n", language: "markdown" });

        expect(uri).toBe("untitled:Untitled-1");
        expect(log).toEqual([`open ${uri}`]);
        expect(opened[0]).toMatchObject({ uri, languageId: "markdown", isDirty: true });
        expect(opened[0].getText()).toBe("# Tools\n");
        expect(service.editorGroups.activeGroup.editorCount).toBe(0);
        // The handshake seed (subprocess restart) carries this document too.
        expect(openDocumentSyncSources(service).map((snapshot) => snapshot.uri)).toEqual([uri]);
    });

    it("without options — a clean empty buffer; the number comes from the counter shared with New Untitled File", async () => {
        service.newUntitled();
        const { uri } = await adapter.createUntitledDocument({});

        expect(uri).toBe("untitled:Untitled-2");
        expect(opened.at(-1)).toMatchObject({ uri, languageId: "plaintext", length: 0, isDirty: false });
        expect(opened.at(-1)?.getText()).toBe("");
    });

    it("empty content is also a clean buffer (like upstream `!!initialValue`)", async () => {
        const { uri } = await adapter.createUntitledDocument({ content: "" });

        expect(opened.at(-1)).toMatchObject({ uri, length: 0, isDirty: false });
    });

    it("showTextDocument shows the same model as an Untitled-N tab — without a repeated open/close", async () => {
        const { uri } = await adapter.createUntitledDocument({ content: "go: /usr/bin/go\n", language: "markdown" });
        log.length = 0;

        const shown = await adapter.showTextDocument({ uri });

        expect(shown.uri).toBe(uri);
        const group = service.editorGroups.activeGroup;
        expect(group.editorCount).toBe(1);
        const pane = group.activePane;
        expect(isTextEditorPane(pane) && pane.model.languageId).toBe("markdown");
        expect(pane?.isModified).toBe(true);
        expect(service.getUntitledModelsWithoutEditor()).toEqual([]);
        expect(log).toEqual([]);

        h.testApp.render();
        const screen = h.testApp.backend.screenToString();
        expect(screen).toContain("Untitled-1");
        expect(screen).toContain("go: /usr/bin/go");

        if (isTextEditorPane(pane)) pane.viewState.type("x");
        expect(log).toEqual([`change ${uri}`]);
    });

    it("showing again activates the already open tab instead of creating a second one", async () => {
        const { uri } = await adapter.createUntitledDocument({ content: "x" });
        await adapter.showTextDocument({ uri });
        service.openFile(ws.path("a.txt"));

        await adapter.showTextDocument({ uri });

        const group = service.editorGroups.activeGroup;
        expect(group.editorCount).toBe(2);
        expect(group.activePane?.uri.toString()).toBe(uri);
    });

    it("shows in the side column (ViewColumn.Beside)", async () => {
        service.openFile(ws.path("a.txt"));
        const { uri } = await adapter.createUntitledDocument({ content: "x" });

        const shown = await adapter.showTextDocument({ uri, viewColumn: -2 });

        expect(shown.viewColumn).toBe(2);
        expect(service.editorGroups.groups[1].activePane?.uri.toString()).toBe(uri);
    });

    it("openUri without options takes the buffer into a tab of the active group and focuses it", async () => {
        const uri = service.createUntitled({ content: "x" });

        await service.openUri(uri);

        const pane = service.editorGroups.activeGroup.activePane;
        expect(pane?.uri.toString()).toBe(uri.toString());
        const focused = h.testApp.focusedElement;
        expect(pane !== null && focused?.getAncestorPath().includes(pane.view)).toBe(true);
    });

    it("openUri with focus: false — the tab opens, focus stays put", async () => {
        const uri = service.createUntitled({ content: "x" });
        const focusedBefore = h.testApp.focusedElement;

        await service.openUri(uri, { focus: false });

        expect(service.editorGroups.activeGroup.activePane?.uri.toString()).toBe(uri.toString());
        expect(h.testApp.focusedElement).toBe(focusedBefore);
    });

    it('openUri with group: "beside" — into a tab of the side group', async () => {
        service.openFile(ws.path("a.txt"));
        const uri = service.createUntitled({ content: "x" });

        await service.openUri(uri, { group: "beside" });

        expect(service.editorGroups.groups).toHaveLength(2);
        expect(service.editorGroups.groups[1].activePane?.uri.toString()).toBe(uri.toString());
        expect(service.editorGroups.groups[0].editorCount).toBe(1);
    });

    it("encoding from options is the encoding of the future Save As", async () => {
        const { uri } = await adapter.createUntitledDocument({ content: "x", encoding: "utf16le" });
        await adapter.showTextDocument({ uri });

        const pane = service.editorGroups.activeGroup.activePane;
        expect(isTextEditorPane(pane) && pane.encoding).toBe("utf16le");
    });

    it("core closed with an unshown buffer — the model is released together with the service", async () => {
        await adapter.createUntitledDocument({ content: "x" });
        const [model] = service.getUntitledModelsWithoutEditor();
        const disposeModel = vi.spyOn(model, "dispose");

        service.dispose();

        expect(service.getUntitledModelsWithoutEditor()).toEqual([]);
        expect(disposeModel).toHaveBeenCalledOnce();
    });

    it("untitled resource without such a model still fails to open instead of an empty tab", async () => {
        const failures: string[] = [];
        service.onDidFailOpen(({ uri }) => failures.push(uri.toString()));

        await service.openUri(Uri.parse("untitled:Untitled-9"));

        expect(failures).toEqual(["untitled:Untitled-9"]);
        expect(service.editorGroups.activeGroup.editorCount).toBe(0);
    });

    it("openTextDocument answers with the uri of a file it opened, and null for what it can't", async () => {
        const uri = Uri.file(ws.path("a.txt")).toString();
        await expect(adapter.openTextDocument({ uri })).resolves.toEqual({ uri });
        await expect(adapter.openTextDocument({ uri: Uri.file(ws.path("nope.txt")).toString() })).resolves.toBeNull();
    });
});

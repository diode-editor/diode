import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { DiffEditorPane2 } from "../../browser/parts/editor/diffEditorPane2.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";
import type { IDocumentSyncTarget } from "../common/iDocumentSyncTarget.ts";

import { bindDocumentSync } from "./documentSyncAdapter.ts";

/**
 * Стороны дифф-вкладки — тоже документы для расширений: по ним зовут
 * провайдеров (активной может быть сторона), а сторона бывает правимой моделью
 * без своей вкладки (untitled-пара, «Open Changes» неоткрытого файла).
 */
describe("documentSyncAdapter — стороны дифф-вкладок", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-docsync-diff-", files: { "a.txt": "a" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(120, 30) });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("стороны открываются, правятся дельтой и закрываются вместе с дифф-вкладкой", async () => {
        const service = h.container.get(EditorServiceDIToken);
        const group = service.editorGroups.activeGroup;
        const log: string[] = [];
        const host: IDocumentSyncTarget = {
            didOpenTextDocument: (snapshot) => log.push(`open ${snapshot.uri}`),
            didChangeTextDocument: (snapshot) => log.push(`flush ${snapshot.uri}`),
            didChangeTextDocumentContent: (event) => log.push(`change ${event.uri}`),
            didCloseTextDocument: (uri) => log.push(`close ${uri}`),
        };
        bindDocumentSync(service, service.editorGroups, host);

        h.commands.execute("workbench.files.action.compareNewUntitledTextFiles");
        await vi.waitFor(() => {
            expect(group.activePane instanceof DiffEditorPane2).toBe(true);
        });
        const diff = group.activePane as DiffEditorPane2;
        const sides = [...diff.sidePanes()];
        const uris = sides.map((side) => side.uri.toString());
        expect(service.getTextSurfaces()).toEqual(sides);
        expect(service.getEditors()).toEqual([]);
        expect(log).toEqual(uris.map((uri) => `open ${uri}`));

        sides[1].viewState.type("x");
        expect(log.at(-1)).toBe(`change ${uris[1]}`);

        group.closeTab(group.findPaneIndex(diff.uri));
        expect(log.slice(-2).sort()).toEqual(uris.map((uri) => `close ${uri}`).sort());
    });
});

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createTestContainer } from "../../../../diode/modules/testProfile.ts";
import {
    FileSystemProviderCapabilities,
    IFileServiceDIToken,
    type IFileSystemProvider,
} from "../../../../platform/files/common/files.ts";
import { InMemoryFileSystemProvider } from "../../../../platform/files/common/inMemoryFileSystemProvider.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { WorkbenchComponent } from "../../../browser/workbenchComponent.ts";
import { WorkbenchComponentDIToken } from "../../../browser/workbenchComponent.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { TextFileModelServiceDIToken } from "../../../services/textfile/common/textFileModelService.ts";

import { openDiffPair } from "./openDiffPair.ts";

/** The same in-memory provider, but declared read-only (like `git:` with `isReadonly`). */
function readonlyView(provider: InMemoryFileSystemProvider): IFileSystemProvider {
    return {
        capabilities: FileSystemProviderCapabilities.Readonly,
        onDidChangeFile: provider.onDidChangeFile,
        readFile: (uri) => provider.readFile(uri),
        stat: (uri) => provider.stat(uri),
    };
}

const encode = (text: string) => new TextEncoder().encode(text);
const right = Uri.from({ scheme: "_claude_fs_right", path: "/a.txt" });
const revision = Uri.from({ scheme: "gitrev", path: "/a.txt" });

describe("openDiffPair — file system provider side", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let editors: IEditorService;
    let app: TestApp;
    let container: ReturnType<typeof createTestContainer>["container"];
    let writable: InMemoryFileSystemProvider;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-diff-provided-", files: { "a.txt": "alpha\nbravo\n" } });
        const testContainer = createTestContainer();
        container = testContainer.container;
        writable = new InMemoryFileSystemProvider();
        const readonly = new InMemoryFileSystemProvider();
        await writable.writeFile(right, encode("alpha\nBRAVO\n"));
        await readonly.writeFile(revision, encode("alpha\nbravo-old\n"));
        const files = container.get(IFileServiceDIToken);
        files.registerProvider(right.scheme, writable);
        files.registerProvider(revision.scheme, readonlyView(readonly));
        workbench = container.get(WorkbenchComponentDIToken);
        editors = container.get(EditorServiceDIToken);
        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        app = TestApp.create(workbench.view, new Size(150, 16));
        testContainer.bindApp(app.app);
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    const fileSide = () => {
        const uri = Uri.file(ws.path("a.txt"));
        return { uri, label: "a.txt", identity: uri.toString() };
    };
    const side = (uri: Uri, onMissing?: "empty" | "error") => ({
        uri,
        label: "a.txt",
        identity: uri.toString(),
        ...(onMissing !== undefined ? { onMissing } : {}),
    });

    function activeDiff(): DiffEditorPane2 {
        const pane = editors.editorGroups.activeGroup.activePane;
        if (!(pane instanceof DiffEditorPane2)) throw new Error("active tab is not a diff");
        return pane;
    }

    it("writable provider: the side is a shared model under its own uri, editable and saved to the provider", async () => {
        const result = await openDiffPair(container, { original: fileSide(), modified: side(right) });
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        expect(app.backend.screenToString()).toMatch(/2\+\s+BRAVO/u);
        const pane = activeDiff();
        expect(pane.snapshotSides()).toEqual([]);
        const [, modified] = pane.sidePanes();
        expect(modified.readOnly).toBe(false);
        expect(modified.uri.toString()).toBe(right.toString());
        expect(modified.model).toBe(container.get(TextFileModelServiceDIToken).get(right));

        modified.goToPosition(1, 0);
        modified.viewState.type("X");
        expect(pane.isModified).toBe(true);
        await expect(editors.save(right)).resolves.toEqual(right);

        expect(new TextDecoder().decode(await writable.readFile(right))).toBe("alpha\nXBRAVO\n");
        expect(pane.isModified).toBe(false);
    });

    it("closing the tab releases the provider model", async () => {
        await openDiffPair(container, { original: fileSide(), modified: side(right) });
        const models = container.get(TextFileModelServiceDIToken);
        expect(models.get(right)).not.toBeNull();

        const group = editors.editorGroups.activeGroup;
        group.closeTab(group.findPaneIndex(activeDiff().uri));

        expect(models.get(right)).toBeNull();
    });

    it("read-only provider: the side is a snapshot, as before", async () => {
        const result = await openDiffPair(container, { original: side(revision), modified: fileSide() });
        await settle(10);
        app.render();

        expect(result).toBe("opened");
        expect(activeDiff().snapshotSides()).toEqual(["original"]);
        expect(activeDiff().sidePanes()[0].readOnly).toBe(true);
        expect(app.backend.screenToString()).toMatch(/2-\s+bravo-old/u);
    });

    it("unreadable resource of a writable provider follows the onMissing policy", async () => {
        const missing = Uri.from({ scheme: right.scheme, path: "/missing.txt" });

        await expect(openDiffPair(container, { original: fileSide(), modified: side(missing) })).resolves.toBe(
            "unreadable",
        );
        await expect(openDiffPair(container, { original: fileSide(), modified: side(missing, "empty") })).resolves.toBe(
            "opened",
        );
        expect(activeDiff().snapshotSides()).toEqual(["modified"]);
        expect(container.get(TextFileModelServiceDIToken).get(missing)).toBeNull();
    });

    it("preferDisk on a provider side gives a snapshot, not a model", async () => {
        await openDiffPair(container, { original: fileSide(), modified: { ...side(right), preferDisk: true } });

        expect(activeDiff().snapshotSides()).toEqual(["modified"]);
        expect(container.get(TextFileModelServiceDIToken).get(right)).toBeNull();
    });
});

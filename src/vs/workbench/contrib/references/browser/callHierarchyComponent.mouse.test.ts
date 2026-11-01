import { Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type {
    CallHierarchyProvider,
    ICallHierarchyItem,
} from "../../../../editor/common/languages/iCallHierarchySource.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { NULL_JUMP_RECORDER } from "../../../services/history/browser/historyService.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";

import { CallHierarchyComponent } from "./callHierarchyComponent.ts";
import { REFERENCES_VIEWLET_ID, ReferencesComponent } from "./referencesComponent.ts";

function item(itemId: number, name: string): ICallHierarchyItem {
    const range = createRange(itemId, 0, itemId, name.length);
    return { itemId, name, kind: 11, uri: "file:///a.ts", range, selectionRange: range };
}

const ROOT = item(1, "root");
const CALLER = item(2, "caller");

async function setup(openMode = "singleClick") {
    const provider: CallHierarchyProvider = {
        prepareCallHierarchy: () => Promise.resolve({ sessionId: 40, items: [ROOT] }),
        provideIncomingCalls: (_session: number, itemId: number) =>
            Promise.resolve(itemId === ROOT.itemId ? [{ from: CALLER, fromRanges: [createRange(7, 3, 7, 5)] }] : []),
        provideOutgoingCalls: () => Promise.resolve([]),
        releaseCallHierarchy: () => undefined,
    };
    const views = makeViewsHarness();
    const opened: string[] = [];
    const positions: [number, number | undefined][] = [];
    const editor = {
        uri: { toString: () => "file:///a.ts" },
        languageId: "typescript",
        model: { document: { versionId: 3 } },
        viewState: { selections: [{ active: { line: 5, character: 2 } }] },
        goToPosition: (line: number, column?: number) => positions.push([line, column]),
        revealRange: () => undefined,
    };
    const reveal = {
        openUri: (uri: { toString(): string }) => {
            opened.push(uri.toString());
        },
        getActiveEditor: () => editor,
    };
    const references = new ReferencesComponent(reveal, views.contextKeys, views.service, NULL_JUMP_RECORDER);
    views.service.attachRegisteredContainers();
    views.showViewlet(REFERENCES_VIEWLET_ID);
    const languageFeatures = new LanguageFeaturesService();
    languageFeatures.callHierarchyProvider.register("*", provider);
    const component = new CallHierarchyComponent(
        views.service,
        references,
        { getActiveEditor: () => editor } as unknown as IEditorService,
        languageFeatures,
        reveal,
        NULL_JUMP_RECORDER,
        NULL_STATE_SERVICE,
        views.contextKeys,
        { show: () => undefined } as unknown as NotificationService,
        NERD_FONT_ICONS,
        {
            get: (key: string) => (key === "workbench.list.openMode" ? openMode : undefined),
        } as unknown as IConfigurationService,
    );
    await component.show();
    const app = TestApp.createWithContent(views.root(REFERENCES_VIEWLET_ID), new Size(50, 10));

    /** Where the frame shows `text`, in cells: a gesture goes where the user sees the row. */
    const frame = (): string => {
        app.render();
        return app.backend.screenToString();
    };
    const locate = async (text: string): Promise<{ x: number; y: number }> =>
        vi.waitFor(() => {
            const lines = frame().split("\n");
            // Below the title, which names the root too.
            const y = lines.findIndex((line, row) => row > 0 && line.includes(text));
            if (y < 0) throw new Error(`no "${text}" on the frame`);
            return { x: lines[y]?.indexOf(text) ?? 0, y };
        });
    const click = (x: number, y: number): void => {
        for (const action of ["press", "release"] as const) {
            app.backend.simulateMouse({
                kind: "mouse",
                button: "left",
                x: x + 1,
                y: y + 1,
                action,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
        }
        app.render();
    };
    const selected = (): string | undefined => component.tree.getSelectedNode()?.item.name;
    return { locate, click, selected, opened, positions, tree: component.tree };
}

// Upstream's row carries a command (`calls/model.ts`, `getTreeItem`), so a click opens it though the row is expandable.
describe("CallHierarchyComponent — the mouse", () => {
    it("a click on a row goes to the call, as upstream", async () => {
        const { locate, click, opened, positions } = await setup();
        const { x, y } = await locate("caller");

        click(x, y);

        await vi.waitFor(() => {
            expect(opened).toEqual(["file:///a.ts"]);
        });
        expect(positions).toEqual([[7, 3]]);
    });

    it("a double click on a row goes to the call", async () => {
        const { locate, click, opened, positions } = await setup();
        const { x, y } = await locate("caller");

        click(x, y);
        click(x, y);

        await vi.waitFor(() => {
            expect(opened).toContain("file:///a.ts");
        });
        expect(positions.at(-1)).toEqual([7, 3]);
    });

    it("a single click keeps the focus on the tree; a double click and Enter move it", async () => {
        const { tree } = await setup();
        const focus = vi.spyOn(tree, "focus");
        const node = tree.getSelectedNode();
        if (node === null) throw new Error("no selection");

        tree.onActivate?.(node, { pinned: true, preserveFocus: false });
        expect(focus).not.toHaveBeenCalled();
        tree.onActivate?.(node, { pinned: false, preserveFocus: true });
        expect(focus).toHaveBeenCalledOnce();
    });

    it("workbench.list.openMode: doubleClick: a click only selects", async () => {
        const { locate, click, opened } = await setup("doubleClick");
        const { x, y } = await locate("caller");

        click(x, y);
        await vi.waitFor(() => {
            expect(opened).toEqual([]);
        });
    });

    // The gesture reaches the tree: the two tests above fail on the missing jump, not on a missed click.
    it("a click on a row selects it", async () => {
        const { locate, click, selected } = await setup();
        await locate("caller");
        expect(selected()).toBe("caller");
        const { x, y } = await locate("root");

        click(x, y);

        await vi.waitFor(() => {
            expect(selected()).toBe("root");
        });
    });
});

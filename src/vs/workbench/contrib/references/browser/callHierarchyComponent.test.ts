import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type {
    CallHierarchyProvider,
    ICallHierarchyItem,
    ICallHierarchySession,
} from "../../../../editor/common/languages/iCallHierarchySource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";
import { ViewMessageElement } from "../../../browser/parts/views/viewMessageElement.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { CALL_HIERARCHY_MODE_STATE } from "../../../common/stateKeys.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { NULL_JUMP_RECORDER } from "../../../services/history/browser/historyService.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";

import { CALL_HIERARCHY_VIEW_ID, CallHierarchyComponent } from "./callHierarchyComponent.ts";
import { REFERENCES_VIEW_ID, REFERENCES_VIEWLET_ID, ReferencesComponent } from "./referencesComponent.ts";

function item(itemId: number, name: string, line = itemId): ICallHierarchyItem {
    const range = createRange(line, 0, line, name.length);
    return { itemId, name, kind: 11, uri: "file:///a.ts", range, selectionRange: range };
}

const ROOT = item(1, "root");
const CALLER = item(2, "caller");
const CALLEE = item(3, "callee");

function makeProvider(session: ICallHierarchySession | null = { sessionId: 40, items: [ROOT] }): CallHierarchyProvider {
    return {
        prepareCallHierarchy: vi.fn(() => Promise.resolve(session)),
        provideIncomingCalls: vi.fn((_session: number, itemId: number) =>
            Promise.resolve(itemId === ROOT.itemId ? [{ from: CALLER, fromRanges: [createRange(7, 3, 7, 5)] }] : []),
        ),
        provideOutgoingCalls: vi.fn((_session: number, itemId: number) =>
            Promise.resolve(itemId === ROOT.itemId || itemId === CALLER.itemId ? [{ to: CALLEE, fromRanges: [] }] : []),
        ),
        releaseCallHierarchy: vi.fn(),
    };
}

function setup(provider: CallHierarchyProvider = makeProvider(), stored = new Map<string, unknown>()) {
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
    const languageFeatures: ILanguageFeaturesService = new LanguageFeaturesService();
    languageFeatures.callHierarchyProvider.register("*", provider);
    const state: IStateService = {
        ...NULL_STATE_SERVICE,
        get: <T>(descriptor: { key: string; default: T }): T =>
            stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default,
        store: (descriptor: { key: string }, value: unknown) => {
            stored.set(descriptor.key, value);
        },
    } as IStateService;
    const toasts: string[] = [];
    const toastOptions: unknown[] = [];
    const notifications = {
        show: (toast: { message: string }) => {
            toasts.push(toast.message);
            toastOptions.push(toast);
        },
    } as unknown as NotificationService;
    const component = new CallHierarchyComponent(
        views.service,
        references,
        { getActiveEditor: () => editor } as unknown as IEditorService,
        languageFeatures,
        reveal,
        NULL_JUMP_RECORDER,
        state,
        views.contextKeys,
        notifications,
        NERD_FONT_ICONS,
    );
    const frame = (): string =>
        renderElement(views.root(REFERENCES_VIEWLET_ID), 50, 10, { themeVars: true }).screenToString();
    const key = (name: "callHierarchyMode" | "callHierarchyVisible"): unknown => views.contextKeys.get(name);
    /** The sections of the container, as the frame builds them. */
    const sections = (): readonly string[] => views.paneView(REFERENCES_VIEWLET_ID).getPaneIds();
    return {
        views,
        component,
        references,
        provider,
        opened,
        positions,
        toasts,
        toastOptions,
        frame,
        key,
        stored,
        sections,
    };
}

describe("CallHierarchyComponent", () => {
    it("opens at the caret: the root expanded, its child selected, on the frame with the title and root name", async () => {
        const { component, provider, frame, key } = setup();
        await component.show();

        expect(provider.prepareCallHierarchy).toHaveBeenCalledWith(
            { uri: "file:///a.ts", languageId: "typescript", versionId: 3, line: 5, character: 2 },
            expect.anything(),
        );
        expect(component.tree.getSelectedNode()?.item.name).toBe("caller");
        const text = frame();
        expect(text).toContain("Callers Of");
        expect(text).toContain("root");
        expect(text).toContain("caller");
        expect(key("callHierarchyVisible")).toBe(true);
        expect(key("callHierarchyMode")).toBe("incoming");
    });

    it("the tree takes the focus, is styled as the sidebar and starts one column in", async () => {
        const { component, frame } = setup();
        const focus = vi.spyOn(component.tree, "focus");
        await component.show();
        expect(focus).toHaveBeenCalled();
        expect(component.tree.id).toBe("callHierarchyTree");
        expect(component.view.id).toBe("callHierarchyView");
        expect(component.view.style).toEqual({ fg: "sideBar.foreground", bg: "sideBar.background" });
        expect(frame()).not.toContain("No results.");
        const rootRow = frame()
            .split("\n")
            .find((row) => row.includes("root") && !row.includes("Callers"));
        expect(rootRow?.startsWith(" ")).toBe(true);
    });

    it("the section replaces the list of references in the container", async () => {
        const { component, sections } = setup();
        expect(sections()).toEqual([REFERENCES_VIEW_ID]);
        await component.show();
        expect(sections()).toEqual([CALL_HIERARCHY_VIEW_ID]);
    });

    it("nothing at the caret: a toast, no section, no session to release", async () => {
        const { component, provider, toasts, toastOptions, sections, key } = setup(makeProvider(null));
        await component.show();
        expect(toasts).toEqual(["No results"]);
        expect(toastOptions).toEqual([{ severity: "info", message: "No results", modal: false, items: [] }]);
        expect(sections()).toEqual([REFERENCES_VIEW_ID]);
        expect(key("callHierarchyVisible")).not.toBe(true);
        expect(provider.releaseCallHierarchy).not.toHaveBeenCalled();
    });

    it("no provider or no editor: nothing is asked", async () => {
        const { component, toasts } = setup();
        const none = new LanguageFeaturesService();
        Object.assign(component, { languageFeatures: none });
        await component.show();
        expect(toasts).toEqual([]);
        expect(component.tree.getSelectedNode()).toBeNull();

        Object.assign(component, { group: { getActiveEditor: () => null } });
        await component.show();
        expect(component.tree.getSelectedNode()).toBeNull();
    });

    it("a root without children says `No results.`", async () => {
        const provider = makeProvider();
        provider.provideIncomingCalls = vi.fn(() => Promise.resolve([]));
        const { component, frame } = setup(provider);
        await component.show();
        expect(frame()).toContain("No results.");
        expect(component.tree.getSelectedNode()?.item.name).toBe("root");
    });

    it("the message goes away when the switched tree has rows", async () => {
        const provider = makeProvider();
        provider.provideIncomingCalls = vi.fn(() => Promise.resolve([]));
        const { component, frame } = setup(provider);
        await component.show();
        expect(frame()).toContain("No results.");
        const setText = vi.spyOn(ViewMessageElement.prototype, "setText");
        await component.setDirection("outgoing");
        expect(setText).toHaveBeenCalledWith("");
        setText.mockRestore();
        expect(frame()).not.toContain("No results.");
        expect(frame()).toContain("callee");
    });

    it("a late empty answer of the replaced tree says nothing about the new one", async () => {
        const provider = makeProvider();
        let answer: () => void = () => undefined;
        provider.provideIncomingCalls = vi.fn(
            () =>
                new Promise((resolve) => {
                    answer = () => {
                        resolve([]);
                    };
                }),
        ) as CallHierarchyProvider["provideIncomingCalls"];
        const { component, frame } = setup(provider);
        const showing = component.show();
        await waitUntil("children requested", () => vi.mocked(provider.provideIncomingCalls).mock.calls.length > 0);
        await component.setDirection("outgoing");
        answer();
        await showing;
        expect(frame()).toContain("callee");
        expect(frame()).not.toContain("No results.");
    });

    it("an answer arriving after dispose is released", async () => {
        const provider = makeProvider();
        let answer: (session: ICallHierarchySession) => void = () => undefined;
        provider.prepareCallHierarchy = vi.fn(
            () =>
                new Promise<ICallHierarchySession>((resolve) => {
                    answer = resolve;
                }),
        );
        const { component } = setup(provider);
        const showing = component.show();
        component.dispose();
        answer({ sessionId: 78, items: [ROOT] });
        await showing;
        expect(provider.releaseCallHierarchy).toHaveBeenCalledWith(78);
    });

    it("several roots without children stay without a message", async () => {
        const provider = makeProvider({ sessionId: 40, items: [ROOT, item(9, "second")] });
        provider.provideIncomingCalls = vi.fn(() => Promise.resolve([]));
        const { component, frame } = setup(provider);
        await component.show();
        expect(frame()).not.toContain("No results.");
        expect(frame()).toContain("second");
    });

    it("Enter opens the earliest call of a caller", async () => {
        const { component, opened, positions } = setup();
        await component.show();
        const node = component.tree.getSelectedNode();
        if (node === null) throw new Error("no selection");
        component.tree.onActivate?.(node, { pinned: true, preserveFocus: false });
        expect(opened).toEqual(["file:///a.ts"]);
        expect(positions).toEqual([[7, 3]]);
    });

    it("switching direction reroots on the selected row, in the same session, and remembers the direction", async () => {
        const { component, provider, frame, key, stored } = setup();
        await component.show();

        await component.setDirection("outgoing");

        expect(stored.get(CALL_HIERARCHY_MODE_STATE.key)).toBe("outgoing");
        expect(key("callHierarchyMode")).toBe("outgoing");
        expect(provider.provideOutgoingCalls).toHaveBeenCalledWith(40, CALLER.itemId, expect.anything());
        expect(provider.prepareCallHierarchy).toHaveBeenCalledTimes(1);
        expect(provider.releaseCallHierarchy).not.toHaveBeenCalled();
        const text = frame();
        expect(text).toContain("Calls From");
        expect(text).toContain("caller");
        expect(text).toContain("callee");
        expect(text).not.toContain("root");
    });

    it("the same direction again changes nothing", async () => {
        const { component, provider } = setup();
        await component.show();
        await component.setDirection("incoming");
        expect(provider.provideIncomingCalls).toHaveBeenCalledTimes(1);
    });

    it("switching with no tree only remembers it; the next tree opens in that direction", async () => {
        const { component, provider, frame } = setup();
        await component.setDirection("outgoing");
        expect(provider.prepareCallHierarchy).not.toHaveBeenCalled();
        await component.show();
        expect(provider.provideOutgoingCalls).toHaveBeenCalledWith(40, ROOT.itemId, expect.anything());
        expect(frame()).toContain("Calls From");
    });

    it("the remembered direction applies from the start", async () => {
        const stored = new Map<string, unknown>([[CALL_HIERARCHY_MODE_STATE.key, "outgoing"]]);
        const { component, key, provider } = setup(makeProvider(), stored);
        expect(key("callHierarchyMode")).toBe("outgoing");
        await component.show();
        expect(provider.provideIncomingCalls).not.toHaveBeenCalled();
    });

    it("without a selected row the switch goes back to the prepared roots", async () => {
        const { component, provider } = setup();
        await component.show();
        vi.spyOn(component.tree, "getSelectedNode").mockReturnValue(null);
        await component.setDirection("outgoing");
        expect(provider.provideOutgoingCalls).toHaveBeenCalledWith(40, ROOT.itemId, expect.anything());
    });

    it("Dismiss releases the session, removes the section and brings the list back", async () => {
        const { component, provider, sections, key } = setup();
        await component.show();
        component.dismiss();
        expect(provider.releaseCallHierarchy).toHaveBeenCalledWith(40);
        expect(sections()).toEqual([REFERENCES_VIEW_ID]);
        expect(key("callHierarchyVisible")).toBe(false);
        await waitUntil("the tree is empty", () => component.tree.getSelectedNode() === null);

        component.dismiss();
        expect(provider.releaseCallHierarchy).toHaveBeenCalledTimes(1);
    });

    it("Find All References takes the panel back the same way", async () => {
        const { component, references, provider, sections } = setup();
        await component.show();
        references.revealResults();
        expect(provider.releaseCallHierarchy).toHaveBeenCalledWith(40);
        expect(sections()).toEqual([REFERENCES_VIEW_ID]);
    });

    it("a new tree releases the previous session", async () => {
        const provider = makeProvider();
        provider.prepareCallHierarchy = vi
            .fn()
            .mockResolvedValueOnce({ sessionId: 40, items: [ROOT] })
            .mockResolvedValueOnce({ sessionId: 41, items: [ROOT] });
        const { component } = setup(provider);
        await component.show();
        await component.show();
        expect(provider.releaseCallHierarchy).toHaveBeenCalledTimes(1);
        expect(provider.releaseCallHierarchy).toHaveBeenCalledWith(40);
    });

    it("an answer that lost the race is released, not shown", async () => {
        const provider = makeProvider();
        let answer: (session: ICallHierarchySession) => void = () => undefined;
        provider.prepareCallHierarchy = vi.fn(
            () =>
                new Promise<ICallHierarchySession>((resolve) => {
                    answer = resolve;
                }),
        );
        const { component, frame } = setup(provider);
        const showing = component.show();
        component.dismiss();
        answer({ sessionId: 77, items: [ROOT] });
        await showing;
        expect(provider.releaseCallHierarchy).toHaveBeenCalledWith(77);
        expect(frame()).not.toContain("Callers Of");
    });

    it("a stale empty answer has nothing to release and no toast", async () => {
        const provider = makeProvider();
        let answer: (session: null) => void = () => undefined;
        provider.prepareCallHierarchy = vi.fn(
            () =>
                new Promise<null>((resolve) => {
                    answer = resolve;
                }),
        );
        const { component, toasts } = setup(provider);
        const showing = component.show();
        component.dismiss();
        answer(null);
        await showing;
        expect(provider.releaseCallHierarchy).not.toHaveBeenCalled();
        expect(toasts).toEqual([]);
    });

    it("children arriving after Dismiss don't touch the tree", async () => {
        const provider = makeProvider();
        let answer: () => void = () => undefined;
        provider.provideIncomingCalls = vi.fn(
            () =>
                new Promise((resolve) => {
                    answer = () => {
                        resolve([{ from: CALLER, fromRanges: [] }]);
                    };
                }),
        ) as CallHierarchyProvider["provideIncomingCalls"];
        const { component } = setup(provider);
        const showing = component.show();
        await waitUntil("children requested", () => vi.mocked(provider.provideIncomingCalls).mock.calls.length > 0);
        component.dismiss();
        answer();
        await showing;
        expect(component.tree.getSelectedNode()).toBeNull();
    });

    it("disposing releases the session", async () => {
        const { component, provider } = setup();
        await component.show();
        component.dispose();
        expect(provider.releaseCallHierarchy).toHaveBeenCalledWith(40);
    });
});

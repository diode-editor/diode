import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { CallHierarchyProvider } from "../../../../editor/common/languages/iCallHierarchySource.ts";
import type {
    ITypeHierarchyItem,
    ITypeHierarchySession,
    TypeHierarchyProvider,
} from "../../../../editor/common/languages/iTypeHierarchySource.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { TYPE_HIERARCHY_MODE_STATE } from "../../../common/stateKeys.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { NULL_JUMP_RECORDER } from "../../../services/history/browser/historyService.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";

import { CallHierarchyComponent } from "./callHierarchyComponent.ts";
import { HIERARCHY_VIEW_ID } from "./hierarchyComponent.ts";
import { REFERENCES_VIEW_ID, REFERENCES_VIEWLET_ID, ReferencesComponent } from "./referencesComponent.ts";
import { TypeHierarchyComponent } from "./typeHierarchyComponent.ts";

const CONFIGURATION = { get: () => undefined } as unknown as IConfigurationService;

function item(itemId: number, name: string, line = itemId): ITypeHierarchyItem {
    const range = createRange(line, 0, line, 40);
    return { itemId, name, kind: 10, uri: "file:///a.go", range, selectionRange: createRange(line, 5, line, 9) };
}

const SHAPE = item(1, "Shape");
const CIRCLE = item(2, "Circle");
const SQUARE = item(3, "Square");
const BASE = item(4, "Base");

function makeProvider(
    session: ITypeHierarchySession | null = { sessionId: 40, items: [SHAPE] },
): TypeHierarchyProvider {
    return {
        prepareTypeHierarchy: vi.fn(() => Promise.resolve(session)),
        provideSubtypes: vi.fn((_session: number, itemId: number) =>
            Promise.resolve(itemId === SHAPE.itemId ? [SQUARE, CIRCLE] : []),
        ),
        provideSupertypes: vi.fn((_session: number, itemId: number) =>
            Promise.resolve(itemId === SHAPE.itemId || itemId === CIRCLE.itemId ? [BASE] : []),
        ),
        releaseTypeHierarchy: vi.fn(),
    };
}

function makeCallProvider(): CallHierarchyProvider {
    return {
        prepareCallHierarchy: vi.fn(() => Promise.resolve({ sessionId: 90, items: [item(7, "render")] })),
        provideIncomingCalls: vi.fn(() => Promise.resolve([{ from: item(8, "paint"), fromRanges: [] }])),
        provideOutgoingCalls: vi.fn(() => Promise.resolve([])),
        releaseCallHierarchy: vi.fn(),
    };
}

function setup(provider: TypeHierarchyProvider = makeProvider(), stored = new Map<string, unknown>()) {
    const views = makeViewsHarness();
    const opened: string[] = [];
    const positions: [number, number | undefined][] = [];
    const editor = {
        uri: { toString: () => "file:///a.go" },
        languageId: "go",
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
    languageFeatures.typeHierarchyProvider.register("*", provider);
    const callProvider = makeCallProvider();
    languageFeatures.callHierarchyProvider.register("*", callProvider);
    const state: IStateService = {
        ...NULL_STATE_SERVICE,
        get: <T>(descriptor: { key: string; default: T }): T =>
            stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default,
        store: (descriptor: { key: string }, value: unknown) => {
            stored.set(descriptor.key, value);
        },
    } as IStateService;
    const toasts: string[] = [];
    const notifications = {
        show: (toast: { message: string }) => {
            toasts.push(toast.message);
        },
    } as unknown as NotificationService;
    const group = { getActiveEditor: () => editor } as unknown as IEditorService;
    const calls = new CallHierarchyComponent(
        views.service,
        references,
        group,
        languageFeatures,
        reveal,
        NULL_JUMP_RECORDER,
        state,
        views.contextKeys,
        notifications,
        NERD_FONT_ICONS,
        CONFIGURATION,
    );
    const component = new TypeHierarchyComponent(
        views.service,
        references,
        group,
        languageFeatures,
        reveal,
        NULL_JUMP_RECORDER,
        state,
        views.contextKeys,
        notifications,
        NERD_FONT_ICONS,
        CONFIGURATION,
        calls,
    );
    const frame = (): string =>
        renderElement(views.root(REFERENCES_VIEWLET_ID), 50, 12, { themeVars: true }).screenToString();
    const sections = (): readonly string[] => views.paneView(REFERENCES_VIEWLET_ID).getPaneIds();
    const key = (name: "typeHierarchyMode" | "typeHierarchyVisible" | "callHierarchyVisible"): unknown =>
        views.contextKeys.get(name);
    return {
        views,
        component,
        calls,
        callProvider,
        references,
        provider,
        opened,
        positions,
        toasts,
        frame,
        sections,
        key,
        stored,
    };
}

describe("TypeHierarchyComponent", () => {
    it("opens at the caret in the default direction: subtypes on the frame, sorted, with the root's name", async () => {
        const { component, provider, frame, key, sections } = setup();
        await component.show();

        expect(provider.prepareTypeHierarchy).toHaveBeenCalledWith(
            { uri: "file:///a.go", languageId: "go", versionId: 3, line: 5, character: 2 },
            expect.anything(),
        );
        const text = frame();
        expect(text).toContain("Subtypes Of");
        expect(text).toContain("Shape");
        expect(text.indexOf("Circle")).toBeGreaterThan(-1);
        expect(text.indexOf("Square")).toBeGreaterThan(text.indexOf("Circle"));
        expect(component.tree.getSelectedNode()?.item.name).toBe("Circle");
        expect(sections()).toEqual([HIERARCHY_VIEW_ID]);
        expect(key("typeHierarchyVisible")).toBe(true);
        expect(key("typeHierarchyMode")).toBe("subtypes");
        expect(component.tree.id).toBe("typeHierarchyTree");
        expect(component.view.id).toBe("typeHierarchyView");
    });

    it("Enter goes to the name of the type in both directions", async () => {
        const { component, opened, positions } = setup();
        await component.show();
        const activate = (): void => {
            const node = component.tree.getSelectedNode();
            if (node === null) throw new Error("no selection");
            component.tree.onActivate?.(node, { pinned: true, preserveFocus: false });
        };

        activate();
        expect(opened).toEqual(["file:///a.go"]);
        expect(positions).toEqual([[CIRCLE.selectionRange.start.line, 5]]);

        await component.setDirection("supertypes");
        activate();
        expect(positions.at(-1)).toEqual([BASE.selectionRange.start.line, 5]);
    });

    it("switching direction reroots on the selected row, in the same session, and remembers the direction", async () => {
        const { component, provider, frame, key, stored } = setup();
        await component.show();

        await component.setDirection("supertypes");

        expect(stored.get(TYPE_HIERARCHY_MODE_STATE.key)).toBe("supertypes");
        expect(key("typeHierarchyMode")).toBe("supertypes");
        expect(provider.provideSupertypes).toHaveBeenCalledWith(40, CIRCLE.itemId, expect.anything());
        expect(provider.prepareTypeHierarchy).toHaveBeenCalledTimes(1);
        expect(provider.releaseTypeHierarchy).not.toHaveBeenCalled();
        const text = frame();
        expect(text).toContain("Supertypes Of");
        expect(text).toContain("Circle");
        expect(text).toContain("Base");
        expect(text).not.toContain("Shape");
    });

    it("the remembered direction applies from the start", async () => {
        const stored = new Map<string, unknown>([[TYPE_HIERARCHY_MODE_STATE.key, "supertypes"]]);
        const { component, key, provider, frame } = setup(makeProvider(), stored);
        expect(key("typeHierarchyMode")).toBe("supertypes");
        await component.show();
        expect(provider.provideSubtypes).not.toHaveBeenCalled();
        expect(frame()).toContain("Supertypes Of");
    });

    it("nothing at the caret: a toast, no section", async () => {
        const { component, toasts, sections, key } = setup(makeProvider(null));
        await component.show();
        expect(toasts).toEqual(["No results"]);
        expect(sections()).toEqual([REFERENCES_VIEW_ID]);
        expect(key("typeHierarchyVisible")).not.toBe(true);
    });

    it("a root without children says `No results.`", async () => {
        const provider = makeProvider();
        provider.provideSubtypes = vi.fn(() => Promise.resolve([]));
        const { component, frame } = setup(provider);
        await component.show();
        expect(frame()).toContain("No results.");
    });

    it("Dismiss releases the session by the type provider and brings the list back", async () => {
        const { component, provider, sections, key } = setup();
        await component.show();
        component.dismiss();
        expect(provider.releaseTypeHierarchy).toHaveBeenCalledWith(40);
        expect(sections()).toEqual([REFERENCES_VIEW_ID]);
        expect(key("typeHierarchyVisible")).toBe(false);
    });

    it("Find All References takes the panel back", async () => {
        const { component, references, provider, sections } = setup();
        await component.show();
        references.revealResults();
        expect(provider.releaseTypeHierarchy).toHaveBeenCalledWith(40);
        expect(sections()).toEqual([REFERENCES_VIEW_ID]);
    });
});

describe("the call tree and the type tree share one section", () => {
    it("the type tree takes the section from the call tree and releases its session", async () => {
        const { component, calls, callProvider, frame, sections, key } = setup();
        await calls.show();
        expect(frame()).toContain("Callers Of");

        await component.show();

        expect(callProvider.releaseCallHierarchy).toHaveBeenCalledWith(90);
        expect(key("callHierarchyVisible")).toBe(false);
        expect(key("typeHierarchyVisible")).toBe(true);
        expect(sections()).toEqual([HIERARCHY_VIEW_ID]);
        const text = frame();
        expect(text).toContain("Subtypes Of");
        expect(text).toContain("Circle");
        expect(text).not.toContain("Callers Of");
        expect(text).not.toContain("paint");
    });

    it("the call tree takes the section back the same way", async () => {
        const { component, calls, provider, frame, sections, key } = setup();
        await component.show();

        await calls.show();

        expect(provider.releaseTypeHierarchy).toHaveBeenCalledWith(40);
        expect(key("typeHierarchyVisible")).toBe(false);
        expect(key("callHierarchyVisible")).toBe(true);
        expect(sections()).toEqual([HIERARCHY_VIEW_ID]);
        const text = frame();
        expect(text).toContain("Callers Of");
        expect(text).toContain("paint");
        expect(text).not.toContain("Subtypes Of");
    });

    it("a failed show leaves the other tree alone", async () => {
        const { component, calls, callProvider, key } = setup(makeProvider(null));
        await calls.show();
        await component.show();
        expect(callProvider.releaseCallHierarchy).not.toHaveBeenCalled();
        expect(key("callHierarchyVisible")).toBe(true);
    });

    it("the title buttons follow the tree in the section", async () => {
        const { component, calls, views } = setup();
        const visible = (when: string): boolean => views.contextKeys.evaluate(when);
        await component.show();
        expect(visible("typeHierarchyVisible && typeHierarchyMode == 'subtypes'")).toBe(true);
        expect(visible("callHierarchyVisible && callHierarchyMode == 'incoming'")).toBe(false);
        await calls.show();
        expect(visible("typeHierarchyVisible && typeHierarchyMode == 'subtypes'")).toBe(false);
        expect(visible("callHierarchyVisible && callHierarchyMode == 'incoming'")).toBe(true);
    });

    it("disposing stops following the call tree", async () => {
        const { component, calls, provider } = setup();
        await component.show();
        component.dispose();
        expect(provider.releaseTypeHierarchy).toHaveBeenCalledTimes(1);
        await calls.show();
        expect(provider.releaseTypeHierarchy).toHaveBeenCalledTimes(1);
    });
});

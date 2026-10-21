import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

import { EditorGroup } from "./editorGroupModel.ts";

interface IFakePane extends IEditorPane {
    disposed: boolean;
    focused: number;
    fireStateChange(): void;
}

function makePane(uriPath: string): IFakePane {
    const stateListeners: (() => void)[] = [];
    const pane: IFakePane = {
        uri: Uri.file(uriPath),
        label: uriPath,
        view: {} as TUIElement,
        isModified: false,
        readOnly: false,
        disposed: false,
        focused: 0,
        getSelectedTexts: () => [],
        onDidChangeState(cb: () => void): IDisposable {
            stateListeners.push(cb);
            return {
                dispose: () => {
                    const i = stateListeners.indexOf(cb);
                    if (i >= 0) stateListeners.splice(i, 1);
                },
            };
        },
        focusEditor() {
            pane.focused++;
        },
        dispose() {
            pane.disposed = true;
        },
        fireStateChange() {
            for (const cb of [...stateListeners]) cb();
        },
    };
    return pane;
}

function groupWith(...paths: string[]): { group: EditorGroup; panes: IFakePane[] } {
    const group = new EditorGroup(1);
    const panes = paths.map((p) => makePane(p));
    for (const pane of panes) group.insertPane(pane);
    return { group, panes };
}

describe("EditorGroup", () => {
    it("activateTab event order contract: onDidChangeEditors → focus → onDidChangeActivePane", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts");
        const order: string[] = [];
        group.onDidChangeEditors(() => order.push("editors"));
        group.onDidChangeActivePane(() => order.push("active"));
        panes[1].focusEditor = () => order.push("focus");

        group.activateTab(1);

        expect(order).toEqual(["editors", "focus", "active"]);
    });

    it("activateTab without focus does not focus, but the events are the same", () => {
        const { group, panes } = groupWith("/a.ts");
        group.activateTab(0, { focus: false });
        expect(panes[0].focused).toBe(0);
        expect(group.activePane === panes[0]).toBe(true);
    });

    it("insertPane before the active tab shifts activeIndex, the active tab stays the same", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts");
        group.activateTab(1);
        const inserted = makePane("/c.ts");

        group.insertPane(inserted, { index: 0 });

        expect(group.activeIndex).toBe(2);
        expect(group.activePane === panes[1]).toBe(true);
        expect(group.getPanes()[0] === inserted).toBe(true);
    });

    it("closeTab of the active tab: the left neighbour becomes active, the tab is disposed", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.activateTab(1);

        group.closeTab(1);

        expect(panes[1].disposed).toBe(true);
        expect(group.activePane === panes[0]).toBe(true);
        expect(group.editorCount).toBe(2);
    });

    it("closeTab of the last tab: activePane == null, event with null", () => {
        const { group, panes } = groupWith("/a.ts");
        group.activateTab(0);
        let observed: IEditorPane | null | undefined;
        group.onDidChangeActivePane((pane) => {
            observed = pane;
        });

        group.closeTab(0);

        expect(panes[0].disposed).toBe(true);
        expect(group.activePane).toBeNull();
        expect(observed).toBeNull();
        expect(group.activeIndex).toBe(-1);
    });

    it("closeTab after the active tab: the active one does not change, only a tabs redraw", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts");
        group.activateTab(0);
        let editorsFired = 0;
        let activeFired = 0;
        group.onDidChangeEditors(() => editorsFired++);
        group.onDidChangeActivePane(() => activeFired++);

        group.closeTab(1);

        expect(editorsFired).toBe(1);
        expect(activeFired).toBe(0);
        expect(group.activePane === panes[0]).toBe(true);
    });

    it("detachPane removes the tab alive and unsubscribes from its state", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts");
        group.activateTab(1);
        let editorsFired = 0;
        group.onDidChangeEditors(() => editorsFired++);

        const detached = group.detachPane(1);

        expect(detached === panes[1]).toBe(true);
        expect(panes[1].disposed).toBe(false);
        expect(group.editorCount).toBe(1);
        const before = editorsFired;
        panes[1].fireStateChange();
        expect(editorsFired).toBe(before);
    });

    it("detachPane with an invalid index returns null, the group is untouched", () => {
        const { group } = groupWith("/a.ts");
        expect(group.detachPane(-1)).toBeNull();
        expect(group.detachPane(1)).toBeNull();
        expect(group.editorCount).toBe(1);
    });

    it("a tab state change redraws the group's tabs", () => {
        const { group, panes } = groupWith("/a.ts");
        let editorsFired = 0;
        group.onDidChangeEditors(() => editorsFired++);

        panes[0].fireStateChange();

        expect(editorsFired).toBe(1);
    });

    it("findPaneIndex — per-group dedup by resource", () => {
        const { group } = groupWith("/a.ts", "/b.ts");
        expect(group.findPaneIndex(Uri.file("/b.ts"))).toBe(1);
        expect(group.findPaneIndex(Uri.file("/nope.ts"))).toBe(-1);
    });

    it("disposing the group disposes the remaining tabs", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts");
        group.dispose();
        expect(panes[0].disposed).toBe(true);
        expect(panes[1].disposed).toBe(true);
    });

    it("a repeated dispose of the group's subscriptions is a no-op, other listeners stay alive", () => {
        const { group } = groupWith("/a.ts", "/b.ts");
        let editorsFired = 0;
        let paneFired = 0;
        const editorsFirst = group.onDidChangeEditors(() => {});
        group.onDidChangeEditors(() => editorsFired++);
        const paneFirst = group.onDidChangeActivePane(() => {});
        group.onDidChangeActivePane(() => paneFired++);

        editorsFirst.dispose();
        editorsFirst.dispose(); // indexOf === -1 — the second listener is not removed
        paneFirst.dispose();
        paneFirst.dispose();

        group.activateTab(1);
        expect(editorsFired).toBe(1);
        expect(paneFired).toBe(1);
    });

    it("MRU: the cycle is frozen, endMruCycle commits the choice", () => {
        const { group, panes } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.activateTab(0);
        group.activateTab(1);
        group.activateTab(2);
        // MRU: c, b, a. One step of the series goes to b.
        group.cycleMru(1);
        expect(group.activePane === panes[1]).toBe(true);
        group.cycleMru(1);
        expect(group.activePane === panes[0]).toBe(true);
        group.endMruCycle();
        expect(group.getMruOrder()[0] === panes[0]).toBe(true);
    });
});

import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

import { EditorGroup, type MruCycleState } from "./editorGroupModel.ts";

function makePane(uriPath: string): IEditorPane {
    const pane: IEditorPane = {
        uri: Uri.file(uriPath),
        label: uriPath,
        view: {} as TUIElement,
        isModified: false,
        readOnly: false,
        getSelectedTexts: () => [],
        onDidChangeState(): IDisposable {
            return { dispose: () => {} };
        },
        focusEditor() {},
        dispose() {},
    };
    return pane;
}

function groupWith(...paths: string[]): { group: EditorGroup; events: (MruCycleState | null)[] } {
    const group = new EditorGroup(1);
    // Like openFile: insert + activate each — activations fill the MRU.
    for (const [index, path] of paths.entries()) {
        group.insertPane(makePane(path));
        group.activateTab(index);
    }
    const events: (MruCycleState | null)[] = [];
    group.onDidChangeMruCycle((state) => events.push(state));
    return { group, events };
}

function names(state: MruCycleState | null): string[] {
    return (state?.panes ?? []).map((pane) => pane.label);
}

describe("EditorGroup — Ctrl+Tab cycle event (onDidChangeMruCycle)", () => {
    it("each cycleMru step sends the frozen MRU list and the cycle position", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts", "/c.ts");
        // MRU after activating c: c, b, a.
        group.cycleMru(1);

        expect(events).toHaveLength(1);
        expect(names(events[0])).toEqual(["/c.ts", "/b.ts", "/a.ts"]);
        expect(events[0]?.pointer).toBe(1);

        group.cycleMru(1);
        expect(events).toHaveLength(2);
        expect(names(events[1])).toEqual(["/c.ts", "/b.ts", "/a.ts"]);
        expect(events[1]?.pointer).toBe(2);
    });

    it("a backward step moves the position, wrapping around the frozen list", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.cycleMru(-1);
        expect(events[0]?.pointer).toBe(2);
    });

    it("endMruCycle (Ctrl release) sends null, the overlay hides", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts");
        group.cycleMru(1);
        group.endMruCycle();
        expect(events).toEqual([expect.objectContaining({ pointer: 1 }), null]);
    });

    it("a regular tab switch during a cycle sends null", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.cycleMru(1);
        group.activateTab(0);
        expect(events[events.length - 1]).toBeNull();
    });

    it("closing a tab during a cycle sends null (the frozen list is invalid)", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.cycleMru(1);
        group.closeTab(0);
        expect(events[events.length - 1]).toBeNull();
    });

    it("structural changes WITHOUT an ongoing cycle do not wake subscribers", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.closeTab(0);
        group.activateTab(0);
        expect(events).toEqual([]);
    });

    it("endMruCycle outside a cycle is a no-op without an event", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts");
        group.endMruCycle();
        expect(events).toEqual([]);
    });

    it("unsubscribing removes the listener", () => {
        const group = new EditorGroup(1);
        for (const [index, path] of ["/a.ts", "/b.ts"].entries()) {
            group.insertPane(makePane(path));
            group.activateTab(index);
        }
        const events: (MruCycleState | null)[] = [];
        const others: (MruCycleState | null)[] = [];
        const subscription = group.onDidChangeMruCycle((state) => events.push(state));
        group.onDidChangeMruCycle((state) => others.push(state));
        subscription.dispose();
        // A repeated dispose is harmless and does NOT touch other subscriptions.
        subscription.dispose();
        group.cycleMru(1);
        expect(events).toEqual([]);
        expect(others).toHaveLength(1);
    });

    it("the snapshot in the event is a copy: cycle mutations do not change it", () => {
        const { group, events } = groupWith("/a.ts", "/b.ts", "/c.ts");
        group.cycleMru(1);
        const first = events[0];
        group.cycleMru(1);
        // The first snapshot stays in place — the overlay may keep it as is.
        expect(first?.pointer).toBe(1);
        expect(events[1]?.pointer).toBe(2);
    });
});

describe("EditorGroup — MRU snapshot for the open editors picker (getMruPanes)", () => {
    it("most recent first: the active tab heads the list", () => {
        const { group } = groupWith("/a.ts", "/b.ts", "/c.ts");

        expect(group.getMruPanes().map((pane) => pane.label)).toEqual(["/c.ts", "/b.ts", "/a.ts"]);

        group.activateTab(0);

        expect(group.getMruPanes().map((pane) => pane.label)).toEqual(["/a.ts", "/c.ts", "/b.ts"]);
    });

    it("a tab never activated (arrived via merge) is still in the list, at the tail", () => {
        const { group } = groupWith("/a.ts", "/b.ts");
        // mergeGroupInto inserts foreign tabs without activation: they are not in mruOrder.
        group.insertPane(makePane("/merged.ts"));

        expect(group.getMruPanes().map((pane) => pane.label)).toEqual(["/b.ts", "/a.ts", "/merged.ts"]);
    });

    it("a closed tab leaves the list", () => {
        const { group } = groupWith("/a.ts", "/b.ts", "/c.ts");

        group.closeTab(2);

        expect(group.getMruPanes().map((pane) => pane.label)).toEqual(["/b.ts", "/a.ts"]);
    });

    it("an empty group has an empty list", () => {
        expect(new EditorGroup(1).getMruPanes()).toEqual([]);
    });
});

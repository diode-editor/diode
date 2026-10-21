import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { IGroupsChangeEvent } from "../common/editorGroupsService.ts";

import type { EditorGroup } from "./editorGroupModel.ts";
import { EditorGroupsService } from "./editorGroupsService.ts";

class FakePane implements IEditorPane {
    public readonly view = new TUIElement();
    public readonly isModified = false;
    public readonly readOnly = false;
    public readonly label: string;
    public readonly uri: Uri;
    public focused = 0;
    public disposed = false;

    public constructor(name: string) {
        this.uri = Uri.from({ scheme: "fake", path: `/${name}` });
        this.label = name;
    }

    public onDidChangeState(): { dispose: () => void } {
        return { dispose: () => {} };
    }

    public focusEditor(): void {
        this.focused++;
    }

    public getSelectedTexts(): string[] {
        return [];
    }

    public dispose(): void {
        this.disposed = true;
    }
}

function recordingLog(sink: string[]): ILogService {
    return {
        ...NULL_LOG_SERVICE,
        createLogger: () => ({
            trace: () => undefined,
            debug: () => undefined,
            info: (message: string) => sink.push(message),
            warn: () => undefined,
            error: () => undefined,
            isEnabled: () => true,
        }),
    };
}

function setup() {
    const logs: string[] = [];
    const service = new EditorGroupsService(recordingLog(logs), new InMemoryConfigurationService());
    const events: string[] = [];
    const groupEvents: IGroupsChangeEvent[] = [];
    const focusedGroups: EditorGroup[] = [];
    const col = (group: EditorGroup) => String(service.viewColumnOf(group));
    service.onDidGroupsChange((event) => {
        groupEvents.push(event);
        events.push(`groups:${event.kind}`);
    });
    service.onDidChangeActivePane((pane) => events.push(`pane:${pane?.label ?? "none"}`));
    service.onDidActiveGroupChange((group) => events.push(`group:${col(group)}`));
    service.focusGroupContentHook = (group) => focusedGroups.push(group);
    return { service, logs, events, groupEvents, focusedGroups };
}

/** Opens a tab in the group without focus (like restore). */
function open(group: EditorGroup, name: string): FakePane {
    const pane = new FakePane(name);
    group.insertPane(pane);
    group.activateTab(group.editorCount - 1, { focus: false });
    return pane;
}

describe("EditorGroupsService — strip operations", () => {
    describe("splitActiveGroup", () => {
        it("an empty new group (tab not duplicated): no active tab, focus in its filler by default", () => {
            const { service, events, focusedGroups, groupEvents } = setup();
            open(service.activeGroup, "a");
            events.length = 0;

            const group = service.splitActiveGroup(() => {});

            expect(groupEvents.at(-1)).toEqual({ kind: "added", group, index: 1, source: service.groups[0] });
            expect(events).toEqual(["groups:added", "pane:none", "group:2"]);
            expect(focusedGroups).toEqual([group]);
        });

        it("focus: false leaves focus alone", () => {
            const { service, focusedGroups } = setup();
            open(service.activeGroup, "a");

            service.splitActiveGroup(() => {}, { focus: false });

            expect(focusedGroups).toEqual([]);
        });

        it("no room: refusal with a log entry", () => {
            const { service, logs } = setup();
            open(service.activeGroup, "a");
            service.canAddGroupHook = () => false;

            expect(service.splitActiveGroup(() => {})).toBeNull();
            expect(logs).toEqual(["split refused — not enough space"]);
        });
    });

    describe("newGroup", () => {
        it("add event, `no active tab`, focus and group change, in order", () => {
            const { service, events, focusedGroups, groupEvents } = setup();

            const group = service.newGroup("after");

            expect(groupEvents).toEqual([{ kind: "added", group, index: 1 }]);
            expect(events).toEqual(["groups:added", "pane:none", "group:2"]);
            expect(focusedGroups).toEqual([group]);
        });

        it("focus: false does not focus", () => {
            const { service, focusedGroups } = setup();

            service.newGroup("before", { focus: false });

            expect(focusedGroups).toEqual([]);
            expect(service.viewColumnOf(service.activeGroup)).toBe(1);
        });

        it("no room: refusal with a log entry", () => {
            const { service, logs } = setup();
            service.canAddGroupHook = () => false;

            expect(service.newGroup("after")).toBeNull();
            expect(logs).toEqual(["new group refused — not enough space"]);
        });
    });

    describe("focusGroup", () => {
        it("focuses the content by default, not with focus: false", () => {
            const { service, focusedGroups } = setup();
            service.newGroup("after", { focus: false });

            service.focusGroup({ index: 0 });
            expect(focusedGroups).toEqual([service.groups[0]]);

            service.focusGroup({ index: 1 }, { focus: false });
            expect(focusedGroups).toEqual([service.groups[0]]);
            expect(service.activeGroup).toBe(service.groups[1]);
        });

        it("an already active group: no events and no end of the Ctrl+Tab cycle", () => {
            const { service, events } = setup();
            open(service.activeGroup, "a");
            events.length = 0;

            service.focusGroup({ index: 0 }, { focus: false });

            expect(events).toEqual([]);
        });

        it("focus without a view hook goes to the group's active tab", () => {
            const { service } = setup();
            service.focusGroupContentHook = undefined;
            const pane = open(service.activeGroup, "a");
            service.newGroup("after", { focus: false });

            service.focusGroup({ index: 0 });

            expect(pane.focused).toBe(1);
        });
    });

    describe("moveActiveEditorToGroup", () => {
        it("an empty active group is a no-op, no neighbour is created", () => {
            const { service, events } = setup();

            service.moveActiveEditorToGroup("next");

            expect(service.groups).toHaveLength(1);
            expect(events).toEqual([]);
        });

        it("for a single group creates a neighbour (event with source) and moves with focus", () => {
            const { service, groupEvents, events } = setup();
            const source = service.activeGroup;
            open(source, "keep");
            const moved = open(source, "moved");
            events.length = 0;

            service.moveActiveEditorToGroup("next");

            const target = service.groups[1];
            expect(groupEvents[0]).toEqual({ kind: "added", group: target, index: 1, source });
            expect(target.getPanes()).toEqual([moved]);
            expect(moved.focused).toBe(1);
            expect(events.at(-1)).toBe("group:2");
        });

        it("resource already in the target group: the moved tab merges, disposed and the existing one activated", () => {
            const { service } = setup();
            const left = service.activeGroup;
            open(left, "other");
            const leftDup = open(left, "dup");
            service.newGroup("after", { focus: false });
            const right = service.activeGroup;
            const rightDup = open(right, "dup");
            open(right, "tail");
            service.focusGroup({ index: 0 }, { focus: false });

            service.moveActiveEditorToGroup("next", { focus: false });

            expect(leftDup.disposed).toBe(true);
            expect(right.activePane).toBe(rightDup);
            expect(rightDup.focused).toBe(0);
        });

        it("no room for a neighbour: refusal with a log entry", () => {
            const { service, logs } = setup();
            open(service.activeGroup, "a");
            service.canAddGroupHook = () => false;

            service.moveActiveEditorToGroup("previous");

            expect(service.groups).toHaveLength(1);
            expect(logs).toEqual(["new group refused — not enough space"]);
        });

        it("focus: false when moving to a new neighbour: focus stays", () => {
            const { service } = setup();
            const moved = open(service.activeGroup, "moved");

            service.moveActiveEditorToGroup("previous", { focus: false });

            expect(service.groups[0].getPanes()).toEqual([moved]);
            expect(moved.focused).toBe(0);
        });
    });

    describe("sideGroup", () => {
        it("creates a group on the right: event with position and source", () => {
            const { service, groupEvents } = setup();
            const source = service.activeGroup;

            const side = service.sideGroup();

            expect(groupEvents).toEqual([{ kind: "added", group: side, index: 1, source }]);
        });

        it("no room: the active group and a log entry", () => {
            const { service, logs } = setup();
            service.canAddGroupHook = () => false;

            expect(service.sideGroup()).toBe(service.activeGroup);
            expect(logs).toEqual(["open beside refused — not enough space, opening in the active group"]);
        });
    });

    describe("joining groups", () => {
        it("joinTwoGroups: a duplicate resource is closed, unique ones move", () => {
            const { service } = setup();
            const left = service.activeGroup;
            open(left, "dup");
            service.newGroup("after", { focus: false });
            const right = service.activeGroup;
            const rightDup = open(right, "dup");
            const unique = open(right, "unique");
            service.focusGroup({ index: 0 }, { focus: false });

            service.joinTwoGroups();

            expect(rightDup.disposed).toBe(true);
            expect(unique.disposed).toBe(false);
            expect(left.getPanes().map((pane) => pane.label)).toEqual(["dup", "unique"]);
            expect(service.groups).toEqual([left]);
        });

        it("joinAllGroups with a single group is a no-op without events", () => {
            const { service, events } = setup();
            open(service.activeGroup, "a");
            events.length = 0;

            service.joinAllGroups();

            expect(events).toEqual([]);
        });

        it("joinAllGroups: the tab of the former active group stays active, even the first one", () => {
            const { service, events } = setup();
            const first = service.activeGroup;
            const shared = open(first, "shared");
            open(first, "b");
            service.newGroup("after", { focus: false });
            open(service.activeGroup, "shared");
            events.length = 0;

            service.joinAllGroups();

            expect(service.groups).toEqual([first]);
            expect(first.activePane).toBe(shared);
            expect(events.at(-1)).toBe("group:1");
        });
    });

    describe("moveActiveGroup", () => {
        it("at the strip edge: no-op on both sides", () => {
            const { service, events } = setup();
            service.newGroup("after", { focus: false });
            events.length = 0;

            service.moveActiveGroup("next");
            expect(events).toEqual([]);
            expect(service.viewColumnOf(service.activeGroup)).toBe(2);

            service.focusGroup({ index: 0 }, { focus: false });
            events.length = 0;
            service.moveActiveGroup("previous");

            expect(events).toEqual([]);
            expect(service.viewColumnOf(service.activeGroup)).toBe(1);
        });

        it("reordering fires moved with the new position", () => {
            const { service, groupEvents } = setup();
            const first = service.activeGroup;
            service.newGroup("after", { focus: false });
            service.focusGroup({ index: 0 }, { focus: false });
            groupEvents.length = 0;

            service.moveActiveGroup("next");

            expect(groupEvents).toEqual([{ kind: "moved", group: first, index: 1 }]);
            expect(service.groups[1]).toBe(first);
        });
    });

    describe("active tab and collapsing", () => {
        it("a tab change in an inactive group does not change the strip's active tab", () => {
            const { service, events } = setup();
            const left = service.activeGroup;
            open(left, "a");
            open(left, "b");
            service.newGroup("after", { focus: false });
            events.length = 0;

            left.activateTab(0, { focus: false });

            expect(events).toEqual([]);
        });

        it("an emptied inactive group collapses without changing the active one", () => {
            const { service, events, groupEvents } = setup();
            const left = service.activeGroup;
            open(left, "a");
            service.newGroup("after", { focus: false });
            const right = service.activeGroup;
            open(right, "b");
            events.length = 0;

            left.closeTab(0);

            expect(groupEvents.at(-1)).toEqual({ kind: "removed", group: left, index: 0 });
            expect(events).toEqual(["groups:removed"]);
            expect(service.activeGroup).toBe(right);
        });

        it("an emptied active group: the neighbour becomes active and focused, events in order", () => {
            const { service, events, focusedGroups } = setup();
            const left = service.activeGroup;
            open(left, "a");
            service.newGroup("after", { focus: false });
            const right = service.activeGroup;
            open(right, "b");
            events.length = 0;

            right.closeTab(0);

            expect(events).toEqual(["pane:none", "groups:removed", "pane:a", "group:1"]);
            expect(focusedGroups).toEqual([left]);
        });

        it("a collapsed group is unsubscribed: its events no longer reach the strip", () => {
            const { service, events } = setup();
            open(service.activeGroup, "a");
            service.newGroup("after", { focus: false });
            const right = service.activeGroup;
            open(right, "b");
            right.closeTab(0);
            events.length = 0;
            let editorsChanged = 0;
            service.onDidChangeEditors(() => editorsChanged++);

            open(right, "late");

            expect(events).toEqual([]);
            expect(editorsChanged).toBe(0);
        });
    });

    describe("addGroup (the group finder's new group)", () => {
        it("goes before or after its anchor, with a source event, and does not become active", () => {
            const { service, groupEvents } = setup();
            const left = service.activeGroup;
            const right = service.addGroup(left, "after")!;
            const middle = service.addGroup(right, "before")!;
            const tail = service.addGroup(right, "after")!;

            expect(service.groups).toEqual([left, middle, right, tail]);
            expect(groupEvents).toEqual([
                { kind: "added", group: right, index: 1, source: left },
                { kind: "added", group: middle, index: 1, source: right },
                { kind: "added", group: tail, index: 3, source: right },
            ]);
            expect(service.activeGroup).toBe(left);
        });

        it("no room: null and a log entry", () => {
            const { service, logs } = setup();
            service.canAddGroupHook = () => false;

            expect(service.addGroup(service.activeGroup, "after")).toBeNull();
            expect(service.groups).toHaveLength(1);
            expect(logs).toEqual(["new group refused — not enough space"]);
        });
    });

    describe("most recently active order", () => {
        it("moving a tab to a neighbor makes that group the most recent", () => {
            const { service } = setup();
            const left = service.activeGroup;
            open(left, "a");
            open(left, "b");
            service.newGroup("after", { focus: false });
            const right = service.activeGroup;
            open(right, "c");
            service.focusGroup({ index: 0 }, { focus: false });

            service.moveActiveEditorToGroup("next", { focus: false });

            expect(service.activeGroup).toBe(right);
            expect(service.getGroupsByMru()).toEqual([right, left]);
        });

        it("joinAllGroups: the surviving first group heads the order", () => {
            const { service, events, focusedGroups } = setup();
            const left = service.activeGroup;
            open(left, "a");
            service.newGroup("after", { focus: false });
            open(service.activeGroup, "b");
            events.length = 0;

            service.joinAllGroups();

            expect(service.getGroupsByMru()).toEqual([left]);
            expect({ events, focusedGroups }).toEqual({
                events: ["groups:removed", "pane:b", "group:1"],
                focusedGroups: [],
            });
        });

        it("a collapsed group leaves the order; the rest keep theirs, not the strip's", () => {
            const { service } = setup();
            const first = service.activeGroup;
            open(first, "a");
            service.newGroup("after", { focus: false });
            const second = service.activeGroup;
            open(second, "b");
            service.newGroup("after", { focus: false });
            const third = service.activeGroup;
            open(third, "c");
            service.focusGroup({ index: 0 }, { focus: false });
            expect(service.getGroupsByMru()).toEqual([first, third, second]);

            first.closeTab(0);

            expect(service.getGroupsByMru()).toEqual([second, third]);
        });
    });

    it("shutting down the service closes groups along with their tabs", () => {
        const { service } = setup();
        const pane = open(service.activeGroup, "a");
        service.newGroup("after", { focus: false });
        const other = open(service.activeGroup, "b");

        service.dispose();

        expect([pane.disposed, other.disposed]).toEqual([true, true]);
    });
});

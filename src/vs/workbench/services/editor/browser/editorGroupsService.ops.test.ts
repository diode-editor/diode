import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { IGroupsChangeEvent } from "../common/editorGroupsService.ts";

import type { EditorGroup } from "./editorGroupModel.ts";
import { EditorGroupsService } from "./editorGroupsService.ts";

/**
 * Операции полосы групп напрямую, на фейковых вкладках: события (их состав и
 * порядок), передача фокуса, отказы по месту с записью в лог, схлопывание и
 * выключение сервиса. Сквозные сценарии с настоящими редакторами — в
 * `editorGroupsService.test.ts` и харнесс-тестах сплитов.
 */

/** Вкладка-фейк: считает фокус и dispose. */
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

/** Сервис + журнал событий и фокусов содержимого групп. */
function setup() {
    const logs: string[] = [];
    const service = new EditorGroupsService(recordingLog(logs));
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

/** Открывает вкладку в группе без фокуса (как рестор). */
function open(group: EditorGroup, name: string): FakePane {
    const pane = new FakePane(name);
    group.insertPane(pane);
    group.activateTab(group.editorCount - 1, { focus: false });
    return pane;
}

describe("EditorGroupsService — операции полосы", () => {
    describe("splitActiveGroup", () => {
        it("пустая новая группа (вкладку не повторили): нет активного вкладки, фокус в её filler по умолчанию", () => {
            const { service, events, focusedGroups, groupEvents } = setup();
            open(service.activeGroup, "a");
            events.length = 0;

            const group = service.splitActiveGroup(() => {});

            expect(groupEvents.at(-1)).toEqual({ kind: "added", group, index: 1, source: service.groups[0] });
            expect(events).toEqual(["groups:added", "pane:none", "group:2"]);
            expect(focusedGroups).toEqual([group]);
        });

        it("focus: false — фокус не трогаем", () => {
            const { service, focusedGroups } = setup();
            open(service.activeGroup, "a");

            service.splitActiveGroup(() => {}, { focus: false });

            expect(focusedGroups).toEqual([]);
        });

        it("нет места — отказ с записью в лог", () => {
            const { service, logs } = setup();
            open(service.activeGroup, "a");
            service.canAddGroupHook = () => false;

            expect(service.splitActiveGroup(() => {})).toBeNull();
            expect(logs).toEqual(["split refused — not enough space"]);
        });
    });

    describe("newGroup", () => {
        it("событие добавления, «нет активной вкладки», фокус и смена группы — по порядку", () => {
            const { service, events, focusedGroups, groupEvents } = setup();

            const group = service.newGroup("after");

            expect(groupEvents).toEqual([{ kind: "added", group, index: 1 }]);
            expect(events).toEqual(["groups:added", "pane:none", "group:2"]);
            expect(focusedGroups).toEqual([group]);
        });

        it("focus: false — без фокуса", () => {
            const { service, focusedGroups } = setup();

            service.newGroup("before", { focus: false });

            expect(focusedGroups).toEqual([]);
            expect(service.viewColumnOf(service.activeGroup)).toBe(1);
        });

        it("нет места — отказ с записью в лог", () => {
            const { service, logs } = setup();
            service.canAddGroupHook = () => false;

            expect(service.newGroup("after")).toBeNull();
            expect(logs).toEqual(["new group refused — not enough space"]);
        });
    });

    describe("focusGroup", () => {
        it("по умолчанию фокусирует содержимое, focus: false — нет", () => {
            const { service, focusedGroups } = setup();
            service.newGroup("after", { focus: false });

            service.focusGroup({ index: 0 });
            expect(focusedGroups).toEqual([service.groups[0]]);

            service.focusGroup({ index: 1 }, { focus: false });
            expect(focusedGroups).toEqual([service.groups[0]]);
            expect(service.activeGroup).toBe(service.groups[1]);
        });

        it("уже активная группа — ни событий, ни конца серии Ctrl+Tab", () => {
            const { service, events } = setup();
            open(service.activeGroup, "a");
            events.length = 0;

            service.focusGroup({ index: 0 }, { focus: false });

            expect(events).toEqual([]);
        });

        it("фокус без хука view — в активную вкладку группы", () => {
            const { service } = setup();
            service.focusGroupContentHook = undefined;
            const pane = open(service.activeGroup, "a");
            service.newGroup("after", { focus: false });

            service.focusGroup({ index: 0 });

            expect(pane.focused).toBe(1);
        });
    });

    describe("moveActiveEditorToGroup", () => {
        it("пустая активная группа — no-op, соседка не заводится", () => {
            const { service, events } = setup();

            service.moveActiveEditorToGroup("next");

            expect(service.groups).toHaveLength(1);
            expect(events).toEqual([]);
        });

        it("у единственной группы заводит соседку (событие с источником) и переносит с фокусом", () => {
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

        it("ресурс уже в целевой группе — переносимая вкладка сливается: dispose и активация существующей", () => {
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

        it("без места для соседки — отказ с записью в лог", () => {
            const { service, logs } = setup();
            open(service.activeGroup, "a");
            service.canAddGroupHook = () => false;

            service.moveActiveEditorToGroup("previous");

            expect(service.groups).toHaveLength(1);
            expect(logs).toEqual(["new group refused — not enough space"]);
        });

        it("focus: false при переносе в новую соседку — фокус не едет", () => {
            const { service } = setup();
            const moved = open(service.activeGroup, "moved");

            service.moveActiveEditorToGroup("previous", { focus: false });

            expect(service.groups[0].getPanes()).toEqual([moved]);
            expect(moved.focused).toBe(0);
        });
    });

    describe("sideGroup", () => {
        it("заводит группу справа: событие с позицией и источником", () => {
            const { service, groupEvents } = setup();
            const source = service.activeGroup;

            const side = service.sideGroup();

            expect(groupEvents).toEqual([{ kind: "added", group: side, index: 1, source }]);
        });

        it("нет места — активная группа и запись в лог", () => {
            const { service, logs } = setup();
            service.canAddGroupHook = () => false;

            expect(service.sideGroup()).toBe(service.activeGroup);
            expect(logs).toEqual(["open beside refused — not enough space, opening in the active group"]);
        });
    });

    describe("слияние групп", () => {
        it("joinTwoGroups: дубликат ресурса закрывается, уникальное переезжает", () => {
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

        it("joinAllGroups у единственной группы — no-op без событий", () => {
            const { service, events } = setup();
            open(service.activeGroup, "a");
            events.length = 0;

            service.joinAllGroups();

            expect(events).toEqual([]);
        });

        it("joinAllGroups: активной остаётся вкладка бывшей активной группы, даже первая по счёту", () => {
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
        it("у края полосы — no-op с обеих сторон", () => {
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

        it("перестановка — событие moved с новой позицией", () => {
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

    describe("активная вкладка и схлопывание", () => {
        it("смена вкладки неактивной группы не меняет активную вкладку полосы", () => {
            const { service, events } = setup();
            const left = service.activeGroup;
            open(left, "a");
            open(left, "b");
            service.newGroup("after", { focus: false });
            events.length = 0;

            left.activateTab(0, { focus: false });

            expect(events).toEqual([]);
        });

        it("опустевшая неактивная группа схлопывается без смены активной", () => {
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

        it("опустевшая активная группа: соседка активна, получает фокус, события по порядку", () => {
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

        it("схлопнутая группа отписана: её события больше не доходят до полосы", () => {
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

    it("выключение сервиса закрывает группы вместе с их вкладками", () => {
        const { service } = setup();
        const pane = open(service.activeGroup, "a");
        service.newGroup("after", { focus: false });
        const other = open(service.activeGroup, "b");

        service.dispose();

        expect([pane.disposed, other.disposed]).toEqual([true, true]);
    });
});

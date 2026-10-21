import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { columnToEditorGroup, SIDE_GROUP } from "../common/editorGroupColumn.ts";
import { findGroup, peekGroup } from "../common/editorGroupFinder.ts";

import type { EditorGroup } from "./editorGroupModel.ts";
import { EditorGroupsService } from "./editorGroupsService.ts";

class FakePane implements IEditorPane {
    public readonly view = new TUIElement();
    public readonly isModified = false;
    public readonly readOnly = false;
    public readonly label: string;
    public readonly uri: Uri;

    public constructor(
        name: string,
        public readonly editorId?: string,
    ) {
        this.uri = Uri.from({ scheme: "fake", path: `/${name}` });
        this.label = name;
    }

    public onDidChangeState(): { dispose: () => void } {
        return { dispose: () => {} };
    }

    public focusEditor(): void {}

    public getSelectedTexts(): string[] {
        return [];
    }

    public dispose(): void {}
}

const AUTO_LOCK = { "workbench.editor.autoLockGroups": { default: false, terminalEditor: true } };

function setup(settings: Readonly<Record<string, unknown>> = AUTO_LOCK) {
    const service = new EditorGroupsService(NULL_LOG_SERVICE, new InMemoryConfigurationService(undefined, settings));
    const open = (group: EditorGroup, pane: IEditorPane): void => {
        service.openInGroup(group, () => {
            group.insertPane(pane);
            group.activateTab(group.editorCount - 1, { focus: false });
        });
    };
    return { service, open };
}

/** The Claude Code layout: a file on the left, a terminal tab in a new group beside it. */
function withTerminalBeside(settings?: Readonly<Record<string, unknown>>) {
    const h = setup(settings);
    const left = h.service.activeGroup;
    h.open(left, new FakePane("a.ts", "default"));
    const right = h.service.sideGroup();
    h.open(right, new FakePane("claude", "terminalEditor"));
    return { ...h, left, right };
}

describe("EditorGroupsService — auto-lock (`workbench.editor.autoLockGroups`)", () => {
    it("a terminal opened first in a new group locks it, as upstream `terminalEditor: true`", () => {
        const { right, left } = withTerminalBeside();
        expect(right.isLocked).toBe(true);
        expect(left.isLocked).toBe(false);
    });

    it("the only group is never auto-locked", () => {
        const { service, open } = setup();
        open(service.activeGroup, new FakePane("claude", "terminalEditor"));
        expect(service.activeGroup.isLocked).toBe(false);
    });

    it("only the first editor of a group locks it: a terminal joining a group with tabs does not", () => {
        const { service, open, left } = withTerminalBeside();
        open(left, new FakePane("second", "terminalEditor"));
        expect(left.isLocked).toBe(false);
        expect(service.groups).toHaveLength(2);
    });

    it("an editor id switched off in the setting does not lock; one switched on does", () => {
        expect(
            withTerminalBeside({ "workbench.editor.autoLockGroups": { terminalEditor: false } }).right.isLocked,
        ).toBe(false);
        const { service, open } = setup({ "workbench.editor.autoLockGroups": { default: true } });
        open(service.activeGroup, new FakePane("a.ts", "default"));
        const side = service.sideGroup();
        open(side, new FakePane("b.ts", "default"));
        expect(side.isLocked).toBe(true);
    });

    it("a pane without an editor id never locks", () => {
        const { service, open } = setup({ "workbench.editor.autoLockGroups": { undefined: true } });
        open(service.activeGroup, new FakePane("a.ts"));
        const side = service.sideGroup();
        open(side, new FakePane("b.ts"));
        expect(side.isLocked).toBe(false);
    });

    it("a lock change is announced once per change, with the group", () => {
        const { service } = setup();
        const seen: EditorGroup[] = [];
        service.onDidChangeGroupLocked((group) => seen.push(group));
        service.activeGroup.lock(true);
        service.activeGroup.lock(true);
        service.activeGroup.lock(false);
        expect(seen).toEqual([service.activeGroup, service.activeGroup]);
    });
});

describe("findGroup — locked groups (upstream `editorGroupFinder.ts`)", () => {
    it("with the locked terminal group active, a file goes to the most recently active unlocked group", () => {
        const { service, left, right } = withTerminalBeside();
        expect(service.activeGroup).toBe(right);
        expect(findGroup(service, Uri.from({ scheme: "fake", path: "/b.ts" }), undefined)).toBe(left);
    });

    it("among unlocked groups, the order is by last activation, not by strip position", () => {
        const { service, open, left, right } = withTerminalBeside();
        const third = service.addGroup(right, "after");
        expect(third).not.toBeNull();
        open(third!, new FakePane("c.ts", "default"));
        service.focusGroup(right.id, { focus: false });
        expect(service.getGroupsByMru()).toEqual([right, third, left]);
        expect(findGroup(service, undefined, undefined)).toBe(third);
    });

    it("a resource already open in the locked group is revealed there, not duplicated elsewhere", () => {
        const { service, right } = withTerminalBeside();
        expect(findGroup(service, Uri.from({ scheme: "fake", path: "/claude" }), undefined)).toBe(right);
    });

    it("when every group is locked, a new group opens right of the active one and stays inactive", () => {
        const { service, left, right } = withTerminalBeside();
        left.lock(true);
        service.focusGroup(left.id, { focus: false });
        const target = findGroup(service, undefined, undefined);
        expect(service.groups).toEqual([left, target, right]);
        expect(service.activeGroup).toBe(left);
        expect(peekGroup(service, undefined, undefined)).toBe(target);
    });

    it("beside the active group: a locked neighbor gets a new group in between", () => {
        const { service, left, right } = withTerminalBeside();
        service.focusGroup(left.id, { focus: false });
        expect(peekGroup(service, undefined, "beside")).toBeUndefined();
        const target = findGroup(service, undefined, "beside");
        expect(service.groups).toEqual([left, target, right]);
    });

    it("an explicit group is honored even when locked: that is a user gesture or a named column", () => {
        const { service, right } = withTerminalBeside();
        expect(findGroup(service, undefined, right)).toBe(right);
    });
});

describe("columnToEditorGroup — ViewColumn.Beside next to a locked group", () => {
    it("an unlocked neighbor is reused", () => {
        const { service, left } = withTerminalBeside({ "workbench.editor.autoLockGroups": { terminalEditor: false } });
        service.focusGroup(left.id, { focus: false });
        expect(columnToEditorGroup(service, SIDE_GROUP)).toBe(service.groups[1]);
        expect(service.groups).toHaveLength(2);
    });

    it("a locked neighbor gets a new group in between; the resource it holds still goes there", () => {
        const { service, left, right } = withTerminalBeside();
        service.focusGroup(left.id, { focus: false });
        expect(columnToEditorGroup(service, SIDE_GROUP, Uri.from({ scheme: "fake", path: "/claude" }))).toBe(right);

        const target = columnToEditorGroup(service, SIDE_GROUP);
        expect(service.groups).toEqual([left, target, right]);
    });
});

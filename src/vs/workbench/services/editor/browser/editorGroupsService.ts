import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { IEditorGroupsService, IGroupsChangeEvent } from "../common/editorGroupsService.ts";

import { EditorGroup, type GroupId, type MruCycleState } from "./editorGroupModel.ts";

/**
 * Headless counterpart of upstream `IEditorGroupsService` (upstream implements it in the view part, `EditorPart`).
 * Creates no tabs itself: `EditorService` opens the duplicate via a "fill the group" callback.
 * Event order is a contract: {@link onDidChangeEditors} → focus →
 * {@link onDidChangeActivePane} → {@link onDidActiveGroupChange}.
 */
export class EditorGroupsService extends Disposable implements IEditorGroupsService {
    public static dependencies = [ILogServiceDIToken, IConfigurationServiceDIToken] as const;

    /** ViewColumn − 1 order; without splits there is exactly one group. */
    private groupsList: EditorGroup[] = [];
    private activeGroupValue: EditorGroup;
    /** Upstream `mostRecentActiveGroups`; mru[0] is the active group. */
    private groupMru: EditorGroup[];
    /** Group ids are never reused. */
    private groupIdCounter = 0;
    private readonly groupSubscriptions = new Map<GroupId, IDisposable[]>();
    private readonly logger: ILogger;

    private readonly onDidActiveGroupChangeEmitter = new Emitter<EditorGroup>();
    private readonly onDidGroupsChangeEmitter = new Emitter<IGroupsChangeEvent>();
    private readonly onDidChangeMruCycleEmitter = new Emitter<MruCycleState | null>();
    private readonly onDidChangeEditorsEmitter = new Emitter<void>();
    private readonly onDidChangeActivePaneEmitter = new Emitter<IEditorPane | null>();
    private readonly onDidChangeGroupLockedEmitter = new Emitter<EditorGroup>();

    /** `EditorPartComponent` asks its `EditorPartElement.canFit`; unset (headless) — space is not checked. */
    public canAddGroupHook?: () => boolean;

    /** Needed for the empty group's filler, which the service cannot reach. Unset — focus goes to the active tab. */
    public focusGroupContentHook?: (group: EditorGroup) => void;

    public readonly onDidActiveGroupChange = this.onDidActiveGroupChangeEmitter.event;

    /** Snapshot of the frozen MRU list at each step of a Ctrl+Tab series, and `null` when the series ends. */
    public readonly onDidChangeMruCycle = this.onDidChangeMruCycleEmitter.event;

    public readonly onDidGroupsChange = this.onDidGroupsChangeEmitter.event;

    public readonly onDidChangeEditors = this.onDidChangeEditorsEmitter.event;

    /** Upstream `GroupModelChangeKind.GROUP_LOCKED`: the `activeEditorGroupLocked` key and the title's unlock button. */
    public readonly onDidChangeGroupLocked = this.onDidChangeGroupLockedEmitter.event;

    /** Any kind — `EditorService` narrows it to text. */
    public readonly onDidChangeActivePane = this.onDidChangeActivePaneEmitter.event;

    public constructor(
        logService: ILogService,
        private readonly configurationService: Pick<IConfigurationService, "get">,
    ) {
        super();
        // Stryker disable next-line StringLiteral,ObjectLiteral: the channel name and label are captions in the Output selector and do not affect logging behavior
        this.logger = logService.createLogger("workbench.editorGroups", { label: "Editor Groups" });
        this.activeGroupValue = this.createGroup();
        this.groupMru = [this.activeGroupValue];
        this.register({
            dispose: () => {
                for (const subscriptions of this.groupSubscriptions.values()) {
                    for (const subscription of subscriptions) subscription.dispose();
                }
                // Nobody reads the map after shutdown — clearing only releases references.
                // Stryker disable next-line CallExpression: equivalent — see above
                this.groupSubscriptions.clear();
            },
        });
    }

    public get groups(): readonly EditorGroup[] {
        return this.groupsList;
    }

    public get activeGroup(): EditorGroup {
        return this.activeGroupValue;
    }

    /** `null` for detached panes too: they have no group. */
    public groupOf(pane: IEditorPane): EditorGroup | null {
        for (const group of this.groupsList) {
            if (group.getPanes().includes(pane)) return group;
        }
        return null;
    }

    public viewColumnOf(group: EditorGroup): number {
        return this.groupsList.indexOf(group) + 1;
    }

    /**
     * VS Code `workbench.action.splitEditor`. Refusal (empty active group or no space) is silent,
     * with a log entry (spec decision #3). The new group is active BEFORE it is filled: the tab opened
     * in it immediately becomes the workbench's active editor.
     */
    public splitActiveGroup(
        fill: (group: EditorGroup, source: IEditorPane) => void,
        // Any position other than "before" means right: an empty string behaves like "after".
        // Stryker disable next-line StringLiteral: equivalent — see above
        { focus = true, position = "after" }: { focus?: boolean; position?: "before" | "after" } = {},
    ): EditorGroup | null {
        const source = this.activeGroupValue;
        const sourcePane = source.activePane;
        if (sourcePane === null) return null;
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("split refused — not enough space");
            return null;
        }

        const anchor = this.groupsList.indexOf(source);
        const index = position === "before" ? anchor : anchor + 1;
        const group = this.createGroup(index);
        this.fireGroupsChanged({ kind: "added", group, index, source });

        this.setActiveGroup(group);
        fill(group, sourcePane);
        if (group.editorCount === 0) {
            this.fireActivePaneChanged(null);
            if (focus) this.focusGroupContent(group);
        }
        this.fireActiveGroupChanged(group);
        return group;
    }

    public newGroup(position: "before" | "after", { focus = true }: { focus?: boolean } = {}): EditorGroup | null {
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("new group refused — not enough space");
            return null;
        }
        const anchor = this.groupsList.indexOf(this.activeGroupValue);
        const index = position === "before" ? anchor : anchor + 1;
        const group = this.createGroup(index);
        this.fireGroupsChanged({ kind: "added", group, index });
        this.setActiveGroup(group);
        this.fireActivePaneChanged(null);
        if (focus) this.focusGroupContent(group);
        this.fireActiveGroupChanged(group);
        return group;
    }

    /** Past the edge of the strip — no-op (US-10). */
    public focusGroup(
        target: GroupId | { index: number } | { direction: "next" | "previous" | "cycle" },
        { focus = true }: { focus?: boolean } = {},
    ): void {
        const group = this.resolveGroupTarget(target);
        if (group === null) return;
        this.makeGroupActive(group);
        if (focus) this.focusGroupContent(group);
    }

    private resolveGroupTarget(
        target: GroupId | { index: number } | { direction: "next" | "previous" | "cycle" },
    ): EditorGroup | null {
        if (typeof target === "number") {
            return this.groupsList.find((group) => group.id === target) ?? null;
        }
        if ("index" in target) {
            return this.groupsList[target.index] ?? null;
        }
        const current = this.groupsList.indexOf(this.activeGroupValue);
        if (target.direction === "cycle") {
            return this.groupsList[(current + 1) % this.groupsList.length];
        }
        const next = target.direction === "next" ? current + 1 : current - 1;
        return this.groupsList[next] ?? null;
    }

    /** Focus is already where the click landed — only events. */
    public notifyGroupFocused(group: EditorGroup): void {
        // makeGroupActive has the same guard: the early return only saves a call.
        // Stryker disable next-line ConditionalExpression: equivalent — see above
        if (group === this.activeGroupValue) return;
        this.makeGroupActive(group);
    }

    /** With a single group, creates a neighbor (US-50). If the resource is already open in the target, merges with it. */
    public moveActiveEditorToGroup(direction: "next" | "previous", { focus = true }: { focus?: boolean } = {}): void {
        const source = this.activeGroupValue;
        const index = source.activeIndex;
        if (source.activePane === null) return;
        const target = this.neighborOrNewGroup(direction);
        if (target === null) return;

        // detachPane may collapse the emptied source — the target group is captured by reference beforehand.
        const pane = source.detachPane(index);
        /* v8 ignore start -- activePane is checked above, the index is valid */
        // Stryker disable next-line ConditionalExpression: unreachable branch for the same reason
        if (pane === null) return;
        /* v8 ignore stop */
        this.setActiveGroup(target);
        const existing = target.findPaneIndex(pane.uri);
        if (existing >= 0) {
            pane.dispose();
            target.activateTab(existing, { focus });
        } else {
            target.insertPane(pane);
            target.activateTab(target.editorCount - 1, { focus });
        }
        this.fireActiveGroupChanged(target);
    }

    public openInNeighborGroup(direction: "next" | "previous", fill: (group: EditorGroup) => void): void {
        const target = this.neighborOrNewGroup(direction);
        if (target === null) return;
        this.openInGroup(target, () => {
            fill(target);
        });
    }

    /**
     * The group is active BEFORE `fill` — the opened tab immediately becomes the workbench's active editor. Does not
     * end the previous group's Ctrl+Tab series: this is opening, not focus leaving.
     */
    public openInGroup<T>(group: EditorGroup, fill: () => T): T {
        const wasActive = group === this.activeGroupValue;
        this.setActiveGroup(group);
        const result = fill();
        if (!wasActive) this.fireActiveGroupChanged(group);
        return result;
    }

    /** Upstream `getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)`: a group never activated goes last, in strip order. */
    public getGroupsByMru(): EditorGroup[] {
        return [...this.groupMru, ...this.groupsList.filter((group) => !this.groupMru.includes(group))];
    }

    /**
     * Upstream `addGroup(location, direction)` for the group finder: the new group does not become active,
     * opening decides that. `null` when it does not fit.
     */
    public addGroup(location: EditorGroup, position: "before" | "after"): EditorGroup | null {
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("new group refused — not enough space");
            return null;
        }
        const anchor = this.groupsList.indexOf(location);
        const index = position === "before" ? anchor : anchor + 1;
        const group = this.createGroup(index);
        this.fireGroupsChanged({ kind: "added", group, index, source: location });
        return group;
    }

    /** No space — falls back to the active group. Does not become active: opening decides that. */
    public sideGroup(): EditorGroup {
        const index = this.groupsList.indexOf(this.activeGroupValue);
        const next = this.groupsList.at(index + 1);
        if (next !== undefined) return next;
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("open beside refused — not enough space, opening in the active group");
            return this.activeGroupValue;
        }
        const group = this.createGroup(index + 1);
        this.fireGroupsChanged({ kind: "added", group, index: index + 1, source: this.activeGroupValue });
        return group;
    }

    /** VS Code `joinTwoGroups`: resource duplicates collapse (spec decision #5). */
    public joinTwoGroups(): void {
        const target = this.activeGroupValue;
        const source = this.resolveGroupTarget({ direction: "next" });
        // A directional neighbor is never the active group: the second condition is a safety net.
        // Stryker disable next-line ConditionalExpression: equivalent — see above
        if (source === null || source === target) return;
        this.mergeGroupInto(source, target);
    }

    /** The active tab of the formerly active group survives (US-21). */
    public joinAllGroups(): void {
        if (this.groupsList.length < 2) return;
        const rememberedUri = this.activeGroupValue.activePane?.uri ?? null;
        const target = this.groupsList[0];
        this.setActiveGroup(target);
        while (this.groupsList.length > 1) {
            this.mergeGroupInto(this.groupsList[1], target);
        }
        if (rememberedUri !== null) {
            const index = target.findPaneIndex(rememberedUri);
            /* v8 ignore start -- uri comes from a live tab, merge with dedup keeps the resource in target */
            // Stryker disable next-line ConditionalExpression: the resource is always in target for the same reason
            if (index >= 0) target.activateTab(index);
            /* v8 ignore stop */
        }
        this.fireActiveGroupChanged(target);
    }

    public moveActiveGroup(direction: "next" | "previous"): void {
        const from = this.groupsList.indexOf(this.activeGroupValue);
        const to = direction === "next" ? from + 1 : from - 1;
        if (to < 0 || to >= this.groupsList.length) return;
        const [group] = this.groupsList.splice(from, 1);
        this.groupsList.splice(to, 0, group);
        this.fireGroupsChanged({ kind: "moved", group, index: to });
    }

    /**
     * There is no global MRU stack — it lives on the group; concatenating from the active group along the strip gives
     * what the picker title promises: on top is where the user just was.
     */
    public getOpenEditorsMru(): IEditorPane[] {
        const active = this.activeGroupValue;
        const strip = [active, ...this.groupsList.filter((group) => group !== active)];
        return strip.flatMap((group) => group.getMruPanes());
    }

    public revealPane(pane: IEditorPane): void {
        const group = this.groupOf(pane);
        if (group === null) return;
        this.makeGroupActive(group);
        group.activateTab(group.getPanes().indexOf(pane));
    }

    /**
     * VS Code `nextEditor`/`previousEditor`: visual order of all groups, wrapping around. Unlike
     * Ctrl+Tab there is no hold session — each step commits to MRU immediately.
     */
    public cycleEditor(direction: 1 | -1): void {
        const entries: { group: EditorGroup; index: number }[] = [];
        for (const group of this.groupsList) {
            for (let index = 0; index < group.editorCount; index++) entries.push({ group, index });
        }
        if (entries.length < 2) return;

        const active = this.activeGroupValue;
        const current = entries.findIndex((entry) => entry.group === active && entry.index === active.activeIndex);
        const base = current >= 0 ? current + direction : direction === 1 ? 0 : -1;
        const target = entries[((base % entries.length) + entries.length) % entries.length];

        if (target.group === active) {
            active.activateTab(target.index);
            return;
        }
        // Across a group boundary: group first, then tab (like moveActiveTabToGroup);
        // the source's Ctrl+Tab series ends as on any departure from the group.
        active.endMruCycle();
        this.setActiveGroup(target.group);
        target.group.activateTab(target.index);
        this.fireActiveGroupChanged(target.group);
    }

    private mergeGroupInto(source: EditorGroup, target: EditorGroup): void {
        if (source.editorCount === 0) {
            // Empty neighbor: no event will collapse it — remove it explicitly.
            this.collapseGroup(source);
            return;
        }
        // The loop bound and the guard below back each other up: `>= 0` would hit
        // `null` from the empty group and exit via the same break, and with `> 0` the guard is unreachable.
        // Stryker disable next-line EqualityOperator: equivalent — see above
        while (source.editorCount > 0) {
            const pane = source.detachPane(0);
            /* v8 ignore start -- editorCount > 0 guarantees a tab */
            // Stryker disable next-line ConditionalExpression: equivalent — see above
            if (pane === null) break;
            /* v8 ignore stop */
            if (target.findPaneIndex(pane.uri) >= 0) pane.dispose();
            else target.insertPane(pane);
        }
    }

    private neighborOrNewGroup(direction: "next" | "previous"): EditorGroup | null {
        const existing = this.resolveGroupTarget({ direction });
        // A directional neighbor is never the active group: the second condition is a safety net.
        // Stryker disable next-line ConditionalExpression: equivalent — see above
        if (existing !== null && existing !== this.activeGroupValue) return existing;
        if (this.groupsList.length > 1) return null;
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("new group refused — not enough space");
            return null;
        }
        const index = direction === "next" ? 1 : 0;
        const group = this.createGroup(index);
        this.fireGroupsChanged({ kind: "added", group, index, source: this.activeGroupValue });
        return group;
    }

    private setActiveGroup(group: EditorGroup): void {
        this.activeGroupValue = group;
        const index = this.groupMru.indexOf(group);
        if (index >= 0) this.groupMru.splice(index, 1);
        this.groupMru.unshift(group);
    }

    /**
     * Upstream `EditorGroupView.openEditor`: a new editor that is the first in its group, with more than one
     * group open, locks the group when its id is enabled in `workbench.editor.autoLockGroups`.
     */
    private autoLockGroup(group: EditorGroup, pane: IEditorPane): void {
        if (group.editorCount !== 1 || this.groupsList.length < 2 || pane.editorId === undefined) return;
        // Upstream `isObject` guard: a broken value (or no schema registered) means "lock nothing".
        const enabled: unknown = this.configurationService.get("workbench.editor.autoLockGroups");
        if (typeof enabled !== "object" || enabled === null) return;
        if ((enabled as Readonly<Record<string, unknown>>)[pane.editorId] === true) group.lock(true);
    }

    private makeGroupActive(group: EditorGroup): void {
        if (group === this.activeGroupValue) return;
        // Focus moving to another group ends the previous group's Ctrl+Tab series: the choice is committed to MRU.
        this.activeGroupValue.endMruCycle();
        this.setActiveGroup(group);
        // Tabs do not change, but active-editor consumers (status bar, host) must follow.
        this.fireActivePaneChanged(group.activePane);
        this.fireActiveGroupChanged(group);
    }

    private focusGroupContent(group: EditorGroup): void {
        if (this.focusGroupContentHook !== undefined) this.focusGroupContentHook(group);
        else group.focusEditor();
    }

    /** The view (`EditorGroupComponent`) listens to the group itself, active-editor consumers to the service. */
    private createGroup(index: number = this.groupsList.length): EditorGroup {
        const group = new EditorGroup(++this.groupIdCounter);
        this.groupsList.splice(index, 0, group);
        const subscriptions: IDisposable[] = [
            group,
            group.onDidChangeEditors(() => {
                this.onDidChangeEditorsEmitter.fire();
            }),
            group.onDidChangeActivePane((pane) => {
                // A tab change in an inactive group does not touch the active editor (US-13).
                if (group === this.activeGroupValue) this.fireActivePaneChanged(pane);
                // There is no active tab exactly when the group is empty: the conditions are interchangeable.
                // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent — see above
                if (pane === null && group.editorCount === 0 && this.groupsList.length > 1) {
                    this.collapseGroup(group);
                }
            }),
            group.onDidChangeMruCycle((state) => {
                this.onDidChangeMruCycleEmitter.fire(state);
            }),
            group.onDidInsertPane((pane) => {
                this.autoLockGroup(group, pane);
            }),
            group.onDidChangeLocked(() => {
                this.onDidChangeGroupLockedEmitter.fire(group);
            }),
        ];
        this.groupSubscriptions.set(group.id, subscriptions);
        return group;
    }

    /** The last group is not collapsed — an empty editor area is legal (US-47). */
    private collapseGroup(group: EditorGroup): void {
        const index = this.groupsList.indexOf(group);
        /* v8 ignore start -- defensive guard: collapse is called only for a group in the strip */
        // Stryker disable next-line ConditionalExpression: unreachable branch for the same reason
        if (index < 0) return;
        /* v8 ignore stop */
        this.groupsList.splice(index, 1);
        this.groupMru = this.groupMru.filter((candidate) => candidate !== group);
        /* v8 ignore start -- createGroup sets up subscriptions for every group, the ?? [] fallback is unreachable */
        // Stryker disable next-line ArrayDeclaration: unreachable fallback for the same reason
        for (const subscription of this.groupSubscriptions.get(group.id) ?? []) subscription.dispose();
        /* v8 ignore stop */
        // Subscriptions are already disposed: a leftover entry would be disposed again on shutdown — a no-op.
        // Stryker disable next-line CallExpression: equivalent — see above
        this.groupSubscriptions.delete(group.id);
        const wasActive = group === this.activeGroupValue;
        this.fireGroupsChanged({ kind: "removed", group, index });
        if (wasActive) {
            const neighbor = this.groupsList[Math.max(0, index - 1)];
            this.setActiveGroup(neighbor);
            this.fireActivePaneChanged(neighbor.activePane);
            this.fireActiveGroupChanged(neighbor);
            this.focusGroupContent(neighbor);
        }
    }

    private fireActivePaneChanged(pane: IEditorPane | null): void {
        this.onDidChangeActivePaneEmitter.fire(pane);
    }

    private fireActiveGroupChanged(group: EditorGroup): void {
        this.onDidActiveGroupChangeEmitter.fire(group);
    }

    private fireGroupsChanged(event: IGroupsChangeEvent): void {
        this.onDidGroupsChangeEmitter.fire(event);
    }
}

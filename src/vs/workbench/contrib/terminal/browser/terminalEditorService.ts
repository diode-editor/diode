import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { EditorGroup } from "../../../services/editor/browser/editorGroupModel.ts";
import { ACTIVE_GROUP, columnToEditorGroup, SIDE_GROUP } from "../../../services/editor/common/editorGroupColumn.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import type { TerminalColorsService } from "./terminalColorsService.ts";
import { TerminalColorsServiceDIToken } from "./terminalColorsService.ts";
import { TerminalEditorPane } from "./terminalEditorPane.ts";
import type { ITerminalCreateOptions, ITerminalInstance, TerminalService } from "./terminalService.ts";
import { TerminalServiceDIToken } from "./terminalService.ts";

/** No column — the active group; `preserveFocus` — without taking focus or changing the active group. */
export interface ITerminalEditorLocation {
    readonly viewColumn?: number;
    readonly group?: EditorGroup;
    readonly preserveFocus?: boolean;
}

/**
 * Tab and instance lifetimes are bound both ways: closing the tab kills the process
 * (`user`), removing the instance closes the tab. Moving between the panel and the
 * editor area doesn't touch the process. A tab that becomes the active editor becomes the
 * editor host's active terminal, as upstream: `window.activeTerminal` is whichever host
 * activated one last ({@link TerminalService.getActiveInstanceAcrossHosts}).
 */
export class TerminalEditorService extends Disposable implements IContextKeyContributor {
    public static dependencies = [TerminalServiceDIToken, EditorServiceDIToken, TerminalColorsServiceDIToken] as const;

    private readonly panes = new Map<number, TerminalEditorPane>();

    public constructor(
        private readonly terminals: TerminalService,
        private readonly editors: IEditorService,
        private readonly colors: TerminalColorsService,
    ) {
        super();
        this.register(
            terminals.onDidDisposeInstance((instance) => {
                const pane = this.panes.get(instance.id);
                if (pane !== undefined) this.closePane(pane);
            }),
        );
        this.register(
            terminals.onDidChangeInstanceTitle((instance) => {
                this.panes.get(instance.id)?.refreshLabel();
            }),
        );
        this.register(
            editors.editorGroups.onDidChangeActivePane((pane) => {
                if (pane instanceof TerminalEditorPane) terminals.setActiveEditorInstance(pane.instance.id);
            }),
        );
        this.register(
            colors.onDidChange((next) => {
                for (const pane of this.panes.values()) pane.setColors(next);
            }),
        );
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        const focusPath = active?.getAncestorPath();
        contextKeys.set(
            "terminalEditorFocus",
            [...this.panes.values()].some((pane) => focusPath?.includes(pane.view) === true),
        );
        contextKeys.set("terminalEditorActive", this.editors.getActiveTabPane() instanceof TerminalEditorPane);
    }

    /** `undefined` — the instance is not in the editor area or is in the background. */
    public paneOf(instanceId: number): TerminalEditorPane | undefined {
        return this.panes.get(instanceId);
    }

    /** A background (`hideFromUser`) instance gets a tab on {@link reveal}. */
    public createTerminal(
        options: Omit<ITerminalCreateOptions, "target"> = {},
        location: ITerminalEditorLocation = {},
    ): ITerminalInstance {
        const instance = this.terminals.createInstance({ ...options, target: "editor" });
        if (options.hideFromUser !== true) this.openEditor(instance, location);
        return instance;
    }

    /** The parent's group becomes active; the new one goes into the group to the right. */
    public splitInstance(parentId: number, options: Omit<ITerminalCreateOptions, "target"> = {}): ITerminalInstance {
        const parent = this.panes.get(parentId);
        // Stryker disable next-line ConditionalExpression: equivalent — groupOf for a pane in no group is null anyway
        const group = parent === undefined ? null : this.editors.editorGroups.groupOf(parent);
        // The new tab takes focus right after — only the active group matters here.
        // Stryker disable next-line ObjectLiteral,BooleanLiteral: equivalent — the new right tab takes focus at once
        if (group !== null) this.editors.editorGroups.focusGroup(group.id, { focus: false });
        return this.createTerminal(options, { viewColumn: SIDE_GROUP });
    }

    /** No tab (a background instance was just shown) — open in the active group. */
    public reveal(instanceId: number, preserveFocus: boolean): void {
        const pane = this.panes.get(instanceId);
        if (pane === undefined) {
            const instance = this.terminals.getInstance(instanceId);
            if (instance?.target === "editor") this.openEditor(instance, { preserveFocus });
            return;
        }
        if (!preserveFocus) {
            this.editors.editorGroups.revealPane(pane);
            return;
        }
        // A tab from `panes` is always in a group: a closed one leaves `panes` earlier.
        const group = this.editors.editorGroups.groupOf(pane);
        // Stryker disable next-line OptionalChaining: unreachable — see above
        group?.activateTab(group.getPanes().indexOf(pane), { focus: false });
    }

    public moveToEditor(instanceId: number, location: ITerminalEditorLocation = {}): void {
        const instance = this.terminals.moveToEditor(instanceId);
        if (instance !== undefined) this.openEditor(instance, location);
    }

    public moveToPanel(instanceId: number): void {
        const pane = this.panes.get(instanceId);
        if (pane === undefined) return;
        this.closePane(pane);
        this.terminals.moveToPanel(instanceId);
    }

    /** With `preserveFocus` the active group stays the same, like `showTextDocument`. */
    private openEditor(instance: ITerminalInstance, location: ITerminalEditorLocation): void {
        const groups = this.editors.editorGroups;
        const previous = groups.activeGroup;
        const group = location.group ?? columnToEditorGroup(groups, location.viewColumn ?? ACTIVE_GROUP);
        const focus = location.preserveFocus !== true;
        const pane = new TerminalEditorPane(instance, this.colors.colors);
        this.panes.set(instance.id, pane);
        // `closePane` removes the tab from `panes` — on the instance removal that
        // the close itself triggers.
        pane.onDidClose(() => {
            this.terminals.closeInstance(instance.id, "user");
        });
        groups.focusGroup(group.id, { focus: false });
        this.editors.openPane(pane, { focus, group });
        if (!focus) groups.focusGroup(previous.id, { focus: false });
    }

    /** Removes the tab without touching the process: it is already gone or moving. */
    private closePane(pane: TerminalEditorPane): void {
        this.panes.delete(pane.instance.id);
        pane.detach();
        // A tab from `panes` is always in a group (see `reveal`).
        const group = this.editors.editorGroups.groupOf(pane);
        // Stryker disable next-line ConditionalExpression: unreachable — a tab from `panes` is always in a group
        if (group !== null) void this.editors.closeEditor(group, pane);
    }
}

export const TerminalEditorServiceDIToken = token<TerminalEditorService>("TerminalEditorService");

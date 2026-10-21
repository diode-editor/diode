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

/** Без колонки — активная группа; `preserveFocus` — не забирая фокус и не меняя активную группу. */
export interface ITerminalEditorLocation {
    readonly viewColumn?: number;
    readonly group?: EditorGroup;
    readonly preserveFocus?: boolean;
}

/**
 * Жизни вкладки и инстанса связаны в обе стороны: закрыли вкладку — процесс
 * убит (`user`), инстанс снят — вкладка закрыта. Перенос между панелью и
 * областью редакторов процесс не трогает. Активным терминалом сервиса
 * (`window.activeTerminal`) вкладка не становится — отступление,
 * docs/arch/Extensions.md.
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

    /** `undefined` — инстанс не в области редакторов либо фоновый. */
    public paneOf(instanceId: number): TerminalEditorPane | undefined {
        return this.panes.get(instanceId);
    }

    /** Фоновый (`hideFromUser`) вкладку получит по {@link reveal}. */
    public createTerminal(
        options: Omit<ITerminalCreateOptions, "target"> = {},
        location: ITerminalEditorLocation = {},
    ): ITerminalInstance {
        const instance = this.terminals.createInstance({ ...options, target: "editor" });
        if (options.hideFromUser !== true) this.openEditor(instance, location);
        return instance;
    }

    /** Группа родителя становится активной, новый встаёт в группу справа. */
    public splitInstance(parentId: number, options: Omit<ITerminalCreateOptions, "target"> = {}): ITerminalInstance {
        const parent = this.panes.get(parentId);
        // Stryker disable next-line ConditionalExpression: эквивалентный — groupOf панели, которой нет ни в одной группе, и так null
        const group = parent === undefined ? null : this.editors.editorGroups.groupOf(parent);
        // Фокус следом забирает новая вкладка — здесь важна только активная группа.
        // Stryker disable next-line ObjectLiteral,BooleanLiteral: эквивалентный — фокус группы родителя сразу уходит в новую вкладку справа
        if (group !== null) this.editors.editorGroups.focusGroup(group.id, { focus: false });
        return this.createTerminal(options, { viewColumn: SIDE_GROUP });
    }

    /** Нет вкладки (фоновый только что показан) — открыть в активной группе. */
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
        // Вкладка из `panes` всегда стоит в группе: закрытая уходит из `panes` раньше.
        const group = this.editors.editorGroups.groupOf(pane);
        // Stryker disable next-line OptionalChaining: недостижимо — см. выше
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

    /** С `preserveFocus` активная группа остаётся прежней, как у `showTextDocument`. */
    private openEditor(instance: ITerminalInstance, location: ITerminalEditorLocation): void {
        const groups = this.editors.editorGroups;
        const previous = groups.activeGroup;
        const group = location.group ?? columnToEditorGroup(groups, location.viewColumn ?? ACTIVE_GROUP);
        const focus = location.preserveFocus !== true;
        const pane = new TerminalEditorPane(instance, this.colors.colors);
        this.panes.set(instance.id, pane);
        // Из `panes` вкладку снимает `closePane` — по снятию инстанса, которое
        // закрытие и вызывает.
        pane.onDidClose(() => {
            this.terminals.closeInstance(instance.id, "user");
        });
        groups.focusGroup(group.id, { focus: false });
        this.editors.openPane(pane, { focus, group });
        if (!focus) groups.focusGroup(previous.id, { focus: false });
    }

    /** Снять вкладку, не трогая процесс: он уже снят либо переезжает. */
    private closePane(pane: TerminalEditorPane): void {
        this.panes.delete(pane.instance.id);
        pane.detach();
        // Вкладка из `panes` всегда стоит в группе (см. `reveal`).
        const group = this.editors.editorGroups.groupOf(pane);
        // Stryker disable next-line ConditionalExpression: недостижимо — вкладка из `panes` всегда в группе
        if (group !== null) void this.editors.closeEditor(group, pane);
    }
}

export const TerminalEditorServiceDIToken = token<TerminalEditorService>("TerminalEditorService");

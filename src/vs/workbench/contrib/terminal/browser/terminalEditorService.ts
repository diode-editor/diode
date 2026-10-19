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
import { holdsFocus } from "./terminalPanelComponent.ts";
import type { ITerminalCreateOptions, ITerminalInstance, TerminalService } from "./terminalService.ts";
import { TerminalServiceDIToken } from "./terminalService.ts";

/**
 * Куда открыть вкладку-терминал (`TerminalEditorLocation` эталона): колонка
 * `vscode.ViewColumn` (по умолчанию — активная группа) либо готовая группа
 * (повтор вкладки по рецепту); `preserveFocus` — открыть, не забирая фокус и
 * не меняя активную группу.
 */
export interface ITerminalEditorLocation {
    readonly viewColumn?: number;
    readonly group?: EditorGroup;
    readonly preserveFocus?: boolean;
}

/**
 * Терминалы в области редакторов (`TerminalEditorService` эталона): заводит
 * инстанс `target: "editor"` в {@link TerminalService} и держит его вкладку
 * {@link TerminalEditorPane}. Жизни связаны в обе стороны: закрыли вкладку —
 * процесс убит (`user`), инстанс снят (выход процесса, `dispose()`
 * расширения) — вкладка закрыта. Перенос между панелью и областью
 * редакторов процесс не трогает.
 *
 * Вкладку-терминал по id инстанса находит {@link paneOf}; активным
 * терминалом сервиса (`window.activeTerminal`) она не становится — см.
 * отступления в docs/arch/Extensions.md.
 */
export class TerminalEditorService extends Disposable implements IContextKeyContributor {
    public static dependencies = [TerminalServiceDIToken, EditorServiceDIToken, TerminalColorsServiceDIToken] as const;

    /** Открытые вкладки по id инстанса. */
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

    /** IContextKeyContributor: `terminalEditorFocus`, `terminalEditorActive`. */
    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set(
            "terminalEditorFocus",
            active !== null && [...this.panes.values()].some((pane) => holdsFocus(pane.view)),
        );
        contextKeys.set("terminalEditorActive", this.editors.getActiveTabPane() instanceof TerminalEditorPane);
    }

    /** Вкладка инстанса или `undefined` (инстанс не в области редакторов либо фоновый). */
    public paneOf(instanceId: number): TerminalEditorPane | undefined {
        return this.panes.get(instanceId);
    }

    /**
     * Новый терминал вкладкой (`createTerminal` с `TerminalLocation.Editor`
     * эталона). Фоновый (`hideFromUser`) вкладку получит по {@link reveal}.
     */
    public createTerminal(
        options: Omit<ITerminalCreateOptions, "target"> = {},
        location: ITerminalEditorLocation = {},
    ): ITerminalInstance {
        const instance = this.terminals.createInstance({ ...options, target: "editor" });
        if (options.hideFromUser !== true) this.openEditor(instance, location);
        return instance;
    }

    /**
     * Терминал рядом с редакторным родителем (`splitInstance` эталона):
     * группа родителя становится активной, новый встаёт в группу справа.
     */
    public splitInstance(parentId: number, options: Omit<ITerminalCreateOptions, "target"> = {}): ITerminalInstance {
        const parent = this.panes.get(parentId);
        const group = parent === undefined ? null : this.editors.editorGroups.groupOf(parent);
        if (group !== null) this.editors.editorGroups.focusGroup(group.id, { focus: false });
        return this.createTerminal(options, { viewColumn: SIDE_GROUP });
    }

    /**
     * Показать вкладку инстанса (`revealActiveEditor` эталона): открытую —
     * активировать в её группе, нет вкладки (фоновый только что показан) —
     * открыть в активной группе.
     */
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
        const group = this.editors.editorGroups.groupOf(pane);
        group?.activateTab(group.getPanes().indexOf(pane), { focus: false });
    }

    /** Перенести панельный инстанс вкладкой в область редакторов (`moveToEditor` эталона). */
    public moveToEditor(instanceId: number, location: ITerminalEditorLocation = {}): void {
        const instance = this.terminals.moveToEditor(instanceId);
        if (instance !== undefined) this.openEditor(instance, location);
    }

    /** Вернуть вкладку-терминал в вид TERMINAL (`moveToTerminalView` эталона). */
    public moveToPanel(instanceId: number): void {
        const pane = this.panes.get(instanceId);
        if (pane === undefined) return;
        this.closePane(pane);
        this.terminals.moveToPanel(instanceId);
    }

    /**
     * Вкладка инстанса в группе колонки: фокус — в неё, если не
     * `preserveFocus` (тогда активная группа остаётся прежней, как у
     * `showTextDocument`). Уже открытая — показывается.
     */
    private openEditor(instance: ITerminalInstance, location: ITerminalEditorLocation): void {
        if (this.panes.has(instance.id)) {
            this.reveal(instance.id, location.preserveFocus === true);
            return;
        }
        const groups = this.editors.editorGroups;
        const previous = groups.activeGroup;
        const group = location.group ?? columnToEditorGroup(groups, location.viewColumn ?? ACTIVE_GROUP);
        const focus = location.preserveFocus !== true;
        const pane = new TerminalEditorPane(instance, this.colors.colors);
        this.panes.set(instance.id, pane);
        pane.onDidClose(() => {
            this.panes.delete(instance.id);
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
        const group = this.editors.editorGroups.groupOf(pane);
        if (group === null) {
            pane.dispose();
            return;
        }
        void this.editors.closeEditor(group, pane);
    }
}

export const TerminalEditorServiceDIToken = token<TerminalEditorService>("TerminalEditorService");

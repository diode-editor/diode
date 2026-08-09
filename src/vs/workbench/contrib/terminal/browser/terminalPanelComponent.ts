import { Disposable } from "../../../../../../tuidom/common/disposable.ts";
import { TerminalViewElement } from "../../../../../../tuidom/ui/terminal/terminalViewElement.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";

import type { ITerminalInstance, TerminalService } from "./terminalService.ts";
import { TERMINAL_VIEW_ID, TerminalServiceDIToken } from "./terminalService.ts";

/**
 * Минимальный срез редакторов, нужный терминалу: куда вернуть фокус, когда
 * виджет терминала уходит со сцены (шелл вышел, а других терминалов нет).
 * `EditorService` соответствует ему структурно — связывание делает DI-модуль
 * ({@link TerminalFocusFallbackDIToken}).
 */
export interface ITerminalFocusFallback {
    focusEditor(): void;
}

export const TerminalFocusFallbackDIToken = token<ITerminalFocusFallback>("TerminalFocusFallback");
export const TerminalPanelComponentDIToken = token<TerminalPanelComponent>("TerminalPanelComponent");

/**
 * View-владелец встроенного терминала: по каждому инстансу {@link TerminalService}
 * строит `TerminalViewElement`, вкидывает виджет активного инстанса в
 * TERMINAL-вкладку (через {@link ViewsService.setViewBody}) и красит виджеты
 * темой (`getTerminalViewStyles`).
 *
 * Не наследник `Component`: собственного корневого контрола нет — UI компонента
 * это НЕСКОЛЬКО виджетов, попадающих в панель по одному через ViewsService.
 * ВАЖНО: у TUIElement нет unmount-хуков, поэтому компонент обязан сам
 * dispose'ить виджеты — при закрытии инстанса и при своём dispose().
 */
export class TerminalPanelComponent extends Disposable {
    public static dependencies = [TerminalServiceDIToken, ViewsServiceDIToken, TerminalFocusFallbackDIToken] as const;

    private widgets = new Map<number, TerminalViewElement>();
    private activeWidget: TerminalViewElement | null = null;

    public constructor(
        terminalService: TerminalService,
        private readonly viewsService: ViewsService,
        private readonly focusFallback: ITerminalFocusFallback,
    ) {
        super();
        this.register(
            terminalService.onDidOpenInstance((instance) => {
                this.handleOpen(instance);
            }),
        );
        this.register(
            terminalService.onDidCloseInstance((instance) => {
                this.handleClose(instance);
            }),
        );
        this.register(
            terminalService.onDidChangeActiveInstance((instance) => {
                this.handleActiveChange(instance);
            }),
        );
        this.register(
            terminalService.onDidRequestFocus(() => {
                this.activeWidget?.focus();
            }),
        );
        // Инстансы, созданные до компонента (сервис резолвится первым в том же модуле).
        for (const instance of terminalService.getInstances()) this.handleOpen(instance);
        this.handleActiveChange(terminalService.getActiveInstance());

        // Виджеты обязаны быть dispose'нуты (подписки на surface): и оставшиеся
        // при закрытии приложения — здесь, и по одному — в handleClose.
        this.register({
            dispose: () => {
                for (const widget of this.widgets.values()) widget.dispose();
                this.widgets.clear();
            },
        });
    }

    private handleOpen(instance: ITerminalInstance): void {
        const widget = new TerminalViewElement(instance.session);
        this.widgets.set(instance.id, widget);
    }

    private handleClose(instance: ITerminalInstance): void {
        const widget = this.widgets.get(instance.id);
        /* v8 ignore start -- defensive: сервис файрит close только для инстанса, чей open компонент уже видел */
        if (widget === undefined) return;
        /* v8 ignore stop */
        widget.dispose();
        this.widgets.delete(instance.id);
    }

    /** Вкидывает виджет активного инстанса в TERMINAL-вкладку (null → placeholder). */
    private handleActiveChange(instance: ITerminalInstance | null): void {
        // Фокус подмену контента вкладки не переживает: уходящий виджет снимут с
        // дерева (`setViewContent` → `setParent(null)`), а FocusManager на этом
        // обнуляет фокус — после `exit` ввод проваливался в никуда. Поэтому
        // спрашиваем ДО подмены и раздаём фокус заново ПОСЛЕ.
        const hadFocus = this.activeWidget !== null && holdsFocus(this.activeWidget);
        if (instance === null) {
            this.activeWidget = null;
        } else {
            const widget = this.widgets.get(instance.id);
            /* v8 ignore start -- defensive: onDidOpenInstance всегда предшествует смене активного */
            if (widget === undefined) return;
            /* v8 ignore stop */
            this.activeWidget = widget;
        }
        this.viewsService.setViewBody(TERMINAL_VIEW_ID, this.activeWidget);
        if (!hadFocus) return;
        // Следующий терминал есть — фокус идёт в него; не осталось ни одного —
        // возвращаем его редактору, как VS Code при выходе последнего шелла.
        if (this.activeWidget !== null) this.activeWidget.focus();
        else this.focusFallback.focusEditor();
    }
}

/** Держит ли фокус сам виджет или что-то в его поддереве. */
function holdsFocus(widget: TerminalViewElement): boolean {
    const active = widget.getRoot()?.focusManager?.activeElement ?? null;
    return active !== null && active.getAncestorPath().includes(widget);
}

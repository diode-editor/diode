import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

import type { ITerminalColors } from "./terminalColorsService.ts";
import { applyTerminalColors } from "./terminalPanelComponent.ts";
import type { ITerminalInstance } from "./terminalService.ts";

/** Схема ресурса вкладки-терминала (`Schemas.vscodeTerminal` эталона). */
export const TERMINAL_EDITOR_SCHEME = "vscode-terminal";

/** Ресурс вкладки терминала по id инстанса — идентичность вкладки в группе. */
export function terminalEditorUri(instanceId: number): Uri {
    return Uri.from({ scheme: TERMINAL_EDITOR_SCHEME, path: `/${String(instanceId)}` });
}

/**
 * Вкладка-терминал в области редакторов (`TerminalEditor` + `TerminalEditorInput`
 * эталона): тело — `TerminalViewElement` над сессией инстанса, метка — имя
 * терминала. Закрытие вкладки (dispose панели группой) убивает процесс через
 * `onDidClose` — кроме случая, когда инстанс от вкладки отцеплен
 * ({@link detach}: переезд в панель, инстанс уже снят). Перенос вкладки между
 * группами панель не диспозит — процесс живёт.
 */
export class TerminalEditorPane extends Disposable implements IEditorPane {
    public readonly uri: Uri;
    public readonly view: TUIElement;
    public readonly isModified = false;
    // Замка во вкладке у терминала эталона нет: `Readonly` его input'а — про текстовые команды.
    public readonly readOnly = false;

    private readonly widget: TerminalViewElement;
    private readonly onDidChangeStateEmitter = this.register(new Emitter<void>());
    private readonly onDidCloseEmitter = this.register(new Emitter<void>());
    private detached = false;

    public constructor(
        public readonly instance: ITerminalInstance,
        colors: ITerminalColors,
    ) {
        super();
        this.uri = terminalEditorUri(instance.id);
        this.widget = new TerminalViewElement(instance.session);
        // Точки в id нет — `#terminalEditor-3` проходит селектором инспектора.
        this.widget.id = `terminalEditor-${String(instance.id)}`;
        applyTerminalColors(instance, this.widget, colors);
        this.view = this.widget;
    }

    public get label(): string {
        return this.instance.title;
    }

    /** Вкладку закрыли, а инстанс к ней ещё привязан — процесс пора убить. */
    public readonly onDidClose = this.onDidCloseEmitter.event;

    public readonly onDidChangeState = this.onDidChangeStateEmitter.event;

    /** Заголовок терминала сменился — перерисовать метку вкладки. */
    public refreshLabel(): void {
        this.onDidChangeStateEmitter.fire();
    }

    /** Новые цвета терминала (`terminal.integrated.colorSource`, смена темы). */
    public setColors(colors: ITerminalColors): void {
        applyTerminalColors(this.instance, this.widget, colors);
    }

    /** Отцепить инстанс (`detachInstance` эталона): закрытие вкладки его больше не убивает. */
    public detach(): void {
        this.detached = true;
    }

    public getSelectedTexts(): string[] {
        return [];
    }

    public focusEditor(): void {
        this.widget.focus();
    }

    public override dispose(): void {
        if (!this.detached) this.onDidCloseEmitter.fire();
        // Повторный dispose процесс второй раз не трогает.
        this.detached = true;
        this.widget.dispose();
        super.dispose();
    }
}

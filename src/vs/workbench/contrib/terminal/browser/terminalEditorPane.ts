import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

import type { ITerminalColors } from "./terminalColorsService.ts";
import { applyTerminalColors } from "./terminalPanelComponent.ts";
import type { ITerminalInstance } from "./terminalService.ts";

export const TERMINAL_EDITOR_SCHEME = "vscode-terminal";

/** Ресурс — идентичность вкладки в группе. */
export function terminalEditorUri(instanceId: number): Uri {
    return Uri.from({ scheme: TERMINAL_EDITOR_SCHEME, path: `/${String(instanceId)}` });
}

/**
 * Закрытие вкладки убивает процесс через `onDidClose`, если инстанс не отцеплен
 * ({@link detach}). Перенос между группами панель не диспозит.
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

    public readonly onDidClose = this.onDidCloseEmitter.event;

    public readonly onDidChangeState = this.onDidChangeStateEmitter.event;

    public refreshLabel(): void {
        this.onDidChangeStateEmitter.fire();
    }

    public setColors(colors: ITerminalColors): void {
        applyTerminalColors(this.instance, this.widget, colors);
    }

    /** Закрытие вкладки инстанс больше не убивает. */
    public detach(): void {
        this.detached = true;
    }

    public getSelectedTexts(): string[] {
        return [];
    }

    public focusEditor(): void {
        this.widget.focus();
    }

    /** Повторный dispose процесс второй раз не трогает: эмиттер уже снят. */
    public override dispose(): void {
        if (!this.detached) this.onDidCloseEmitter.fire();
        this.widget.dispose();
        super.dispose();
    }
}

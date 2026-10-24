import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

import type { ITerminalColors } from "./terminalColorsService.ts";
import { applyTerminalColors } from "./terminalPanelComponent.ts";
import type { ITerminalInstance } from "./terminalService.ts";

export const TERMINAL_EDITOR_SCHEME = "vscode-terminal";

/** Upstream `terminalEditorId`; `workbench.editor.autoLockGroups` locks its group by default. */
export const TERMINAL_EDITOR_ID = "terminalEditor";

/** The resource is the tab's identity within the group. */
export function terminalEditorUri(instanceId: number): Uri {
    return Uri.from({ scheme: TERMINAL_EDITOR_SCHEME, path: `/${String(instanceId)}` });
}

/**
 * Closing the tab kills the process via `onDidClose` unless the instance is detached
 * ({@link detach}). Moving between groups doesn't dispose the pane.
 */
export class TerminalEditorPane extends Disposable implements IEditorPane {
    public readonly uri: Uri;
    public readonly view: TUIElement;
    public readonly isModified = false;
    // Upstream's terminal tab has no lock: its input's `Readonly` is about text commands.
    public readonly readOnly = false;
    public readonly editorId = TERMINAL_EDITOR_ID;

    private readonly widget: TerminalViewElement;
    private readonly onDidChangeStateEmitter = this.register(new Emitter<void>());
    private readonly onDidCloseEmitter = this.register(new Emitter<void>());
    private detached = false;

    public constructor(
        public readonly instance: ITerminalInstance,
        colors: ITerminalColors,
        widget: TerminalViewElement,
    ) {
        super();
        this.uri = terminalEditorUri(instance.id);
        this.widget = widget;
        // No dots in the id — `#terminalEditor-3` works as an inspector selector.
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

    /** Closing the tab no longer kills the instance. */
    public detach(): void {
        this.detached = true;
    }

    public getSelectedTexts(): string[] {
        return [];
    }

    public focusEditor(): void {
        this.widget.focus();
    }

    /** A repeated dispose doesn't touch the process again: the emitter is already removed. */
    public override dispose(): void {
        if (!this.detached) this.onDidCloseEmitter.fire();
        this.widget.dispose();
        super.dispose();
    }
}

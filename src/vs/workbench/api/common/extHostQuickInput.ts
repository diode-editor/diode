import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { QuickInputButtons } from "./quickInputButtons.ts";
import { EventEmitter } from "./vscodeTypes.ts";
import type { IWireQuickPickEvent } from "./wireTypes.ts";

/** `null` means "reset to undefined". */
export type PendingUpdate = Record<string, unknown>;

/**
 * Upstream `ExtHostQuickInput`: an own copy of the state; setters accumulate a diff while the input is
 * visible, and it goes to the host on a next-tick timer; `show()`/`hide()` send what has accumulated
 * immediately. `busy`, `enabled`, `ignoreFocusOut` are stored but not sent to the host: the overlay has none
 * of them. Of `buttons` only {@link QuickInputButtons.Back} reaches the host: the overlay draws no other.
 */
export abstract class ExtHostQuickInput implements vscode.QuickInput {
    // Defaults follow upstream even where d.ts says otherwise: until assigned,
    // the host defaults apply.
    public enabled = true;
    public busy = false;
    public ignoreFocusOut = true;

    private titleValue: string | undefined;
    private stepValue: number | undefined;
    private totalStepsValue: number | undefined;
    private valueValue = "";
    private placeholderValue: string | undefined;
    private promptValue: string | undefined;
    private buttonsValue: readonly vscode.QuickInputButton[] = [];

    private visible = false;
    /** Hiding is reported to the extension once per show (upstream, #135747). */
    private expectingHide = false;
    private disposed = false;
    private updateTimer: ReturnType<typeof setTimeout> | undefined;

    private readonly onDidChangeValueEmitter = new EventEmitter<string>();
    private readonly onDidAcceptEmitter = new EventEmitter<void>();
    private readonly onDidHideEmitter = new EventEmitter<void>();
    private readonly onDidTriggerButtonEmitter = new EventEmitter<vscode.QuickInputButton>();

    public readonly onDidChangeValue = this.onDidChangeValueEmitter.event;
    public readonly onDidAccept = this.onDidAcceptEmitter.event;
    public readonly onDidHide = this.onDidHideEmitter.event;
    public readonly onDidTriggerButton = this.onDidTriggerButtonEmitter.event;

    protected constructor(
        private readonly rpc: SubprocessRpc,
        public readonly handle: number,
        private readonly onDispose: () => void,
        /** The first update creates the host's side, so it carries what is fixed for the input's life. */
        private pending: PendingUpdate = {},
    ) {}

    public get title(): string | undefined {
        return this.titleValue;
    }
    public set title(title: string | undefined) {
        this.titleValue = title;
        this.update({ title });
    }

    public get step(): number | undefined {
        return this.stepValue;
    }
    public set step(step: number | undefined) {
        this.stepValue = step;
        this.update({ step });
    }

    public get totalSteps(): number | undefined {
        return this.totalStepsValue;
    }
    public set totalSteps(totalSteps: number | undefined) {
        this.totalStepsValue = totalSteps;
        this.update({ totalSteps });
    }

    public get value(): string {
        return this.valueValue;
    }
    public set value(value: string) {
        this.valueValue = value;
        this.update({ value });
    }

    public get placeholder(): string | undefined {
        return this.placeholderValue;
    }
    public set placeholder(placeholder: string | undefined) {
        this.placeholderValue = placeholder;
        this.update({ placeholder });
    }

    public get prompt(): string | undefined {
        return this.promptValue;
    }
    public set prompt(prompt: string | undefined) {
        this.promptValue = prompt;
        this.update({ prompt });
    }

    public get buttons(): readonly vscode.QuickInputButton[] {
        return this.buttonsValue;
    }
    public set buttons(buttons: readonly vscode.QuickInputButton[]) {
        this.buttonsValue = buttons.slice();
        this.update({ back: buttons.includes(QuickInputButtons.Back) });
    }

    public show(): void {
        this.visible = true;
        this.expectingHide = true;
        this.update({ visible: true });
    }

    public hide(): void {
        this.visible = false;
        this.update({ visible: false });
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.fireDidHide();
        clearTimeout(this.updateTimer);
        this.onDidChangeValueEmitter.dispose();
        this.onDidAcceptEmitter.dispose();
        this.onDidHideEmitter.dispose();
        this.onDidTriggerButtonEmitter.dispose();
        this.disposeEmitters();
        this.onDispose();
        this.rpc.notify("window.quickPick.dispose", { handle: this.handle });
    }

    public acceptEvent(event: IWireQuickPickEvent): void {
        switch (event.kind) {
            case "changeValue":
                this.valueValue = event.value;
                this.onDidChangeValueEmitter.fire(event.value);
                break;
            case "accept":
                this.onDidAcceptEmitter.fire();
                break;
            case "hide":
                // Visibility is NOT cleared, as upstream: the response to a previous hide() may
                // arrive during the next show. The cost: after Escape `dispose()` fires a second onDidHide.
                this.fireDidHide();
                break;
            case "back":
                this.onDidTriggerButtonEmitter.fire(QuickInputButtons.Back);
                break;
            default:
                break;
        }
    }

    protected disposeEmitters(): void {
        // A flavor without emitters of its own has nothing to do.
    }

    protected update(properties: PendingUpdate): void {
        if (this.disposed) return;
        for (const [key, value] of Object.entries(properties)) {
            this.pending[key] = value === undefined ? null : value;
        }
        if ("visible" in this.pending) {
            clearTimeout(this.updateTimer);
            this.updateTimer = undefined;
            this.dispatchUpdate();
        } else if (this.visible && this.updateTimer === undefined) {
            this.updateTimer = setTimeout(() => {
                this.updateTimer = undefined;
                this.dispatchUpdate();
            }, 0);
        }
    }

    private fireDidHide(): void {
        if (!this.expectingHide) return;
        // Upstream: show→hide→show→hide = two events.
        this.expectingHide = this.visible;
        this.onDidHideEmitter.fire();
    }

    private dispatchUpdate(): void {
        this.rpc.notify("window.quickPick.update", { ...this.pending, handle: this.handle });
        this.pending = {};
    }
}

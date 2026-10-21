import { Point } from "@tuidom/core/common/geometryPromitives";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";
import { BoxContainerElement } from "@tuidom/elements/layout/boxContainerElement";
import { FitContentElement } from "@tuidom/elements/layout/fitContentElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { Keybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { DIALOG_STYLES } from "../../../browser/parts/dialogs/dialogComponent.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";
import {
    describeBindings,
    describeEnv,
    describeEvent,
    describeVerdict,
    type DoctorStep,
    doctorSteps,
    formatReport,
    judge,
    type KeyboardDoctorEnv,
    type MatchedBinding,
    type ObservedKey,
    type StepResult,
} from "../common/keyboardDoctorModel.ts";

export const KeyboardDoctorComponentDIToken = token<KeyboardDoctorComponent>("KeyboardDoctorComponent");

/** TerminalEnvironmentService lives in node — the browser component gets a slice via DI. */
export interface IKeyboardDoctorEnvProvider {
    snapshot(): KeyboardDoctorEnv;
    onDidChange(listener: () => void): IDisposable;
}

export type BindingLookup = (part: Keybinding, env: KeyboardDoctorEnv) => readonly MatchedBinding[];

// Modifiers arrive as separate keydowns (Kitty protocol) — they are not a check step.
const MODIFIER_KEY_NAMES = new Set(["Control", "Shift", "Alt", "Meta", "Hyper", "Super", "AltGraph", "CapsLock"]);

const HINT = "Escape — nothing happened (that is an answer too)";
const KEYUP_HINT = "Enter — keyup never came";

function observed(event: TUIKeyboardEvent): ObservedKey {
    return {
        raw: event.raw,
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
    };
}

/**
 * Capture works like the keybinding recorder: `stopPropagation` in the target phase cuts off KeybindingDispatcher,
 * so the combination executes nothing; the dispatcher's capture handler still sees the press first, so
 * Cmd raises the rung just like in normal work. A step is closed by the PAIRED keypress, a keyup step — by releasing
 * the modifier or a bare Enter.
 */
export class KeyboardDoctorComponent extends Disposable {
    private session: OverlaySessionHandle | null = null;

    private readonly root: FitContentElement;
    // Stryker disable next-line StringLiteral: the initial text is overwritten by render() before first show.
    private readonly envLabels = [new TextLabelElement(""), new TextLabelElement(""), new TextLabelElement("")];
    // Stryker disable next-line StringLiteral: the initial text is overwritten by render() before first show.
    private readonly stepLabel = new TextLabelElement("");
    // Stryker disable next-line StringLiteral: the initial text is overwritten by render() before first show.
    private readonly catchesLabel = new TextLabelElement("");
    // Stryker disable next-line StringLiteral: the initial text is overwritten by render() before first show.
    private readonly lastLabel = new TextLabelElement("");
    private readonly hintLabel = new TextLabelElement(HINT);

    // Stryker disable next-line ArrayDeclaration: run() sets the steps before any keydown.
    private steps: DoctorStep[] = [];
    // Stryker disable next-line ArrayDeclaration: run() resets the results before any keydown.
    private results: StepResult[] = [];
    private awaitingKeyUp: { received: ObservedKey; bindings: readonly MatchedBinding[] } | null = null;
    // Stryker disable next-line BooleanLiteral: run() resets the flag before any keypress.
    private advanceOnKeyPress = false;
    private resolveRun: ((report: string) => void) | null = null;
    private envSubscription: IDisposable | null = null;

    public constructor(
        private readonly env: IKeyboardDoctorEnvProvider,
        private readonly lookup: BindingLookup,
        private readonly layoutService: LayoutService,
    ) {
        super();
        this.root = new FitContentElement();
        this.root.id = "keyboardDoctor";
        // Stryker disable next-line BooleanLiteral: programmatic focus() sets focus even without the flag, and there is no Tab navigation in a modal overlay with a single focusable — the value is unobservable (same as the recorder).
        this.root.focusable = true;

        const stack = new VStackElement();
        for (const label of [...this.envLabels, this.stepLabel, this.catchesLabel, this.lastLabel, this.hintLabel]) {
            stack.addChild(label, { width: "stretch", height: 1 });
        }
        // Stryker disable next-line CallExpression: pure color setup — the palette is not checked per frame.
        this.hintLabel.setColors(DIALOG_STYLES.descriptionFg, DIALOG_STYLES.bg);
        // Stryker disable next-line CallExpression: pure color setup — the palette is not checked per frame.
        this.catchesLabel.setColors(DIALOG_STYLES.descriptionFg, DIALOG_STYLES.bg);

        const box = new BoxContainerElement();
        // Stryker disable next-line CallExpression: frame background — color, not behavior.
        box.setBg(DIALOG_STYLES.bg);
        // Stryker disable next-line CallExpression: border color — not behavior.
        box.setBorderFg(DIALOG_STYLES.borderFg);
        box.setTitle("Keyboard Doctor");
        // Stryker disable next-line CallExpression: title color — not behavior.
        box.setTitleFg(DIALOG_STYLES.fg);
        // Stryker disable next-line ObjectLiteral: window padding — layout cosmetics.
        const padding = new PaddingContainerElement(stack, { left: 2, right: 2 });
        // Stryker disable next-line ObjectLiteral: container colors — not behavior.
        padding.style = { fg: DIALOG_STYLES.fg, bg: DIALOG_STYLES.bg };
        box.setChild(padding);
        this.root.setChild(box);

        this.root.addEventListener("keydown", (event) => {
            this.handleKeyDown(event);
        });
        this.root.addEventListener("keypress", (event) => {
            // Stryker disable next-line CallExpression: keypress anti-leak; unobservable without a background consumer behind the overlay.
            event.preventDefault();
            // Stryker disable next-line CallExpression: keypress anti-leak; unobservable without a background consumer behind the overlay.
            event.stopPropagation();
            // Stryker disable next-line ConditionalExpression: an extra advance() without a recorded step only re-renders the current step — unobservable.
            if (this.advanceOnKeyPress) this.advance();
        });
        this.root.addEventListener("keyup", (event) => {
            // Stryker disable next-line CallExpression: the dispatcher's keyup handler (hold sessions) on the root — cut it off, same as keydown.
            event.stopPropagation();
            const pending = this.awaitingKeyUp;
            if (pending === null || this.steps[this.results.length].keyUp !== event.key) return;
            this.awaitingKeyUp = null;
            this.record(pending.received, pending.bindings, true);
            this.advance();
        });

        this.register({
            dispose: () => {
                this.envSubscription?.dispose();
                this.session?.dispose();
            },
        });
    }

    public isOpen(): boolean {
        return this.session?.isOpen() ?? false;
    }

    /** Calling again while the doctor is open starts over. */
    public run(): Promise<string> {
        // Host is the window's root view; before attachRoot the service throws by itself.
        const host = this.layoutService.mainContainer;
        this.steps = doctorSteps(this.env.snapshot());
        this.results = [];
        this.awaitingKeyUp = null;
        this.advanceOnKeyPress = false;
        this.envSubscription?.dispose();
        this.envSubscription = this.env.onDidChange(() => {
            this.render();
        });
        this.render();

        // Stryker disable next-line ObjectLiteral: session options are overlay policy; each is annotated separately below.
        const session = (this.session ??= host.overlayLayer.createSession(this.root, new Point(0, 0), {
            // Stryker disable next-line BooleanLiteral: initial invisibility is immediately overridden by open() in openCentered().
            visible: false,
            restoreFocus: true,
            // Escape is the "nothing happened" answer; the layer must not close the session.
            // Stryker disable next-line BooleanLiteral: handleKeyDown swallows Escape with stopPropagation before the layer — the flag value is unobservable.
            closeOnEscape: false,
            // Stryker disable next-line StringLiteral: pointer policy is not checked in keyboard tests.
            pointerPolicy: "modal",
        }));
        this.openCentered(host, session);
        this.root.focus();

        return new Promise((resolve) => {
            this.resolveRun = resolve;
        });
    }

    private handleKeyDown(event: TUIKeyboardEvent): void {
        // Stryker disable next-line CallExpression: default suppression; unobservable in isolation.
        event.preventDefault();
        // Stryker disable next-line CallExpression: cuts off KeybindingDispatcher (bubble); unobservable in a unit test without the dispatcher.
        event.stopPropagation();
        if (MODIFIER_KEY_NAMES.has(event.key) || this.advanceOnKeyPress) return;
        const bare = !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;

        const pending = this.awaitingKeyUp;
        if (pending !== null) {
            // Wait for the modifier release; a bare Enter means "keyup never came".
            if (bare && event.key === "Enter") {
                this.awaitingKeyUp = null;
                this.record(pending.received, pending.bindings, false);
                this.advanceOnKeyPress = true;
            }
            return;
        }

        if (bare && event.key === "Escape") {
            // Stryker disable next-line BooleanLiteral: keyUpSeen is read only for steps with keyUp and an accepted press — unobservable for "nothing arrived".
            this.record(null, [], false);
            this.advanceOnKeyPress = true;
            return;
        }
        const received = observed(event);
        const bindings = this.lookup(received, this.env.snapshot());
        if (this.steps[this.results.length].keyUp !== undefined) {
            this.awaitingKeyUp = { received, bindings };
            this.render();
            return;
        }
        // Stryker disable next-line BooleanLiteral: only steps without keyUp get here — their keyUpSeen is never read.
        this.record(received, bindings, false);
        this.advanceOnKeyPress = true;
    }

    private record(received: ObservedKey | null, bindings: readonly MatchedBinding[], keyUpSeen: boolean): void {
        this.results.push({ step: this.steps[this.results.length], received, bindings, keyUpSeen });
    }

    private advance(): void {
        this.advanceOnKeyPress = false;
        if (this.results.length < this.steps.length) {
            this.render();
            return;
        }
        const resolve = this.resolveRun;
        this.resolveRun = null;
        // Stryker disable next-line OptionalChaining: advance after the last step happens only inside run() — subscription, session and resolve are set, ?. is defensive.
        this.envSubscription?.dispose();
        this.envSubscription = null;
        // Stryker disable next-line OptionalChaining: see above — the session is created in run().
        this.session?.close();
        // Stryker disable next-line OptionalChaining: see above — resolveRun is set in run().
        resolve?.(formatReport(this.env.snapshot(), this.results));
    }

    private render(): void {
        const env = this.env.snapshot();
        describeEnv(env).forEach((line, i) => {
            this.envLabels[i].setText(line);
        });
        // render is called only while steps remain: advance after the last one closes the doctor.
        const current = this.steps[this.results.length];
        this.stepLabel.setText(
            `Step ${String(this.results.length + 1)}/${String(this.steps.length)}: press ${current.prompt}`,
        );
        this.catchesLabel.setText(`Checks: ${current.catches}`);
        this.lastLabel.setText(this.lastText(env));
        this.hintLabel.setText(this.awaitingKeyUp === null ? HINT : KEYUP_HINT);
        // Stryker disable next-line all: re-centering for the new text width — position cosmetics, not checked per frame.
        if (this.session?.isOpen() === true) this.openCentered(this.layoutService.mainContainer, this.session);
    }

    private lastText(env: KeyboardDoctorEnv): string {
        if (this.awaitingKeyUp !== null) {
            return `Received: ${describeEvent(this.awaitingKeyUp.received)} — now release the modifier`;
        }
        const last = this.results.at(-1);
        if (last === undefined) return "Nothing pressed yet";
        const arrived = last.received === null ? "nothing" : describeEvent(last.received);
        return `Last: ${arrived} · keybinding: ${describeBindings(last.bindings)} · ${describeVerdict(judge(last, env))}`;
    }

    private openCentered(host: BodyElement, session: OverlaySessionHandle): void {
        // Stryker disable next-line MethodExpression: clamping width to the screen — position cosmetics, not checked per frame.
        const width = Math.min(this.root.getMaxIntrinsicWidth(0), host.layoutSize.width);
        const height = this.root.getMaxIntrinsicHeight(width);
        // Stryker disable next-line MethodExpression: centering on X — position cosmetics, not checked per frame.
        const px = Math.max(0, Math.floor((host.layoutSize.width - width) / 2));
        // Stryker disable next-line MethodExpression,ArithmeticOperator: centering on Y — position cosmetics, not checked per frame.
        const py = Math.max(0, Math.floor((host.layoutSize.height - height) / 2));
        // Stryker disable next-line CallExpression: setPosition only positions the overlay; open() defines what is observable (isOpen).
        session.setPosition(new Point(px, py));
        session.open();
    }
}

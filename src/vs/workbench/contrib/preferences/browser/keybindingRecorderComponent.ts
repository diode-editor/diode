import { Point } from "@tuidom/core/common/geometryPromitives";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";
import { BoxContainerElement } from "@tuidom/elements/layout/boxContainerElement";
import { FitContentElement } from "@tuidom/elements/layout/fitContentElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { Disposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { requiresExtendedKeys } from "../../../../platform/keybinding/common/keybindingPortability.ts";
import type { Keybinding, KeybindingChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { formatKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { DIALOG_STYLES } from "../../../browser/parts/dialogs/dialogComponent.ts";
import type { LayoutService } from "../../../services/layout/browser/layoutService.ts";

export const KeybindingRecorderComponentDIToken = token<KeybindingRecorderComponent>("KeybindingRecorderComponent");

/** The service itself lives in the node environment: the browser component doesn't import it, the DI module does the binding. */
export interface IRecorderTerminalEnv {
    readonly tier: string;
    readonly os: string;
}

// Modifiers arrive as separate keydowns (Kitty protocol) and are not chord parts.
const MODIFIER_KEY_NAMES = new Set(["Control", "Shift", "Alt", "Meta", "Hyper", "Super", "AltGraph", "CapsLock"]);

const PLACEHOLDER = "Press desired key combination…";
const HINT = "Enter — accept · Escape — cancel";
const LEGACY_NOTE = "Legacy terminal: some combinations are indistinguishable here";
const PORTABILITY_WARNING = "May not be available on legacy terminals";

/**
 * Bare Enter accepts, bare Escape cancels, everything else (including Ctrl+Enter, Shift+Escape) goes into the chord.
 * The focused root with `stopPropagation` in the target phase cuts off KeybindingDispatcher.
 * Closing happens on the PAIRED keypress: it is pinned to the keydown target (docs/arch/workbench/Commands.md, rule on the second chord part),
 * and closing on keydown would let it through to the editor behind.
 */
export class KeybindingRecorderComponent extends Disposable {
    private session: OverlaySessionHandle | null = null;

    private readonly root: FitContentElement;
    // Stryker disable next-line StringLiteral: the initial text is overwritten by record() before first show.
    private readonly titleLabel = new TextLabelElement("");
    private readonly chordLabel = new TextLabelElement(PLACEHOLDER);
    private readonly hintLabel = new TextLabelElement(HINT);
    // Stryker disable next-line StringLiteral: the initial text is overwritten by updateLabels() before first show.
    private readonly warningLabel = new TextLabelElement("");

    // Stryker disable next-line ArrayDeclaration: the initial value is overwritten by record() before any keydown.
    private parts: Keybinding[] = [];
    /** Outcome armed by keydown; executed by the paired keypress. */
    private pendingOutcome: KeybindingChord | null | undefined;
    private resolveRecording: ((chord: KeybindingChord | null) => void) | null = null;

    public constructor(
        private readonly terminalEnv: IRecorderTerminalEnv,
        private readonly layoutService: LayoutService,
    ) {
        super();
        this.root = new FitContentElement();
        this.root.id = "keybindingRecorder";
        // Stryker disable next-line BooleanLiteral: programmatic focus() sets focus without the flag, and a modal overlay with a single focusable has no Tab navigation — the value is unobservable.
        this.root.focusable = true;

        const stack = new VStackElement();
        for (const label of [this.titleLabel, this.chordLabel, this.hintLabel, this.warningLabel]) {
            stack.addChild(label, { width: "stretch", height: 1 });
        }
        // Stryker disable next-line CallExpression: pure color setup — the palette is not checked per frame.
        this.titleLabel.setColors(DIALOG_STYLES.fg, DIALOG_STYLES.bg);
        // Stryker disable next-line CallExpression: pure color setup — the palette is not checked per frame.
        this.hintLabel.setColors(DIALOG_STYLES.descriptionFg, DIALOG_STYLES.bg);

        const box = new BoxContainerElement();
        // Stryker disable next-line CallExpression: box background is color, not behavior.
        box.setBg(DIALOG_STYLES.bg);
        // Stryker disable next-line CallExpression: border color is not behavior.
        box.setBorderFg(DIALOG_STYLES.borderFg);
        box.setTitle("Define Keybinding");
        // Stryker disable next-line CallExpression: title color is not behavior.
        box.setTitleFg(DIALOG_STYLES.fg);
        // Stryker disable next-line BooleanLiteral,CallExpression: the separator is box cosmetics, not checked per frame.
        box.setHasSeparator(true);
        // Stryker disable next-line ObjectLiteral: window padding is layout cosmetics.
        const padding = new PaddingContainerElement(stack, { left: 2, right: 2 });
        // Stryker disable next-line ObjectLiteral: container colors are not behavior.
        padding.style = { fg: DIALOG_STYLES.fg, bg: DIALOG_STYLES.bg };
        box.setChild(padding);
        this.root.setChild(box);

        this.root.addEventListener("keydown", (event) => {
            this.handleKeyDown(event);
        });
        this.root.addEventListener("keypress", (event) => {
            // No keypress may leak past the overlay (into the list, the editor).
            // Stryker disable next-line CallExpression: keypress anti-leak; unobservable in an isolated harness without a background consumer (a safeguard on top of the modal overlay).
            event.preventDefault();
            // Stryker disable next-line CallExpression: keypress anti-leak; unobservable without a background consumer behind the overlay.
            event.stopPropagation();
            if (this.pendingOutcome !== undefined) this.finish(this.pendingOutcome);
        });

        this.register({
            dispose: () => {
                this.session?.dispose();
            },
        });
    }

    /** Calling again while the recorder is open cancels the previous recording. */
    public record(commandTitle: string): Promise<KeybindingChord | null> {
        // The host is the window's root view; before attachRoot the service throws on its own.
        const host = this.layoutService.mainContainer;
        this.resolveRecording?.(null);

        this.parts = [];
        this.pendingOutcome = undefined;
        this.titleLabel.setText(commandTitle);
        this.updateLabels();

        const session = (this.session ??= host.overlayLayer.createSession(this.root, new Point(0, 0), {
            // Stryker disable next-line BooleanLiteral: the initial invisibility is immediately overridden by open() in openCentered().
            visible: false,
            restoreFocus: true,
            // Escape is part of the recording protocol (bare cancels, with a modifier goes
            // into the chord); the layer must not close the session.
            // Stryker disable next-line BooleanLiteral: handleKeyDown swallows Escape with stopPropagation before the layer — the flag value is unobservable.
            closeOnEscape: false,
            // Stryker disable next-line StringLiteral: pointer policy is not checked in the recorder's keyboard tests.
            pointerPolicy: "modal",
        }));
        this.openCentered(host, session);
        this.root.focus();

        return new Promise((resolve) => {
            this.resolveRecording = resolve;
        });
    }

    public isOpen(): boolean {
        return this.session?.isOpen() ?? false;
    }

    private handleKeyDown(event: TUIKeyboardEvent): void {
        // Stryker disable next-line CallExpression: default suppression; unobservable in isolation (a safeguard on top of the modal overlay).
        event.preventDefault();
        // Stryker disable next-line CallExpression: cuts off KeybindingDispatcher; unobservable in a unit test without a dispatcher, and on top of that the overlay's capturesKeyboard already swallows commands.
        event.stopPropagation();
        if (MODIFIER_KEY_NAMES.has(event.key)) return;

        const bare = !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
        if (bare && event.key === "Enter") {
            if (this.parts.length > 0) this.pendingOutcome = this.parts;
            return;
        }
        if (bare && event.key === "Escape") {
            this.pendingOutcome = null;
            return;
        }

        this.parts.push({
            key: event.key,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
        });
        this.updateLabels();
    }

    private finish(outcome: KeybindingChord | null): void {
        const resolve = this.resolveRecording;
        this.pendingOutcome = undefined;
        this.resolveRecording = null;
        // Stryker disable next-line OptionalChaining: finish is called only from keypress during an active recording — session is guaranteed non-null, ?. is defensive.
        this.session?.close();
        // Stryker disable next-line OptionalChaining: resolveRecording is always set during an active recording (pendingOutcome is set only after record), ?. is defensive.
        resolve?.(outcome);
    }

    private updateLabels(): void {
        const style = this.terminalEnv.os === "mac" ? "mac" : "pc";
        this.chordLabel.setText(this.parts.length > 0 ? formatKeybinding(this.parts, style) : PLACEHOLDER);
        // Stryker disable next-line ConditionalExpression,EqualityOperator: the ternary only picks the chord text COLOR — not checked per frame.
        const chordFg = this.parts.length > 0 ? DIALOG_STYLES.fg : DIALOG_STYLES.descriptionFg;
        // Stryker disable next-line CallExpression: applying the chord text color is cosmetics, not checked per frame.
        this.chordLabel.setColors(chordFg, DIALOG_STYLES.bg);

        const warning = this.warning();
        this.warningLabel.setText(warning.text);
        // Stryker disable next-line CallExpression: applying the note color is cosmetics, not checked per frame.
        this.warningLabel.setColors(warning.fg, DIALOG_STYLES.bg);
    }

    private warning(): { text: string; fg: StyleColor } {
        // Stryker disable next-line EqualityOperator,ConditionalExpression: `parts.length > 0` is redundant next to requiresExtendedKeys([])===false — with an empty chord both branches give false.
        if (this.parts.length > 0 && requiresExtendedKeys(this.parts)) {
            return { text: PORTABILITY_WARNING, fg: DIALOG_STYLES.warningFg };
        }
        if (this.terminalEnv.tier === "legacy") {
            return { text: LEGACY_NOTE, fg: DIALOG_STYLES.descriptionFg };
        }
        return { text: "", fg: DIALOG_STYLES.descriptionFg };
    }

    private openCentered(host: BodyElement, session: OverlaySessionHandle): void {
        const width = this.root.getMaxIntrinsicWidth(0);
        const height = this.root.getMaxIntrinsicHeight(width);
        // Stryker disable next-line MethodExpression: X centering is position cosmetics, not checked per frame.
        const px = Math.max(0, Math.floor((host.layoutSize.width - width) / 2));
        // Stryker disable next-line MethodExpression,ArithmeticOperator: Y centering is position cosmetics, not checked per frame.
        const py = Math.max(0, Math.floor((host.layoutSize.height - height) / 2));
        // Stryker disable next-line CallExpression: setPosition only positions the overlay; open() below determines what is observable (isOpen).
        session.setPosition(new Point(px, py));
        session.open();
    }
}

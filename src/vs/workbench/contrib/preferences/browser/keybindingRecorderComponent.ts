import { Point } from "@tuidom/core/common/geometryPromitives";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import { BoxContainerElement } from "@tuidom/elements/layout/boxContainerElement";
import { FitContentElement } from "@tuidom/elements/layout/fitContentElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { requiresExtendedKeys } from "../../../../platform/keybinding/common/keybindingPortability.ts";
import type { Keybinding, KeybindingChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { formatKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { Component } from "../../../browser/component.ts";
import { DIALOG_STYLES } from "../../../browser/parts/dialogs/dialogComponent.ts";

export const KeybindingRecorderComponentDIToken = token<KeybindingRecorderComponent>("KeybindingRecorderComponent");

/**
 * Узкий срез TerminalEnvironmentService: рекордеру нужен только текущий tier.
 * Сам сервис живёт в node-окружении — биндинг делает DI-модуль (diode-слой),
 * browser-компонент node не импортирует.
 */
export interface IRecorderTerminalEnv {
    readonly tier: string;
}

// Модификаторы приходят отдельными keydown (Kitty protocol) — частями чорда не являются.
const MODIFIER_KEY_NAMES = new Set(["Control", "Shift", "Alt", "Meta", "Hyper", "Super", "AltGraph", "CapsLock"]);

const PLACEHOLDER = "Press desired key combination…";
const HINT = "Enter — accept · Escape — cancel";
const LEGACY_NOTE = "Legacy terminal: some combinations are indistinguishable here";
const PORTABILITY_WARNING = "May not be available on legacy terminals";

/**
 * Рекордер комбинации для вкладки Keyboard Shortcuts: модальный оверлей
 * «нажмите новую комбинацию». Копит части чорда по нажатиям; голый Enter
 * принимает (при непустом чорде), голый Escape отменяет, всё остальное — в
 * чорд (Ctrl+Enter и Shift+Escape записываются, не управляют).
 *
 * Захват: сфокусированный корень со `stopPropagation` на target-фазе полностью
 * отсекает KeybindingDispatcher (его capture-хендлер — no-op вне чорда, bubble
 * до корня не доходит); `capturesKeyboard` оверлея глушит фокус-скоупные
 * команды страховкой.
 *
 * Закрытие — по ПАРНОМУ keypress, не по keydown: keypress пиннится к цели
 * keydown (см. Workbench.md, «Вторая часть аккорда…»), и закрытие на keydown
 * отпустило бы его в редактор позади.
 */
export class KeybindingRecorderComponent extends Component {
    private host: BodyElement | null = null;
    private session: OverlaySessionHandle | null = null;

    private readonly root: FitContentElement;
    private readonly titleLabel = new TextLabelElement("");
    private readonly chordLabel = new TextLabelElement(PLACEHOLDER);
    private readonly hintLabel = new TextLabelElement(HINT);
    private readonly warningLabel = new TextLabelElement("");

    private parts: Keybinding[] = [];
    /** Решение, взведённое keydown'ом; исполняется парным keypress. */
    private pendingOutcome: KeybindingChord | null | undefined;
    private resolveRecording: ((chord: KeybindingChord | null) => void) | null = null;

    public constructor(private readonly terminalEnv: IRecorderTerminalEnv) {
        super();
        this.root = new FitContentElement();
        this.root.id = "keybindingRecorder";
        this.root.focusable = true;

        const stack = new VStackElement();
        for (const label of [this.titleLabel, this.chordLabel, this.hintLabel, this.warningLabel]) {
            stack.addChild(label, { width: "stretch", height: 1 });
        }
        this.titleLabel.setColors(DIALOG_STYLES.fg, DIALOG_STYLES.bg);
        this.hintLabel.setColors(DIALOG_STYLES.descriptionFg, DIALOG_STYLES.bg);

        const box = new BoxContainerElement();
        box.setBg(DIALOG_STYLES.bg);
        box.setBorderFg(DIALOG_STYLES.borderFg);
        box.setTitle("Define Keybinding");
        box.setTitleFg(DIALOG_STYLES.fg);
        box.setHasSeparator(true);
        const padding = new PaddingContainerElement(stack, { left: 2, right: 2 });
        padding.style = { fg: DIALOG_STYLES.fg, bg: DIALOG_STYLES.bg };
        box.setChild(padding);
        this.root.setChild(box);

        this.root.addEventListener("keydown", (event) => {
            this.handleKeyDown(event);
        });
        this.root.addEventListener("keypress", (event) => {
            // Ни один keypress не должен протечь за оверлей (в список, в редактор).
            event.preventDefault();
            event.stopPropagation();
            if (this.pendingOutcome !== undefined) this.finish(this.pendingOutcome);
        });

        this.register({
            dispose: () => {
                this.session?.dispose();
            },
        });
    }

    /** Вызывается владельцем корневой view до первой записи (конвенция DialogService). */
    public attachHost(host: BodyElement): void {
        this.host = host;
    }

    /**
     * Показывает рекордер и резолвится записанным чордом (Enter) либо `null`
     * (Escape). Повторный вызов при открытом рекордере отменяет предыдущую
     * запись.
     */
    public record(commandTitle: string): Promise<KeybindingChord | null> {
        if (this.host === null) {
            throw new Error("KeybindingRecorderComponent: host is not attached (attachHost must be called first)");
        }
        this.resolveRecording?.(null);

        this.parts = [];
        this.pendingOutcome = undefined;
        this.titleLabel.setText(commandTitle);
        this.updateLabels();

        this.session ??= this.host.overlayLayer.createSession(this.root, new Point(0, 0), {
            visible: false,
            restoreFocus: true,
            // Escape — часть протокола записи (голый — отмена, с модификатором —
            // в чорд); слой закрывать сессию не должен.
            closeOnEscape: false,
            pointerPolicy: "modal",
        });
        this.openCentered();
        this.root.focus();

        return new Promise((resolve) => {
            this.resolveRecording = resolve;
        });
    }

    /** Открыт ли рекордер (для тестов/оркестрации). */
    public isOpen(): boolean {
        return this.session?.isOpen() ?? false;
    }

    private handleKeyDown(event: TUIKeyboardEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (MODIFIER_KEY_NAMES.has(event.key)) return;

        const bare = !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
        if (bare && event.key === "Enter") {
            // Пустой чорд принимать нечего — ждём комбинацию.
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
        this.session?.close();
        resolve?.(outcome);
    }

    private updateLabels(): void {
        this.chordLabel.setText(this.parts.length > 0 ? formatKeybinding(this.parts) : PLACEHOLDER);
        this.chordLabel.setColors(
            this.parts.length > 0 ? DIALOG_STYLES.fg : DIALOG_STYLES.descriptionFg,
            DIALOG_STYLES.bg,
        );

        if (this.parts.length > 0 && requiresExtendedKeys(this.parts)) {
            this.warningLabel.setText(PORTABILITY_WARNING);
            this.warningLabel.setColors(DIALOG_STYLES.warningFg, DIALOG_STYLES.bg);
        } else if (this.terminalEnv.tier === "legacy") {
            this.warningLabel.setText(LEGACY_NOTE);
            this.warningLabel.setColors(DIALOG_STYLES.descriptionFg, DIALOG_STYLES.bg);
        } else {
            this.warningLabel.setText("");
        }
    }

    /** Центрирует окно по экрану хоста и открывает сессию (приём DialogService). */
    private openCentered(): void {
        const host = this.host!;
        const width = this.root.getMaxIntrinsicWidth(0);
        const height = this.root.getMaxIntrinsicHeight(width);
        const px = Math.max(0, Math.floor((host.layoutSize.width - width) / 2));
        const py = Math.max(0, Math.floor((host.layoutSize.height - height) / 2));
        this.session!.setPosition(new Point(px, py));
        this.session!.open();
    }
}

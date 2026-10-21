import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VFlexElement, vflexFit, vflexFixed } from "@tuidom/elements/layout/vFlexElement";

import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    keybindingLabelStyle,
    KeybindingRegistryDIToken,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import { Component } from "../../../browser/component.ts";
import { SCM_INPUT_MESSAGE_STATE } from "../../../common/stateKeys.ts";
import { SCM_CHANGES_VIEW_ID } from "../common/scmViews.ts";

import type { ScmChangesService } from "./changesService.ts";
import { ScmChangesServiceDIToken } from "./changesService.ts";
import type { ScmRepoStateService } from "./repoStateService.ts";
import { ScmRepoStateServiceDIToken } from "./repoStateService.ts";

export const ScmInputComponentDIToken = token<ScmInputComponent>("ScmInputComponent");

/**
 * Поле, зазор, кнопка, padding снизу. Сверху padding'а нет: заголовок секции CHANGES
 * уже отбивает блок, вторая пустая строка выглядела отступом в никуда.
 */
export const SCM_INPUT_HEIGHT = 4;

/** Маркер: по нему выставляется `scmInputFocus`, на котором живёт Ctrl+Enter = commit. */
export class ScmCommitInputElement extends InputElement {}

/**
 * VS Code SCM action button. Не `ButtonElement`: тому нужен неизменяемый label и
 * естественная ширина, здесь — сменный текст по центру на всю ширину.
 */
export class ScmActionButtonElement extends TUIElement {
    public onActivate?: () => void;

    private label = "";
    private disabledState = false;

    public constructor() {
        super();
        this.focusable = true;
        this.style = {
            fg: "button.foreground",
            bg: "button.background",
            when: [
                { states: ["hover"], bg: "button.hoverBackground" },
                { states: ["focus"], bg: "button.hoverBackground" },
            ],
        };
        this.addEventListener("click", (event) => {
            if (event.defaultPrevented || this.disabledState) return;
            this.onActivate?.();
        });
    }

    public getLabel(): string {
        return this.label;
    }

    public setLabel(label: string): void {
        if (label === this.label) return;
        this.label = label;
        this.markDirty();
    }

    public isDisabled(): boolean {
        return this.disabledState;
    }

    public setDisabled(disabled: boolean): void {
        if (disabled === this.disabledState) return;
        this.disabledState = disabled;
        this.focusable = !disabled;
        this.markDirty();
    }

    public override inspectState(): Record<string, unknown> {
        return { label: this.label, disabled: this.disabledState, hidden: this.hidden };
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return 1;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const width = Number.isFinite(constraints.maxWidth) ? constraints.maxWidth : constraints.minWidth;
        return super.performLayout(BoxConstraints.tight(constraints.constrain(new Size(width, 1))));
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type !== "keydown") return;
        const keyEvent = event as TUIKeyboardEvent;
        if ((keyEvent.key === "Enter" || keyEvent.key === " ") && !this.disabledState) {
            event.preventDefault();
            this.onActivate?.();
        }
    }

    public override render(context: RenderContext): void {
        const { fg, bg } = this.resolvedStyle;
        const colors = this.disabledState
            ? { fg: this.styleVar("button.secondaryForeground"), bg: this.styleVar("button.secondaryBackground") }
            : { fg, bg };
        const width = this.layoutSize.width;
        for (let x = 0; x < width; x++) context.setCell(x, 0, { char: " ", ...colors });
        const start = Math.max(0, Math.floor((width - this.label.length) / 2));
        context.drawText(start, 0, this.label, colors, { maxWidth: width });
    }
}

export interface IScmActionButtonState {
    readonly visible: boolean;
    readonly label: string;
    readonly command: string | null;
}

/** Правила VS Code SCM action button. */
export function computeActionButton(
    hasChanges: boolean,
    repo: {
        readonly hasRepository: boolean;
        readonly branch: string | null;
        readonly upstream: string | null;
        readonly ahead: number;
        readonly behind: number;
    },
): IScmActionButtonState {
    if (!repo.hasRepository) return { visible: false, label: "", command: null };
    if (hasChanges) return { visible: true, label: "Commit", command: "git.commit" };
    if (repo.branch !== null && repo.upstream === null) {
        return { visible: true, label: "Publish Branch", command: "git.publish" };
    }
    if (repo.upstream !== null && repo.ahead + repo.behind > 0) {
        return {
            visible: true,
            label: `Sync Changes ↓${String(repo.behind)} ↑${String(repo.ahead)}`,
            command: "git.sync",
        };
    }
    return { visible: true, label: "Commit", command: null };
}

/**
 * Черновик персистится по-проектно: write-through на каждый ввод, восстановление —
 * строго после `openWorkspace`.
 */
export class ScmInputComponent extends Component implements IContextKeyContributor {
    public static dependencies = [
        StateServiceDIToken,
        ScmChangesServiceDIToken,
        ScmRepoStateServiceDIToken,
        CommandRegistryDIToken,
        ProgressServiceDIToken,
        KeybindingRegistryDIToken,
        ContextKeyServiceDIToken,
    ] as const;

    public readonly input = new ScmCommitInputElement();
    public readonly actionButton = new ScmActionButtonElement();
    public readonly view: PaddingContainerElement;

    private buttonCommand: string | null = null;

    public constructor(
        private readonly stateService: IStateService,
        private readonly changesService: ScmChangesService,
        private readonly repoState: ScmRepoStateService,
        private readonly commands: CommandRegistry,
        private readonly progress: ProgressService,
        private readonly keybindings: KeybindingRegistry,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        this.register(
            this.stateService.onDidOpenWorkspace(() => {
                this.restoreDraft();
            }),
        );
        this.input.id = "scmCommitInput";
        this.updatePlaceholder();
        this.input.onChange = (value) => {
            this.stateService.store(SCM_INPUT_MESSAGE_STATE, value);
        };

        this.actionButton.id = "scmActionButton";
        this.actionButton.onActivate = () => {
            if (this.buttonCommand !== null) this.commands.execute(this.buttonCommand);
        };

        const stack = new VFlexElement();
        stack.addChild(this.input, { height: vflexFit(), width: "fill" });
        // Понятия gap в layout-модели нет: зазор — филлер с унаследованным фоном.
        stack.addChild(new FillerElement(), { height: vflexFixed(1), width: "fill" });
        stack.addChild(this.actionButton, { height: vflexFit(), width: "fill" });
        this.view = new PaddingContainerElement(stack, { left: 1, right: 1, top: 0, bottom: 1 });
        this.view.id = "scmInputBox";
        this.view.style = { fg: "sideBar.foreground", bg: "sideBar.background" };

        this.register(
            this.changesService.onDidChangeChanges(() => {
                this.updateActionButton();
            }),
        );
        this.register(
            this.repoState.onDidChangeState(() => {
                this.updateActionButton();
            }),
        );
        this.register(
            this.progress.onDidChange(() => {
                this.updateActionButton();
            }),
        );
        // Подпись бинда переезжает: ОС и Cmd выясняются после старта (Ctrl+Enter → ⌘Enter),
        // tier — по первой CSI-u клавише (Alt+Enter → Ctrl+Enter).
        this.register(
            this.contextKeys.onDidChange((changed) => {
                // Stryker disable next-line ConditionalExpression: лишний пересчёт на постороннем ключе даёт тот же текст — ненаблюдаем.
                if (changed.has("isMac") || changed.has("macKeys") || changed.has("tier")) this.updatePlaceholder();
            }),
        );
        this.updateActionButton();
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("scmInputFocus", active instanceof ScmCommitInputElement);
    }

    /** Бинд живёт под `scmInputFocus`, а поле может быть не в фокусе — ищем «как если бы в фокусе». */
    private updatePlaceholder(): void {
        const chord = this.keybindings.getKeybindingForCommand("git.commit", this.contextKeys, {
            scmInputFocus: true,
        });
        this.input.placeholder =
            chord === undefined
                ? "Message"
                : `Message (${formatKeybinding(chord, keybindingLabelStyle(this.contextKeys))} to commit)`;
    }

    public get message(): string {
        return this.input.inputState.value;
    }

    public setMessage(value: string): void {
        this.input.inputState.value = value;
        this.stateService.store(SCM_INPUT_MESSAGE_STATE, value);
        this.input.markDirty();
    }

    public focus(): void {
        this.input.focus();
    }

    /** Строго после `openWorkspace`, без write-through. */
    public restoreDraft(): void {
        const stored = this.stateService.get(SCM_INPUT_MESSAGE_STATE);
        if (stored === this.input.inputState.value) return;
        this.input.inputState.value = stored;
        this.input.markDirty();
    }

    private updateActionButton(): void {
        const state = computeActionButton(this.changesService.changes.length > 0, {
            hasRepository: this.repoState.hasRepository,
            branch: this.repoState.state.branch,
            upstream: this.repoState.state.upstream,
            ahead: this.repoState.state.ahead,
            behind: this.repoState.state.behind,
        });
        this.buttonCommand = state.command;
        this.actionButton.hidden = !state.visible;

        // Идёт операция — подписью владеет прогресс. Дизейбл — сразу (isBusy), а показ
        // ждёт задержку: клик гаснет мгновенно, быстрая операция не мигает текстом.
        const running = this.progress.viewProgress().get(SCM_CHANGES_VIEW_ID);
        if (running !== undefined) {
            this.actionButton.setLabel(`${running.spinner} ${running.title}`);
            this.actionButton.setDisabled(true);
            return;
        }
        this.actionButton.setLabel(state.label);
        this.actionButton.setDisabled(state.command === null || this.progress.isBusy(SCM_CHANGES_VIEW_ID));
    }
}

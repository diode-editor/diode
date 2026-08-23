import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { vflexFit, vflexFixed, VFlexElement } from "@tuidom/elements/layout/vFlexElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { Component } from "../../../browser/component.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import { SCM_INPUT_MESSAGE_STATE } from "../../../common/stateKeys.ts";

import type { ScmChangesService } from "./changesService.ts";
import { ScmChangesServiceDIToken } from "./changesService.ts";
import type { ScmRepoStateService } from "./repoStateService.ts";
import { ScmRepoStateServiceDIToken } from "./repoStateService.ts";

export const ScmInputComponentDIToken = token<ScmInputComponent>("ScmInputComponent");

/**
 * Высота блока контролов коммита в строках: поле, зазор, кнопка, padding снизу.
 * Знает потребитель — `ChangesComponent` считает от неё минимальную высоту секции.
 *
 * Сверху padding'а нет: заголовок секции CHANGES уже отбивает блок от того, что
 * над ним, и вторая пустая строка выглядела отступом в никуда.
 */
export const SCM_INPUT_HEIGHT = 4;

/**
 * Маркер-подкласс поля сообщения коммита: по нему `WorkbenchContextKeys`
 * выставляет ключ `scmInputFocus` (Ctrl+Enter = commit живёт на when этого
 * ключа), а `inputWidgetFocus` наследуется от {@link InputElement} — вся
 * редактирующая механика (клипборд, undo, навигация) приходит даром.
 * Безрамочный, как в VS Code: поле выделяется фоном `input.background`,
 * фокус показывает аппаратный курсор.
 */
export class ScmCommitInputElement extends InputElement {}

/**
 * Широкая primary-кнопка действия под commit input — VS Code SCM action button:
 * label и команда меняются по состоянию репозитория ({@link computeActionButton}).
 * Отдельный элемент, а не `ButtonElement`: тому нужен неизменяемый label и
 * естественная ширина, здесь — сменный текст по центру на всю ширину плюс
 * disabled-состояние.
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

    /** Disabled: secondary-вид, не фокусируется и не активируется. */
    public setDisabled(disabled: boolean): void {
        if (disabled === this.disabledState) return;
        this.disabledState = disabled;
        this.focusable = !disabled;
        this.markDirty();
    }

    /** Наблюдаемость для инспектора/e2e. */
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

/** Состояние кнопки действия: подпись + команда (или скрыта/задизейблена). */
export interface IScmActionButtonState {
    readonly visible: boolean;
    readonly label: string;
    readonly command: string | null;
}

/**
 * Правила VS Code SCM action button: есть что коммитить → Commit; чисто и нет
 * upstream у ветки → Publish Branch; чисто и есть расхождение с upstream →
 * Sync Changes; чисто и синхронно → Commit задизейблен; вне git-репозитория
 * кнопка скрыта.
 */
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
 * Commit input box + action button вьюлета Source Control. Живёт в теле view
 * Source Control над списком изменений (собирает {@link ChangesComponent}) — как
 * в VS Code. Элементы живут полями компонента и не пересоздаются — текст
 * переживает переключения Explorer ↔ SCM сам по себе; черновик дополнительно
 * персистится по-проектно (write-through на каждый ввод, восстановление —
 * строго после `openWorkspace`).
 */
export class ScmInputComponent extends Component {
    public static dependencies = [
        StateServiceDIToken,
        ScmChangesServiceDIToken,
        ScmRepoStateServiceDIToken,
        CommandRegistryDIToken,
    ] as const;

    /** Безрамочное поле ввода (высота 1, фон `input.background`). */
    public readonly input = new ScmCommitInputElement();
    /** Кнопка Commit / Publish Branch / Sync Changes под полем. */
    public readonly actionButton = new ScmActionButtonElement();
    public readonly view: PaddingContainerElement;

    private buttonCommand: string | null = null;

    public constructor(
        private readonly stateService: IStateService,
        private readonly changesService: ScmChangesService,
        private readonly repoState: ScmRepoStateService,
        private readonly commands: CommandRegistry,
    ) {
        super();
        this.input.id = "scmCommitInput";
        this.input.placeholder = "Message (Ctrl+Enter to commit)";
        this.input.onChange = (value) => {
            this.stateService.store(SCM_INPUT_MESSAGE_STATE, value);
        };

        this.actionButton.id = "scmActionButton";
        this.actionButton.onActivate = () => {
            if (this.buttonCommand !== null) this.commands.execute(this.buttonCommand);
        };

        const stack = new VFlexElement();
        stack.addChild(this.input, { height: vflexFit(), width: "fill" });
        // Пустая строка между полем и кнопкой: понятия gap в layout-модели нет,
        // зазор — это филлер, красящий фон унаследованными цветами.
        stack.addChild(new FillerElement(), { height: vflexFixed(1), width: "fill" });
        stack.addChild(this.actionButton, { height: vflexFit(), width: "fill" });
        this.view = new PaddingContainerElement(stack, { left: 1, right: 1, top: 0, bottom: 1 });
        this.view.id = "scmInputBox";
        this.view.style = { fg: "sideBar.foreground", bg: "sideBar.background" };

        this.register(this.changesService.onDidChangeChanges(() => this.updateActionButton()));
        this.register(this.repoState.onDidChangeState(() => this.updateActionButton()));
        this.updateActionButton();
    }

    /** Текущее сообщение коммита — источник для commit-команд. */
    public get message(): string {
        return this.input.inputState.value;
    }

    /** Замена сообщения (очистка после коммита, возврат из undoCommit) — с персистом. */
    public setMessage(value: string): void {
        this.input.inputState.value = value;
        this.stateService.store(SCM_INPUT_MESSAGE_STATE, value);
        this.input.markDirty();
    }

    /** Фокус в поле ввода (команда `workbench.scm.focus`). */
    public focus(): void {
        this.input.focus();
    }

    /** Черновик из workspace-стора; строго после `openWorkspace`, без write-through. */
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
        this.actionButton.setLabel(state.label);
        this.actionButton.setDisabled(state.command === null);
    }
}

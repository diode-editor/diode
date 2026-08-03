import { PaddingContainerElement } from "../../../../../../tuidom/ui/layout/paddingContainerElement.ts";
import { InputElement } from "../../../../../../tuidom/ui/inputbox/inputElement.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { Component } from "../../../browser/component.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import { SCM_INPUT_MESSAGE_STATE } from "../../../common/stateKeys.ts";

export const ScmInputComponentDIToken = token<ScmInputComponent>("ScmInputComponent");

/**
 * Маркер-подкласс поля сообщения коммита: по нему `WorkbenchContextKeys`
 * выставляет ключ `scmInputFocus` (Ctrl+Enter = commit живёт на when этого
 * ключа), а `inputWidgetFocus` наследуется от {@link InputElement} — вся
 * редактирующая механика (клипборд, undo, навигация) приходит даром.
 */
export class ScmCommitInputElement extends InputElement {}

/**
 * Commit input box вьюлета Source Control — header контейнера над секциями
 * (как в VS Code, где input живёт в теле view над деревом ресурсов; секции
 * CHANGES/GRAPH соответствуют группам). Элемент живёт полем компонента и не
 * пересоздаётся — текст переживает переключения Explorer ↔ SCM сам по себе;
 * черновик дополнительно персистится по-проектно (write-through на каждый
 * ввод, восстановление — строго после `openWorkspace`).
 */
export class ScmInputComponent extends Component {
    public static dependencies = [StateServiceDIToken] as const;

    /** Поле ввода: рамка (3 строки) — видимый индикатор фокуса в TUI. */
    public readonly input = new ScmCommitInputElement();
    public readonly view: PaddingContainerElement;

    public constructor(private readonly stateService: IStateService) {
        super();
        this.input.id = "scmCommitInput";
        this.input.showBorder = true;
        this.input.placeholder = "Message (Ctrl+Enter to commit)";
        this.input.onChange = (value) => {
            this.stateService.store(SCM_INPUT_MESSAGE_STATE, value);
        };

        this.view = new PaddingContainerElement(this.input, { left: 1, right: 1 });
        this.view.id = "scmInputBox";
        this.view.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
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
}

import type { TUIFocusEvent } from "@tuidom/core/dom/events/tuiFocusEvent";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { Disposable } from "../../base/common/lifecycle.ts";
import { EditorElement } from "../../editor/browser/editorElement.ts";
import { isTextViewElement } from "../../editor/browser/iTextViewElement.ts";
import type { IContextKeyContributor } from "../../platform/contextkey/common/contextKeyContributor.ts";
import { ContextKeyContributorsDIToken } from "../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor, Token } from "../../platform/instantiation/common/diContainer.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../../platform/instantiation/common/diContainer.ts";
import type { IWorkspaceContextService } from "../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { IEditorGroupsService } from "../services/editor/common/editorGroupsService.ts";
import { EditorGroupsServiceDIToken } from "../services/editor/common/editorGroupsService.ts";
import type { FocusTracker } from "../services/focus/browser/focusTracker.ts";
import { FocusTrackerDIToken } from "../services/focus/browser/focusTracker.ts";
import type { HistoryService } from "../services/history/browser/historyService.ts";
import { HistoryServiceDIToken } from "../services/history/browser/historyService.ts";
import type { KeybindingDispatcher } from "../services/keybinding/browser/keybindingDispatcher.ts";
import { KeybindingDispatcherDIToken } from "../services/keybinding/browser/keybindingDispatcher.ts";

export const WorkbenchContextKeysDIToken = token<WorkbenchContextKeys>("WorkbenchContextKeys");

/**
 * Выставляет контекст-ключи workbench'а (`ContextKeys.ts`) из фокуса и состояния
 * сервисов: слушает FocusManager корневой view (capture-листенеры focus/blur
 * вешает владелец дерева — `WorkbenchComponent` — на {@link handleFocusChange})
 * и сервисы Editor/History. Хук
 * `KeybindingDispatcher.updateContextKeys` замкнут на {@link update} — перед
 * резолвом каждого биндинга ключи свежие.
 *
 * Здесь живут только ключи workbench-уровня. Ключи фич выставляют сами фичи
 * ({@link IContextKeyContributor}, явный список `ContextKeyContributorsDIToken`):
 * центр опрашивает их в том же {@link update}, поэтому тайминг у них общий.
 * Ключи с единственной точкой перехода пушит их владелец: окружение терминала —
 * `TerminalEnvContextKeysContribution`, `panelVisible` — `LayoutService`.
 *
 * Корневая view приходит через late-init шов {@link attachView} (как
 * `attachHost` у DialogService): до прикрепления фокуса нет — активный элемент
 * считается `null`.
 */
export class WorkbenchContextKeys extends Disposable {
    public static dependencies = [
        ContextKeyServiceDIToken,
        EditorGroupsServiceDIToken,
        KeybindingDispatcherDIToken,
        HistoryServiceDIToken,
        FocusTrackerDIToken,
        ServiceAccessorDIToken,
        ContextKeyContributorsDIToken,
        IWorkspaceContextServiceDIToken,
    ] as const;

    private view: BodyElement | null = null;
    /** Фичи со своими ключами — резолвятся сразу, чтобы порядок подъёма сервисов не зависел от первого нажатия. */
    private readonly contributors: readonly IContextKeyContributor[];

    public constructor(
        private readonly contextKeys: ContextKeyService,
        private readonly groups: IEditorGroupsService,
        private readonly dispatcher: KeybindingDispatcher,
        private readonly historyService: HistoryService,
        private readonly focusTracker: FocusTracker,
        accessor: ServiceAccessor,
        contributorTokens: readonly Token<IContextKeyContributor>[],
        private readonly workspaceContext: Pick<IWorkspaceContextService, "getWorkbenchState">,
    ) {
        super();
        this.contributors = contributorTokens.map((contributor) => accessor.get(contributor));
        // Диспатчер освежает ключи перед резолвом каждого биндинга.
        this.dispatcher.updateContextKeys = () => {
            this.update();
        };
    }

    /** Прикрепляет корневую view — источник фокуса (зовёт владелец дерева после её постройки). */
    public attachView(view: BodyElement): void {
        this.view = view;
    }

    /** Смена фокуса: сброс незавершённого чорда, пересчёт ключей, событие {@link FocusTracker}. */
    public handleFocusChange = (_event: TUIFocusEvent): void => {
        this.dispatcher.cancelPendingChord();
        this.update();
        // Подписчики (попапы редактора гаснут, когда фокус ушёл с редактора)
        // видят уже освежённый контекст.
        this.focusTracker.fire(this.activeElement());
    };

    public update(): void {
        const active = this.activeElement();
        const editorCount = this.groups.activeGroup.editorCount;

        this.contextKeys.set("textInputFocus", active instanceof EditorElement);
        // Исторически шире, чем textInputFocus: сюда попадала и рисованная
        // смотрелка диффа. С диффом v2 (стороны — настоящие редакторы) ключи
        // совпали по значению; оба живут ради семантики when-клауз — «команде
        // нужна каретка» против «команде нужен ввод» (мутирующие дополнительно
        // гейтятся `!editorReadonly`).
        this.contextKeys.set("textViewFocus", isTextViewElement(active));
        // Upstream-имена для `when` расширений: их манифесты пишут
        // `editorTextFocus` и `editorLangId`, а не наши ключи.
        this.contextKeys.set("editorTextFocus", active instanceof EditorElement);
        this.contextKeys.set("editorLangId", isTextViewElement(active) ? active.viewState.document.languageId : "");
        // Парный к textViewFocus: мутирующие команды висят на
        // `textInputFocus && !editorReadonly` — наш аналог `EditorContextKeys.writable`
        // (в VS Code это `readOnly.toNegated()`). Без фокуса в тексте ключ
        // сбрасывается в false, иначе он залипал бы от прошлого редактора.
        this.contextKeys.set("editorReadonly", isTextViewElement(active) && active.readOnly);
        // Гейт Escape у `removeSecondaryCursors`: без него Escape перехватывался бы всегда,
        // хотя убирать нечего. Отдельной подписки на курсор не нужно — диспетчер зовёт
        // `update()` перед каждым резолвом биндинга.
        this.contextKeys.set(
            "editorHasMultipleSelections",
            isTextViewElement(active) && active.viewState.selections.length > 1,
        );
        this.contextKeys.set("inputWidgetFocus", active instanceof InputElement);
        this.contextKeys.set("listFocus", active instanceof TreeViewElement || active instanceof ListViewElement);
        this.contextKeys.set("editorGroupHasEditors", editorCount > 0);
        this.contextKeys.set("editorTabsMultiple", editorCount > 1);
        this.contextKeys.set("multipleEditorGroups", this.groups.groups.length > 1);
        this.contextKeys.set("canNavigateBack", this.historyService.canGoBack);
        this.contextKeys.set("canNavigateForward", this.historyService.canGoForward);
        this.contextKeys.set("activeEditorGroupEmpty", editorCount === 0);
        this.contextKeys.set("activeEditorGroupIndex", this.groups.viewColumnOf(this.groups.activeGroup));
        this.contextKeys.set(
            "activeEditorGroupLast",
            this.groups.activeGroup === this.groups.groups[this.groups.groups.length - 1],
        );
        this.contextKeys.set("terminalFocus", active instanceof TerminalViewElement);
        // Upstream-ключ: команды воркспейса (Open Workspace Settings) в палитре
        // только при открытой папке.
        this.contextKeys.set("workbenchState", this.workspaceContext.getWorkbenchState());
        // Ключи фич — у самих фич (IContextKeyContributor), тайминг тот же.
        for (const contributor of this.contributors) {
            contributor.updateContextKeys(this.contextKeys, active);
        }
    }

    private activeElement(): TUIElement | null {
        return this.view?.focusManager?.activeElement ?? null;
    }
}

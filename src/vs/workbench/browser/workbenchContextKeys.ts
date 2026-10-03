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
import { registerContextKeys } from "../../platform/contextkey/common/contextKeys.ts";
import type { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor, Token } from "../../platform/instantiation/common/diContainer.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../../platform/instantiation/common/diContainer.ts";
import { macKeysLevel } from "../../platform/keybinding/common/macKeys.ts";
import type { InputWidgetService } from "../contrib/files/browser/inputWidgetService.ts";
import { InputWidgetServiceDIToken } from "../contrib/files/browser/inputWidgetService.ts";
import { ScmCommitInputElement } from "../contrib/scm/browser/scmInputComponent.ts";
import type { TerminalService } from "../contrib/terminal/browser/terminalService.ts";
import { TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";
import type { FocusTracker } from "../services/focus/browser/focusTracker.ts";
import { FocusTrackerDIToken } from "../services/focus/browser/focusTracker.ts";
import type { HistoryService } from "../services/history/browser/historyService.ts";
import { HistoryServiceDIToken } from "../services/history/browser/historyService.ts";
import type { KeybindingDispatcher } from "../services/keybinding/browser/keybindingDispatcher.ts";
import { KeybindingDispatcherDIToken } from "../services/keybinding/browser/keybindingDispatcher.ts";
import type { LayoutService } from "../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../services/layout/browser/layoutService.ts";
import type { TerminalEnvironmentService } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";
import { TerminalEnvironmentServiceDIToken } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";

import type { TabSwitcherComponent } from "./parts/editor/tabSwitcherComponent.ts";
import { TabSwitcherComponentDIToken } from "./parts/editor/tabSwitcherComponent.ts";

export const WorkbenchContextKeysDIToken = token<WorkbenchContextKeys>("WorkbenchContextKeys");

/**
 * Выставляет контекст-ключи workbench'а (`ContextKeys.ts`) из фокуса и состояния
 * сервисов: слушает FocusManager корневой view (capture-листенеры focus/blur
 * вешает владелец дерева — `WorkbenchComponent` — на {@link handleFocusChange})
 * и сервисы Editor/Layout/Terminal/TerminalEnvironment. Хук
 * `KeybindingDispatcher.updateContextKeys` замкнут на {@link update} — перед
 * резолвом каждого биндинга ключи свежие.
 *
 * Здесь живут только ключи workbench-уровня. Ключи фич выставляют сами фичи
 * ({@link IContextKeyContributor}, явный список `ContextKeyContributorsDIToken`):
 * центр опрашивает их в том же {@link update}, поэтому тайминг у них общий.
 *
 * Корневая view приходит через late-init шов {@link attachView} (как
 * `attachHost` у DialogService): до прикрепления фокуса нет — активный элемент
 * считается `null`.
 */
export class WorkbenchContextKeys extends Disposable {
    public static dependencies = [
        ContextKeyServiceDIToken,
        EditorServiceDIToken,
        TerminalServiceDIToken,
        TerminalEnvironmentServiceDIToken,
        InputWidgetServiceDIToken,
        KeybindingDispatcherDIToken,
        LayoutServiceDIToken,
        HistoryServiceDIToken,
        TabSwitcherComponentDIToken,
        FocusTrackerDIToken,
        ServiceAccessorDIToken,
        ContextKeyContributorsDIToken,
    ] as const;

    private view: BodyElement | null = null;
    /** Фичи со своими ключами — резолвятся сразу, чтобы порядок подъёма сервисов не зависел от первого нажатия. */
    private readonly contributors: readonly IContextKeyContributor[];

    public constructor(
        private readonly contextKeys: ContextKeyService,
        private readonly editorService: EditorService,
        private readonly terminalService: TerminalService,
        private readonly terminalEnv: TerminalEnvironmentService,
        private readonly inputWidgetService: InputWidgetService,
        private readonly dispatcher: KeybindingDispatcher,
        private readonly layoutService: LayoutService,
        private readonly historyService: HistoryService,
        private readonly tabSwitcher: TabSwitcherComponent,
        private readonly focusTracker: FocusTracker,
        accessor: ServiceAccessor,
        contributorTokens: readonly Token<IContextKeyContributor>[],
    ) {
        super();
        this.contributors = contributorTokens.map((contributor) => accessor.get(contributor));
        // Make custom-mode names (mode_<name>) valid `when` identifiers, then keep context
        // keys in sync when the environment changes (detection finalize / mode toggle);
        // сегмент статус-бара обновляет TerminalEnvStatusContribution по тому же событию.
        registerContextKeys(this.terminalEnv.getKnownModeNames().map((n) => `mode_${n}`));
        this.register(
            this.terminalEnv.onDidChange(() => {
                this.update();
            }),
        );
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
        const editorCount = this.editorService.editorCount;

        this.contextKeys.set("textInputFocus", active instanceof EditorElement);
        // Исторически шире, чем textInputFocus: сюда попадала и рисованная
        // смотрелка диффа. С диффом v2 (стороны — настоящие редакторы) ключи
        // совпали по значению; оба живут ради семантики when-клауз — «команде
        // нужна каретка» против «команде нужен ввод» (мутирующие дополнительно
        // гейтятся `!editorReadonly`).
        this.contextKeys.set("textViewFocus", isTextViewElement(active));
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
        this.contextKeys.set("scmInputFocus", active instanceof ScmCommitInputElement);
        this.contextKeys.set("listFocus", active instanceof TreeViewElement || active instanceof ListViewElement);
        this.inputWidgetService.setActive(active instanceof InputElement ? active : null);
        this.contextKeys.set("editorGroupHasEditors", editorCount > 0);
        this.contextKeys.set("editorTabsMultiple", editorCount > 1);
        this.contextKeys.set("multipleEditorGroups", this.editorService.groups.length > 1);
        this.contextKeys.set("canNavigateBack", this.historyService.canGoBack);
        this.contextKeys.set("canNavigateForward", this.historyService.canGoForward);
        this.contextKeys.set("activeEditorGroupEmpty", editorCount === 0);
        this.contextKeys.set("activeEditorGroupIndex", this.editorService.viewColumnOf(this.editorService.activeGroup));
        this.contextKeys.set(
            "activeEditorGroupLast",
            this.editorService.activeGroup === this.editorService.groups[this.editorService.groups.length - 1],
        );
        // Фокус в дереве Explorer — по пути предков до его view (id
        // "explorerView" ставит ExplorerComponent): нового шва к компоненту не нужно.
        this.contextKeys.set(
            "filesExplorerFocus",
            active?.getAncestorPath().some((element) => element.id === "explorerView") === true,
        );
        this.contextKeys.set("panelVisible", this.layoutService.isPanelVisible());
        // Спрашиваем ВИДИМОСТЬ оверлея, а не состояние серии в модели: список
        // гаснет и помимо конца серии (уход из группы), а стрелки обязаны
        // вернуться редактору ровно тогда, когда список исчез с экрана.
        this.contextKeys.set("tabSwitcherVisible", this.tabSwitcher.isOpen());
        this.contextKeys.set("terminalFocus", active instanceof TerminalViewElement);
        this.contextKeys.set("terminalIsOpen", this.terminalService.hasOpenTerminals);
        // Ключи фич — у самих фич (IContextKeyContributor), тайминг тот же.
        for (const contributor of this.contributors) {
            contributor.updateContextKeys(this.contextKeys, active);
        }

        // Terminal environment (tier / capabilities / modes / OS) — mostly static per session,
        // but mode can be force-toggled at runtime, so refresh alongside focus context.
        const env = this.terminalEnv;
        this.contextKeys.set("tier", env.tier);
        this.contextKeys.set("os", env.os);
        this.contextKeys.set("isMac", env.os === "mac");
        this.contextKeys.set("isLinux", env.os === "linux");
        this.contextKeys.set("isWindows", env.os === "windows");
        this.contextKeys.set("cap_extendedKeys", env.hasCapability("extended-keys"));
        this.contextKeys.set("cap_osc52", env.hasCapability("osc52"));
        this.contextKeys.set("cap_truecolor", env.hasCapability("truecolor"));
        this.contextKeys.set("cap_kittyGraphics", env.hasCapability("kitty-graphics"));
        this.contextKeys.set("cap_mouseSgr", env.hasCapability("mouse-sgr"));
        this.contextKeys.set("cap_super", env.hasCapability("super"));
        this.contextKeys.set("macKeys", macKeysLevel(env.macKeysRung));
        for (const name of env.getKnownModeNames()) {
            this.contextKeys.setRaw(`mode_${name}`, env.isModeActive(name));
        }
    }

    private activeElement(): TUIElement | null {
        return this.view?.focusManager?.activeElement ?? null;
    }
}

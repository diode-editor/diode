import { Disposable } from "@tuidom/core/common/disposable";
import type { TUIFocusEvent } from "@tuidom/core/dom/events/tuiFocusEvent";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";
import { EditorElement } from "../../editor/browser/editorElement.ts";
import { isTextViewElement } from "../../editor/browser/iTextViewElement.ts";
import { registerContextKeys } from "../../platform/contextkey/common/contextKeys.ts";
import type { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { InputWidgetService } from "../contrib/files/browser/inputWidgetService.ts";
import { InputWidgetServiceDIToken } from "../contrib/files/browser/inputWidgetService.ts";
import type { FindService } from "../contrib/find/browser/findService.ts";
import { FindServiceDIToken } from "../contrib/find/browser/findService.ts";
import { SCM_VIEWLET_ID } from "../contrib/scm/browser/changesComponent.ts";
import { ScmCommitInputElement } from "../contrib/scm/browser/scmInputComponent.ts";
import type { SearchComponent } from "../contrib/search/browser/searchComponent.ts";
import { SEARCH_VIEWLET_ID, SearchComponentDIToken } from "../contrib/search/browser/searchComponent.ts";
import type { CompletionService } from "../contrib/suggest/browser/completionService.ts";
import { CompletionServiceDIToken } from "../contrib/suggest/browser/completionService.ts";
import type { TerminalService } from "../contrib/terminal/browser/terminalService.ts";
import { TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";
import type { HistoryService } from "../services/history/browser/historyService.ts";
import { HistoryServiceDIToken } from "../services/history/browser/historyService.ts";
import type { KeybindingDispatcher } from "../services/keybinding/browser/keybindingDispatcher.ts";
import { KeybindingDispatcherDIToken } from "../services/keybinding/browser/keybindingDispatcher.ts";
import type { LayoutService } from "../services/layout/browser/layoutService.ts";
import { LayoutServiceDIToken } from "../services/layout/browser/layoutService.ts";
import type { TerminalEnvironmentService } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";
import { TerminalEnvironmentServiceDIToken } from "../services/terminalEnvironment/node/terminalEnvironmentService.ts";

import type { SidebarService } from "./parts/sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";

export const WorkbenchContextKeysDIToken = token<WorkbenchContextKeys>("WorkbenchContextKeys");

/**
 * Выставляет контекст-ключи workbench'а (`ContextKeys.ts`) из фокуса и состояния
 * сервисов: слушает FocusManager корневой view (capture-листенеры focus/blur
 * вешает владелец дерева — `WorkbenchComponent` — на {@link handleFocusChange})
 * и сервисы Editor/Find/Completion/Terminal/TerminalEnvironment. Хук
 * `KeybindingDispatcher.updateContextKeys` замкнут на {@link update} — перед
 * резолвом каждого биндинга ключи свежие.
 *
 * Корневая view приходит через late-init шов {@link attachView} (как
 * `attachHost` у DialogService): до прикрепления фокуса нет — активный элемент
 * считается `null`.
 */
export class WorkbenchContextKeys extends Disposable {
    public static dependencies = [
        ContextKeyServiceDIToken,
        EditorServiceDIToken,
        FindServiceDIToken,
        CompletionServiceDIToken,
        TerminalServiceDIToken,
        TerminalEnvironmentServiceDIToken,
        InputWidgetServiceDIToken,
        KeybindingDispatcherDIToken,
        LayoutServiceDIToken,
        SidebarServiceDIToken,
        SearchComponentDIToken,
        HistoryServiceDIToken,
    ] as const;

    private view: BodyElement | null = null;

    public constructor(
        private readonly contextKeys: ContextKeyService,
        private readonly editorService: EditorService,
        private readonly findService: FindService,
        private readonly completionService: CompletionService,
        private readonly terminalService: TerminalService,
        private readonly terminalEnv: TerminalEnvironmentService,
        private readonly inputWidgetService: InputWidgetService,
        private readonly dispatcher: KeybindingDispatcher,
        private readonly layoutService: LayoutService,
        private readonly sidebarService: SidebarService,
        private readonly searchComponent: SearchComponent,
        private readonly historyService: HistoryService,
    ) {
        super();
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

    /** Смена фокуса: сброс незавершённого чорда + пересчёт ключей + закрытие suggest-попапа. */
    public handleFocusChange = (_event: TUIFocusEvent): void => {
        this.dispatcher.cancelPendingChord();
        this.update();
        // Фокус ушёл с редактора (клавиатурный путь: Ctrl+Tab, Quick Open) —
        // закрываем suggest-попап (клик-фокус уже покрыт close-on-outside).
        const active = this.activeElement();
        this.completionService.onFocusChanged(active instanceof EditorElement);
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
            this.editorService.activeGroup ===
                this.editorService.groups[this.editorService.groups.length - 1],
        );
        // Фокус в дереве Explorer — по пути предков до его view (id
        // "explorerView" ставит ExplorerComponent): нового шва к компоненту не нужно.
        this.contextKeys.set(
            "filesExplorerFocus",
            active !== null && active.getAncestorPath().some((element) => element.id === "explorerView"),
        );
        this.contextKeys.set("panelVisible", this.layoutService.isPanelVisible());
        this.contextKeys.set(
            "searchViewletVisible",
            this.layoutService.isSidebarVisible() && this.sidebarService.getActiveViewletId() === SEARCH_VIEWLET_ID,
        );
        // Фокусные ключи поиска: сам компонент знает свои инпуты и корень view.
        this.contextKeys.set("searchViewletFocus", this.searchComponent.containsFocus(active));
        this.contextKeys.set("searchInputBoxFocus", this.searchComponent.isInputBoxFocused(active));
        this.contextKeys.set("firstMatchFocus", this.searchComponent.isFirstResultFocused(active));
        this.contextKeys.set(
            "scmViewletVisible",
            this.layoutService.isSidebarVisible() && this.sidebarService.getActiveViewletId() === SCM_VIEWLET_ID,
        );
        this.contextKeys.set("findWidgetVisible", this.findService.isVisible());
        this.contextKeys.set("suggestWidgetVisible", this.completionService.isOpen());
        this.contextKeys.set("terminalFocus", active instanceof TerminalViewElement);
        this.contextKeys.set("terminalIsOpen", this.terminalService.hasOpenTerminals);

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
        for (const name of env.getKnownModeNames()) {
            this.contextKeys.setRaw(`mode_${name}`, env.isModeActive(name));
        }
    }

    private activeElement(): TUIElement | null {
        return this.view?.focusManager?.activeElement ?? null;
    }
}

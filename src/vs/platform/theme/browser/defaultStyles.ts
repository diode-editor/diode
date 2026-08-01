import type { IListViewStyles } from "../../../../../tuidom/ui/list/listViewElement.ts";
import type { ITreeViewStyles } from "../../../../../tuidom/ui/tree/treeViewElement.ts";
import { unthemedTreeViewStyles } from "../../../../../tuidom/ui/tree/treeViewElement.ts";
import type { IEditorStyles } from "../../../editor/browser/editorElement.ts";
import { unthemedEditorStyles } from "../../../editor/browser/editorElement.ts";
import type { IDialogStyles } from "../../../workbench/browser/parts/dialogs/dialogComponent.ts";
import type { IFindWidgetStyles } from "../../../workbench/contrib/find/browser/findComponent.ts";
import type { IWorkbenchColors } from "../common/colors/colorContributions.ts";
import type { WorkbenchTheme } from "../common/workbenchTheme.ts";

/**
 * Мост тема → стили контролов TUIDom: единственное место, где ключи темы
 * (`button.*`, `menu.*`, …) резолвятся в packed-цвета styles-интерфейсов
 * виджетов. Сами виджеты про темы не знают — контроллеры зовут эти функции
 * и передают результат в `setStyles(...)`.
 */

/**
 * Окна модальных диалогов (`DialogComponent` и наследники): фон/текст/рамка —
 * ключи VS Code `editorWidget.*` (диалоги рисуются как editor-widget), пояснения —
 * `descriptionForeground`, ссылки — `textLink.foreground`, предупреждения —
 * `editorWarning.foreground`. Все ключи гарантированы реестром дефолтов.
 */
export function getDialogStyles(theme: WorkbenchTheme): IDialogStyles {
    return {
        bg: theme.getRequiredColor("editorWidget.background"),
        fg: theme.getRequiredColor("editorWidget.foreground"),
        borderFg: theme.getRequiredColor("editorWidget.border"),
        descriptionFg: theme.getRequiredColor("descriptionForeground"),
        warningFg: theme.getRequiredColor("editorWarning.foreground"),
        linkFg: theme.getRequiredColor("textLink.foreground"),
    };
}

/**
 * Find-виджет рисуется как editor-widget: фон/текст/рамка — ключи VS Code
 * `editorWidget.*`, счётчик совпадений — `descriptionForeground`, «No results» —
 * `editorError.foreground`. Все
 * ключи гарантированы реестром дефолтов.
 */
export function getFindWidgetStyles(theme: WorkbenchTheme): IFindWidgetStyles {
    return {
        bg: theme.getRequiredColor("editorWidget.background"),
        fg: theme.getRequiredColor("editorWidget.foreground"),
        borderFg: theme.getRequiredColor("editorWidget.border"),
        counterFg: theme.getRequiredColor("descriptionForeground"),
        noResultsFg: theme.getRequiredColor("editorError.foreground"),
    };
}

/**
 * Специализированные цвета редактора. Основные fg/bg (`editor.foreground`/
 * `editor.background`) сюда не входят — они идут через `editor.style = { fg, bg }`
 * (наследование TUIStyle). Ключи с реестровым дефолтом читаются через
 * `getRequiredColor`; genuinely-optional ключи (`editorGutter.*`,
 * `editorIndentGuide.*` — без реестрового дефолта) — через `getColor` с
 * фоллбэком: гуттер падает на фон редактора (как в VS Code), остальные — на
 * unthemed-baseline. Контекстное меню редактора едет тем же каналом (`menu`).
 */
export function getEditorStyles(theme: WorkbenchTheme): IEditorStyles {
    return {
        gutterBackground: theme.getColor("editorGutter.background") ?? theme.getRequiredColor("editor.background"),
        lineNumberForeground: theme.getRequiredColor("editorLineNumber.foreground"),
        lineNumberActiveForeground: theme.getRequiredColor("editorLineNumber.activeForeground"),
        occurrenceHighlightBackground: theme.getRequiredColor("editor.wordHighlightBackground"),
        foldingControlForeground:
            theme.getColor("editorGutter.foldingControlForeground") ?? unthemedEditorStyles.foldingControlForeground,
        indentGuideForeground:
            theme.getColor("editorIndentGuide.background1") ?? unthemedEditorStyles.indentGuideForeground,
        indentGuideActiveForeground:
            theme.getColor("editorIndentGuide.activeBackground1") ?? unthemedEditorStyles.indentGuideActiveForeground,
        errorForeground: theme.getRequiredColor("editorError.foreground"),
        warningForeground: theme.getRequiredColor("editorWarning.foreground"),
        infoForeground: theme.getRequiredColor("editorInfo.foreground"),
        hintForeground: theme.getRequiredColor("editorHint.foreground"),
    };
}

/** Общая для деревьев часть `list.*`: выделение/hover как в VS Code list. */
function getListSelectionStyles(theme: WorkbenchTheme) {
    return {
        activeSelectionBg: theme.getRequiredColor("list.activeSelectionBackground"),
        activeSelectionFg: theme.getRequiredColor("list.activeSelectionForeground"),
        inactiveSelectionBg: theme.getRequiredColor("list.inactiveSelectionBackground"),
        inactiveSelectionFg: theme.getRequiredColor("list.inactiveSelectionForeground"),
        hoverBg: theme.getRequiredColor("list.hoverBackground"),
        hoverFg: theme.getColor("list.hoverForeground"),
    };
}

/**
 * Дерево файлов (Explorer): помимо выделения темизирует приглушение
 * «вырезанных» строк и стрелку симлинка (`list.deemphasizedForeground`).
 */
/**
 * Виртуализирующий список (ListViewElement): выделение/hover из общих
 * `list.*`-токенов, шеврон сворачиваемых строк — приглушённым цветом.
 */
export function getListViewStyles(theme: WorkbenchTheme): IListViewStyles {
    return {
        ...getListSelectionStyles(theme),
        chevronFg: theme.getRequiredColor("list.deemphasizedForeground"),
    };
}

export function getFileTreeStyles(theme: WorkbenchTheme): ITreeViewStyles {
    return {
        ...getListSelectionStyles(theme),
        cutFg: theme.getRequiredColor("list.deemphasizedForeground"),
        symlinkFg: theme.getRequiredColor("list.deemphasizedForeground"),
    };
}

/**
 * Дерево Problems: cut/symlink-декораций у него нет, эти цвета остаются
 * unthemed-дефолтами (исторически Problems-дерево их не задавало).
 */
export function getProblemsTreeStyles(theme: WorkbenchTheme): ITreeViewStyles {
    return {
        ...getListSelectionStyles(theme),
        cutFg: unthemedTreeViewStyles.cutFg,
        symlinkFg: unthemedTreeViewStyles.symlinkFg,
    };
}

import { DEFAULT_COLOR, packRgb } from "../../common/colorUtils.ts";

import type { StyleVarScope } from "./tuiStyle.ts";

/**
 * Дефолтные значения цветовых токенов tuidom — единственное место, где у
 * виджетов tuidom/ui есть RGB-литералы. Правило: токен, на который ссылается
 * виджет, ОБЯЗАН иметь строку здесь — иначе резолв без хостовой таблицы
 * (тесты, stories, standalone-использование) упадёт fail-fast'ом.
 *
 * Имена — в конвенции color id VS Code ("list.activeSelectionBackground"),
 * чтобы хост перекрывал дефолты ключами своей темы без функций-мостов;
 * tuidom-специфика без темного эквивалента — под собственным именем
 * ("menu.shortcutForeground", "quickPick.*", "titledPanel.*", "menuBar.*").
 * Значения — только конкретные числа (packed RGB | DEFAULT_COLOR); сентинелы
 * INHERITED_* в таблицах запрещены (проверяется в setStyleVars).
 *
 * Дефолты сохраняют исторический вид unthemed-палитр, которые сюда переехали
 * (Н3): под управлением хоста всё перекрывается активной темой.
 */
export const STYLE_TOKEN_DEFAULTS = {
    // ── Кнопка (base = secondary-вид, focus/checked = primary) ──
    "button.foreground": packRgb(255, 255, 255),
    "button.background": packRgb(0, 120, 215),
    "button.hoverBackground": packRgb(26, 134, 224),
    "button.secondaryForeground": packRgb(204, 204, 204),
    "button.secondaryBackground": packRgb(60, 60, 60),
    "button.secondaryHoverBackground": packRgb(69, 73, 78),

    // ── Меню (попапы, дропдауны, контекстные) ──
    "menu.foreground": packRgb(204, 204, 204),
    "menu.background": packRgb(37, 37, 38),
    "menu.selectionForeground": packRgb(255, 255, 255),
    "menu.selectionBackground": packRgb(4, 57, 94),
    "menu.border": packRgb(83, 83, 83),
    "menu.separatorBackground": packRgb(83, 83, 83),
    "menu.shortcutForeground": packRgb(128, 128, 128),

    // ── Полоса меню ──
    "menuBar.foreground": DEFAULT_COLOR,
    "menuBar.background": packRgb(64, 64, 64),
    "menubar.selectionForeground": packRgb(255, 255, 255),
    "menubar.selectionBackground": packRgb(0, 90, 180),

    // ── Списки и деревья ──
    "list.activeSelectionBackground": packRgb(4, 57, 94),
    "list.activeSelectionForeground": packRgb(255, 255, 255),
    "list.inactiveSelectionBackground": packRgb(55, 55, 61),
    "list.inactiveSelectionForeground": packRgb(204, 204, 204),
    "list.hoverBackground": packRgb(42, 45, 46),
    "list.deemphasizedForeground": packRgb(150, 150, 150),
    "list.highlightForeground": packRgb(100, 200, 255),

    // ── Скроллбар (фон колонки наследуется каскадом от хозяина) ──
    "scrollbarSlider.background": packRgb(100, 100, 100),
    "scrollbar.background": packRgb(50, 50, 50),

    // ── Вкладки редактора ──
    "tab.activeForeground": packRgb(255, 255, 255),
    "tab.activeBackground": packRgb(30, 30, 30),
    "tab.inactiveForeground": packRgb(150, 150, 150),
    "tab.inactiveBackground": packRgb(45, 45, 45),
    "editorGroupHeader.tabsBackground": packRgb(37, 37, 38),

    // ── Панель ──
    "panel.background": packRgb(24, 24, 24),
    "panelTitle.inactiveForeground": packRgb(142, 142, 142),
    "panel.border": packRgb(43, 43, 43),
    "titledPanel.titleForeground": packRgb(130, 130, 130),

    // ── Терминал ──
    "terminal.foreground": DEFAULT_COLOR,
    "terminal.background": DEFAULT_COLOR,

    // ── Селектбокс ──
    "dropdown.foreground": packRgb(240, 240, 240),
    "dropdown.background": packRgb(60, 60, 60),
    "dropdown.border": packRgb(60, 60, 60),
    "dropdown.listBackground": packRgb(37, 37, 38),

    // ── Инпут ──
    "input.foreground": packRgb(204, 204, 204),
    "input.background": packRgb(60, 60, 60),
    "input.placeholderForeground": packRgb(110, 110, 110),
    "input.border": packRgb(60, 60, 60),
    "input.selectionBackground": packRgb(38, 79, 120),
    focusBorder: packRgb(0, 127, 212),

    // ── Sash ──
    "sash.hoverBorder": packRgb(0, 120, 215),

    // ── Квик-пик ──
    "quickInput.foreground": packRgb(204, 204, 204),
    "quickInput.background": packRgb(37, 37, 38),
    "quickPick.border": packRgb(83, 83, 83),
    "quickPick.badgeForeground": packRgb(150, 190, 100),
    "quickPick.shortcutForeground": packRgb(128, 128, 128),
    "quickPick.hintForeground": packRgb(100, 150, 200),
    "quickPick.titleForeground": packRgb(230, 230, 230),
    "quickPick.promptForeground": packRgb(140, 140, 140),
    descriptionForeground: packRgb(125, 125, 125),

    // ── Автодополнение ──
    "editorSuggestWidget.border": packRgb(83, 83, 83),
    "editorSuggestWidget.background": packRgb(34, 34, 40),
    "editorSuggestWidget.foreground": packRgb(204, 204, 204),
    "editorSuggestWidget.selectedBackground": packRgb(56, 62, 90),
    "editorSuggestWidget.selectedForeground": packRgb(255, 255, 255),
    "editorSuggestWidget.iconForeground": packRgb(130, 170, 255),
    "editorSuggestWidget.detailForeground": packRgb(120, 120, 130),

    // ── Виджеты редактора (диалоги, find) ──
    "editorWidget.foreground": packRgb(204, 204, 204),
    "editorWidget.background": packRgb(37, 37, 38),
    "editorWidget.border": packRgb(69, 69, 69),
    "textLink.foreground": packRgb(55, 148, 255),

    // ── Редактор ──
    "editorLineNumber.foreground": packRgb(133, 133, 133),
    "editorLineNumber.activeForeground": packRgb(198, 198, 198),
    "editor.wordHighlightBackground": packRgb(71, 71, 71),
    "editorGutter.foldingControlForeground": packRgb(197, 197, 197),
    "editorIndentGuide.background1": packRgb(64, 64, 64),
    "editorIndentGuide.activeBackground1": packRgb(112, 112, 112),
    "editorError.foreground": packRgb(241, 76, 76),
    "editorWarning.foreground": packRgb(204, 167, 0),
    "editorInfo.foreground": packRgb(55, 148, 255),
    "editorHint.foreground": packRgb(238, 238, 238),

    // ── Diff ──
    "diffEditor.insertedLineBackground": 0x373d29,
    "diffEditor.removedLineBackground": 0x4b1818,
    "diffEditor.unchangedRegionForeground": 0x8c8c8c,
} satisfies Record<string, number>;

/** Литеральный union имён токенов tuidom — автокомплит и проверка внутри tuidom/ui. */
export type StyleToken = keyof typeof STYLE_TOKEN_DEFAULTS;

/**
 * Публичный тип имени токена: автокомплит по дефолтам сохраняется, но хост
 * может ссылаться на произвольные ключи своей темы — опечатки в них ловит
 * рантайм-fail-fast резолва (в первом же кадре), не компилятор.
 */
export type AnyStyleToken = StyleToken | (string & {});

/**
 * Дно прототипной цепочки var-scope'ов: замороженные дефолты с null-прототипом
 * (лукап по цепочке не должен находить ключи Object.prototype). Пользовательские
 * таблицы (setStyleVars) ложатся ПОВЕРХ через Object.create.
 */
export const ROOT_VAR_SCOPE: StyleVarScope = Object.freeze(
    Object.assign(Object.create(null) as Record<string, number>, STYLE_TOKEN_DEFAULTS),
);

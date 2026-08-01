import { packRgb } from "../../common/colorUtils.ts";

import type { StyleVarScope } from "./tuiStyle.ts";

/**
 * Дефолтные значения цветовых токенов tuidom — единственное место, где у
 * виджетов tuidom/ui есть RGB-литералы. Правило: токен, на который ссылается
 * виджет, ОБЯЗАН иметь строку здесь — иначе резолв без хостовой таблицы
 * (тесты, stories, standalone-использование) упадёт fail-fast'ом.
 *
 * Имена — в конвенции color id VS Code ("list.activeSelectionBackground"),
 * чтобы хост перекрывал дефолты ключами своей темы без функций-мостов;
 * tuidom-специфика без темного эквивалента — под собственным именем.
 * Значения — только конкретные числа (packed RGB | DEFAULT_COLOR); сентинелы
 * INHERITED_* в таблицах запрещены (проверяется в setStyleVars).
 */
export const STYLE_TOKEN_DEFAULTS = {
    "list.activeSelectionBackground": packRgb(4, 57, 94),
    "list.activeSelectionForeground": packRgb(255, 255, 255),
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

import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Disposable } from "../../base/common/lifecycle.ts";

/**
 * Компонент владеет корневым контролом ({@link view}), но не наследует
 * TUIElement. Отдельных mount()/activate() нет: всё — в конструкторе,
 * async-инициализация живёт в сервисах (`IActivatable`). Цвета — ИМЕНАМИ
 * токенов один раз при создании (Н3): hot-swap темы разъезжается каскадом.
 */
export abstract class Component extends Disposable {
    public abstract readonly view: TUIElement;
}

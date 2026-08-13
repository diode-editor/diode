import { Disposable } from "@tuidom/all/common/disposable";
import type { TUIElement } from "@tuidom/all/dom/tuiElement";

/**
 * База компонентов Workbench. Компонент владеет корневым контролом ({@link view}),
 * получает сервисы в конструктор и общается с ними; в жизненный цикл контролов
 * не встраивается — только размещает их (как DOM-узлы) и не наследует TUIElement.
 * Отдельных mount()/activate() у компонентов нет: всё — в конструкторе,
 * async-инициализация живёт в сервисах (см. `IActivatable`).
 *
 * Цвета компоненты задают ИМЕНАМИ токенов темы в `style`/`setStyleVars` своих
 * контролов один раз при создании (Н3): палитру активной темы кладёт в корневой
 * var-scope WorkbenchComponent, hot-swap разъезжается каскадом — прежняя
 * ThemedComponent-инфраструктура (initStyles/updateStyles-подписки на каждый
 * компонент) не нужна.
 */
export abstract class Component extends Disposable {
    /** Корневой контрол компонента — то, что вставляется в дерево TUIDom. */
    public abstract readonly view: TUIElement;
}

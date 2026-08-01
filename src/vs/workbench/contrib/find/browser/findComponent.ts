import { Point } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { INHERITED_BG } from "../../../../../../tuidom/dom/styles/tuiStyle.ts";
import { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import type { OverlayHostElement } from "../../../../../../tuidom/ui/contextview/overlayHostElement.ts";
import type { OverlaySessionHandle } from "../../../../../../tuidom/ui/contextview/overlayLayer.ts";
import { InputElement } from "../../../../../../tuidom/ui/inputbox/inputElement.ts";
import { BoxContainerElement } from "../../../../../../tuidom/ui/layout/boxContainerElement.ts";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { SizedBoxElement } from "../../../../../../tuidom/ui/layout/sizedBoxElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";

export const FindComponentDIToken = token<FindComponent>("FindComponent");

/**
 * Packed-цвета find-виджета. Единственный источник значений —
 * (ключи VS Code `editorWidget.*`, `descriptionForeground`, `editorError.foreground`).
 */
// Навигационные / close-глифы, выровнены по правому краю строки запроса.
const PREV_GLYPH = "↑";
const NEXT_GLYPH = "↓";
const CLOSE_GLYPH = "✕";

const WIDGET_HEIGHT = 3;
const DEFAULT_WIDTH = 44;
const BUTTON_GAP = 1; // зазор между соседними кнопками
const COUNTER_GAP = 2; // зазор между счётчиком и рядом кнопок

/**
 * Компонент find-виджета: композиционный корень, собранный из примитивов
 * ({@link SizedBoxElement} → {@link BoxContainerElement} → {@link HFlexElement}
 * со строкой запроса, счётчиком совпадений и кнопками ↑ ↓ ✕). Ручного рендера
 * нет — рамку, фон и раскладку дают примитивы, цвета приходят из активной темы
 * токенами темы (`editorWidget.*`), которые резолвит каскад (Н3).
 *
 * Дерево строится ОДИН раз в конструкторе и дальше мутируется на месте
 * (`setQuery`/`setCounter` меняют только текст/цвет счётчика и его зазор) — так
 * строка запроса ({@link InputElement}) никогда не переподключается к дереву и
 * не теряет фокус между нажатиями. Виджет НЕ владеет навигационными клавишами:
 * open/next/prev/close ведут зарегистрированные команды; клик по кнопке зовёт
 * колбэк. Кнопки non-focusable (`focusable = false`) — клик не уводит фокус из
 * строки запроса. Логика поиска (query → matches → index) живёт в
 * {@link import("./findService.ts").FindService}.
 *
 * Overlay-хост ({@link OverlayHostElement} группы редакторов) приходит
 * через late-init шов {@link attachHost} — его зовёт владелец корневой view
 * (WorkbenchComponent) после постройки дерева, как у QuickInputComponent.
 */
export class FindComponent extends Component {
    public static dependencies = [] as const;

    public readonly view: SizedBoxElement;

    public onQueryChange: ((query: string) => void) | null = null;
    public onNext: (() => void) | null = null;
    public onPrev: (() => void) | null = null;
    public onClose: (() => void) | null = null;

    private readonly box: BoxContainerElement;
    private readonly input: InputElement;
    private readonly counterLabel: TextLabelElement;
    private readonly counterGap: TextLabelElement;
    private readonly prevButton: ButtonElement;
    private readonly nextButton: ButtonElement;
    private readonly closeButton: ButtonElement;

    private preferredWidth = DEFAULT_WIDTH;
    private matchCurrent = 0;
    private matchTotal = 0;

    private host: OverlayHostElement | null = null;
    private session: OverlaySessionHandle | null = null;

    public constructor() {
        super();

        this.view = new SizedBoxElement(this.preferredWidth, WIDGET_HEIGHT);
        this.view.id = "findWidget";

        this.input = new InputElement();
        this.input.showBorder = false;
        this.input.placeholder = "Find";
        this.input.onChange = (value) => {
            this.onQueryChange?.(value);
        };

        this.counterLabel = new TextLabelElement("");
        this.counterGap = new TextLabelElement("");
        this.prevButton = this.createButton(PREV_GLYPH, () => this.onPrev?.());
        this.nextButton = this.createButton(NEXT_GLYPH, () => this.onNext?.());
        this.closeButton = this.createButton(CLOSE_GLYPH, () => this.onClose?.());

        // Строка запроса (растягивается) | счётчик | зазор | ↑ · ↓ · ✕.
        const row = new HFlexElement();
        row.addChild(this.input, { width: hflexFill(), height: 1 });
        row.addChild(this.counterLabel, { width: hflexFit(), height: 1 });
        row.addChild(this.counterGap, { width: hflexFixed(0), height: 1 });
        row.addChild(this.prevButton, { width: hflexFit(), height: 1 });
        row.addChild(new TextLabelElement(""), { width: hflexFixed(BUTTON_GAP), height: 1 });
        row.addChild(this.nextButton, { width: hflexFit(), height: 1 });
        row.addChild(new TextLabelElement(""), { width: hflexFixed(BUTTON_GAP), height: 1 });
        row.addChild(this.closeButton, { width: hflexFit(), height: 1 });

        this.box = new BoxContainerElement();
        this.box.setBg("editorWidget.background");
        this.box.setFg("editorWidget.foreground");
        this.box.setBorderFg("editorWidget.border");
        this.box.setChild(row);
        this.view.setChild(this.box);

        this.register({
            dispose: () => {
                this.session?.dispose();
                this.session = null;
            },
        });
    }

    private createButton(label: string, onActivate: () => void): ButtonElement {
        const button = new ButtonElement(label);
        button.focusable = false; // keep focus in the query input on click
        button.onActivate = onActivate;
        return button;
    }

    // ─── Public API (виджетная поверхность для FindService) ───────────────────

    public getQuery(): string {
        return this.input.inputState.value;
    }

    public setQuery(value: string): void {
        this.input.inputState.value = value;
        this.input.markDirty();
        this.refreshCounter();
    }

    /**
     * Выделяет весь текст запроса (как в VS Code при Ctrl+F): первое же нажатие
     * клавиши или Backspace/Delete сотрёт старый запрос и начнёт ввод заново.
     * Зовётся ПОСЛЕ {@link setQuery} — сеттер `InputState.value` сбрасывает
     * выделение и ставит курсор в конец, так что выделять надо отдельным вызовом.
     */
    public selectQuery(): void {
        // Пустой запрос выделять нечего — а selectAll на пустой строке оставил бы
        // якорь выделения в 0, что сломало бы первый же ввод символа.
        if (this.input.inputState.value.length === 0) return;
        this.input.inputState.selectAll();
        this.input.markDirty();
    }

    /** Обновляет счётчик совпадений. `current` — 1-based; `total` 0 — совпадений нет. */
    public setCounter(current: number, total: number): void {
        this.matchCurrent = current;
        this.matchTotal = total;
        this.refreshCounter();
    }

    /** Делегирует фокус строке запроса. */
    public focus(): void {
        this.input.focus();
    }

    // ─── Overlay-сессия ───────────────────────────────────────────────────────

    /** Прикрепляет виджет к overlay-слою группы редакторов (до первого показа). */
    public attachHost(host: OverlayHostElement): void {
        this.host = host;
        this.session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            visible: false,
            restoreFocus: true,
            // Find — это док-виджет: клики мимо него намеренно уходят в редактор (как в VS Code).
            pointerPolicy: "passthrough",
        });
    }

    public isOpen(): boolean {
        return this.session?.isOpen() ?? false;
    }

    /**
     * Позиционирует виджет (правый край группы, под tab strip), открывает
     * сессию и фокусирует строку запроса. Без прикреплённого хоста — no-op по
     * позиции/сессии.
     */
    public show(): void {
        this.updatePosition();
        this.session?.open();
        this.focus();
    }

    /** Закрывает сессию; no-op, если уже закрыта. */
    public hide(): void {
        if (this.session?.isOpen()) this.session.close();
    }

    // ─── Стили / состояние ────────────────────────────────────────────────────

    /** Обновляет текст/цвет счётчика: выбирается ИМЯ токена — тему резолвит каскад. */
    private refreshCounter(): void {
        const counter = this.counterText();
        this.counterLabel.setText(counter);
        this.counterLabel.setColors(
            this.matchTotal === 0 ? "editorError.foreground" : "descriptionForeground",
            INHERITED_BG,
        );
        this.counterGap.layoutStyle = { width: hflexFixed(counter === "" ? 0 : COUNTER_GAP), height: 1 };
        this.counterGap.markDirty();
    }

    private buttons(): readonly ButtonElement[] {
        return [this.prevButton, this.nextButton, this.closeButton];
    }

    private counterText(): string {
        if (this.input.inputState.value.length === 0) return "";
        if (this.matchTotal === 0) return "No results";
        return `${this.matchCurrent} of ${this.matchTotal}`;
    }

    private updatePosition(): void {
        const group = this.host;
        if (group === null) return;
        const groupWidth = group.layoutSize.width;
        const widgetW = Math.min(60, Math.max(28, groupWidth - 2));
        this.preferredWidth = widgetW;
        this.view.setPreferredWidth(widgetW);
        const px = Math.max(0, groupWidth - widgetW - 1); // right-align with a 1-col margin to the group's edge
        const py = 1; // хост — группа редакторов, её ряд 0 занимает tab strip
        this.session?.setPosition(new Point(px, py));
    }
}

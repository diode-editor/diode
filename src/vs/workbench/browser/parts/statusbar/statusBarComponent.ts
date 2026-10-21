import type { TUIContextMenuEvent, TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { TUIStyle } from "@tuidom/core/dom/styles/tuiStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import type { HFlexChildSize } from "@tuidom/elements/layout/hFlexElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { CHECKED_ICON } from "../../../../platform/actions/common/menuRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStatusBarEntry, StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import {} from "../../../services/themes/common/themeTokens.ts";
import { Component } from "../../component.ts";

export const StatusBarComponentDIToken = token<StatusBarComponent>("StatusBarComponent");

/** Инертные сегменты (`Ln X, Col Y`, язык) подсветку не получают: она обещает клик, которого нет. */
const CLICKABLE_STYLE: TUIStyle = {
    when: [{ states: ["hover"], bg: "statusBarItem.hoverBackground", fg: "statusBarItem.hoverForeground" }],
};
const INERT_STYLE: TUIStyle = {};

/**
 * Дерево строится один раз и мутируется на месте: пока состав сторон не
 * меняется, обновляются только тексты — путь курсора не пересобирает поддерево
 * на каждое нажатие. Лейблы живут в монотонно растущем пуле.
 */
export class StatusBarComponent extends Component {
    public static dependencies = [StatusBarServiceDIToken, ContextMenuServiceDIToken] as const;

    public readonly view: HFlexElement;

    /**
     * Правый паддинг — не только воздух: нижне-правую ячейку терминала рендер не
     * пишет никогда (hardware scroll, см. terminalRenderer), и значимый символ
     * последнего сегмента туда не попадёт.
     */
    private readonly padLeft = new FillerElement();
    private readonly padRight = new FillerElement();
    private readonly centerFill = new FillerElement();
    private readonly leftLabels: TextLabelElement[] = [];
    private readonly rightLabels: TextLabelElement[] = [];
    private currentLeft: readonly IStatusBarEntry[] = [];
    private currentRight: readonly IStatusBarEntry[] = [];

    public constructor(
        private readonly statusBarService: StatusBarService,
        private readonly contextMenuService: ContextMenuService,
    ) {
        super();
        this.view = new HFlexElement();
        this.view.id = "statusBar";
        this.view.style = { fg: "statusBar.foreground", bg: "statusBar.background" };
        this.view.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            this.showVisibilityMenu(event as TUIContextMenuEvent);
        });
        this.register(
            this.statusBarService.onDidChangeEntries(() => {
                this.renderEntries();
            }),
        );
        this.renderEntries();
    }

    private renderEntries(): void {
        const entries = this.statusBarService.entries();
        const left = entries.filter((entry) => entry.alignment !== "right");
        const right = entries.filter((entry) => entry.alignment === "right");
        const structureChanged = left.length !== this.currentLeft.length || right.length !== this.currentRight.length;
        this.currentLeft = left;
        this.currentRight = right;

        this.ensureLabels(this.leftLabels, "left", left.length);
        this.ensureLabels(this.rightLabels, "right", right.length);
        left.forEach((entry, i) => {
            this.syncLabel(this.leftLabels[i], entry);
        });
        right.forEach((entry, i) => {
            this.syncLabel(this.rightLabels[i], entry);
        });

        if (structureChanged) {
            this.rebuildChildren();
        }
    }

    /**
     * Текст сверяем здесь (равный стиль отсекает сам сеттер) — иначе каждое
     * движение курсора помечало бы лейбл грязным. Id едет за записью, а не за
     * индексом в пуле; точки в нём меняем на дефисы — селекторы инспектора/e2e
     * их не поддерживают (как в `ViewsService`).
     */
    private syncLabel(label: TextLabelElement, entry: IStatusBarEntry): void {
        const text = ` ${entry.text} `;
        if (label.getText() !== text) label.setText(text);
        label.style = entry.onClick !== undefined ? CLICKABLE_STYLE : INERT_STYLE;
        label.id = `statusBarItem-${entry.id.replaceAll(".", "-")}`;
    }

    /**
     * Колбэк записи резолвится в момент клика из текущего снапшота — переиспользование
     * лейбла ничего не перевешивает. Команду запускает только ЛЕВАЯ кнопка: правый
     * клик — запрос меню видимости, чекаутить ветку он не должен.
     */
    private ensureLabels(pool: TextLabelElement[], side: "left" | "right", count: number): void {
        while (pool.length < count) {
            const index = pool.length;
            const label = new TextLabelElement("");
            label.addEventListener("click", (event) => {
                if (event.button !== "left") return;
                const current = side === "left" ? this.currentLeft : this.currentRight;
                current[index]?.onClick?.();
            });
            pool.push(label);
        }
    }

    /**
     * Разделителей нет — сегменты разделяют собственные краевые пробелы. Каждая
     * колонка покрыта ребёнком, поэтому фон красится без своего render у HFlex.
     */
    private rebuildChildren(): void {
        const children: TUIElement[] = [];
        const push = (element: TUIElement, width: HFlexChildSize): void => {
            element.layoutStyle = { width, height: 1 };
            children.push(element);
        };

        push(this.padLeft, hflexFixed(1));
        this.currentLeft.forEach((_, i) => {
            push(this.leftLabels[i], hflexFit());
        });
        push(this.centerFill, hflexFill());
        this.currentRight.forEach((_, i) => {
            push(this.rightLabels[i], hflexFit());
        });
        push(this.padRight, hflexFixed(1));

        this.view.replaceChildren(children);
    }

    /**
     * Галочки — по всем записям, включая скрытые (иначе их нечем вернуть). Клик
     * мимо сегментов даёт меню без «Hide» — путь назад, когда скрыто всё.
     */
    private showVisibilityMenu(event: TUIContextMenuEvent): void {
        const target = this.entryOfLabel(event.target);
        this.contextMenuService.showContextMenu({
            getOwner: () => this.view,
            getAnchor: () => ({ screenX: event.screenX, screenY: event.screenY }),
            getEntries: () => this.visibilityMenuEntries(target),
        });
    }

    private visibilityMenuEntries(target: IStatusBarEntry | null): MenuEntry[] {
        const entries: MenuEntry[] = this.statusBarService.allEntries().flatMap((entry) => {
            const name = entry.name;
            if (name === undefined) return [];
            const visible = !this.statusBarService.isHidden(entry.id);
            return [
                {
                    label: name,
                    id: entry.id,
                    icon: visible ? CHECKED_ICON : undefined,
                    onSelect: (): void => {
                        this.statusBarService.setHidden(entry.id, visible);
                    },
                },
            ];
        });
        if (target?.name === undefined) return entries;
        return [
            ...entries,
            { type: "separator" },
            {
                label: `Hide '${target.name}'`,
                onSelect: () => {
                    this.statusBarService.setHidden(target.id, true);
                },
            },
        ];
    }

    /** Ищем среди ТЕКУЩИХ записей: лейбл снятой записи отцеплен от дерева и целью события быть не может. */
    private entryOfLabel(target: TUIElement | null): IStatusBarEntry | null {
        const left = this.currentLeft.findIndex((_, i) => this.leftLabels[i] === target);
        if (left >= 0) return this.currentLeft[left];
        const right = this.currentRight.findIndex((_, i) => this.rightLabels[i] === target);
        return right >= 0 ? this.currentRight[right] : null;
    }
}

import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import type { TUIEventBase } from "../../dom/events/tuiEventBase.ts";
import type { TUIFocusEvent } from "../../dom/events/tuiFocusEvent.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import type { OverlayLayer } from "../contextview/overlayLayer.ts";
import type { OverlaySessionHandle } from "../contextview/overlayLayer.ts";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "../layout/hFlexElement.ts";

import { MenuBarFillerElement, MenuBarItemElement } from "./menuBarItemElement.tsx";
import type { MenuEntry } from "./popupMenuElement.ts";
import { PopupMenuElement } from "./popupMenuElement.ts";
import type { IMenuStyles } from "./popupMenuItemElement.tsx";
import { unthemedMenuStyles } from "./popupMenuItemElement.tsx";

export interface MenuBarItem {
    label: string;
    mnemonic?: string;
    entries: MenuEntry[];
}

export class MenuBarElement extends TUIElement {
    public readonly items: readonly MenuBarItem[];
    public activeIndex = -1;

    private activeMenu: PopupMenuElement | null = null;
    private activeMenuSession: OverlaySessionHandle | null = null;
    private itemElements: MenuBarItemElement[] = [];
    private hflex: HFlexElement;
    private previousFocusedElement: TUIElement | null = null;
    private parentMnemonicHandler: ((event: TUIKeyboardEvent) => void) | null = null;
    private menuStyles: IMenuStyles = unthemedMenuStyles;

    /**
     * Кэширует стили меню, чтобы прокинуть их в дропдаун, который меню-бар
     * создаёт при открытии (сам виджет полосы не тематизируется).
     */
    public setStyles(styles: IMenuStyles): void {
        this.menuStyles = styles;
        this.activeMenu?.setStyles(styles);
    }

    private updateItemActiveStates(): void {
        for (let i = 0; i < this.itemElements.length; i++) {
            this.itemElements[i].active = i === this.activeIndex && this.isFocused;
        }
    }

    public constructor(items: MenuBarItem[]) {
        super();
        this.tabIndex = 0;
        this.items = items;

        this.hflex = new HFlexElement();
        this.hflex.addChild(new MenuBarFillerElement(), { width: hflexFixed(2), height: 1 });
        this.itemElements = items.map((item, index) => {
            const el = new MenuBarItemElement(item.label, item.mnemonic);
            el.onActivate = () => {
                if (this.activeMenu && this.activeIndex === index) {
                    this.closePopup();
                } else {
                    this.focus();
                    this.openMenu(index);
                }
            };
            // While a menu is open, hovering another top-level item switches to it (VS Code behavior).
            el.onHover = () => {
                if (this.activeMenu && this.activeIndex !== index) {
                    this.openMenu(index);
                }
            };
            this.hflex.addChild(el, { width: hflexFit(), height: 1 });
            return el;
        });
        this.hflex.addChild(new MenuBarFillerElement(), { width: hflexFill(), height: 1 });
        this.hflex.setParent(this);
    }

    public override setParent(parent: TUIElement | null): void {
        if (this._parent && this.parentMnemonicHandler) {
            this._parent.removeEventListener("keydown", this.parentMnemonicHandler);
        }

        super.setParent(parent);

        if (parent) {
            this.parentMnemonicHandler = (event: TUIKeyboardEvent) => {
                const match = this.findMnemonicMatch(event);
                if (match >= 0) {
                    this.focus();
                    this.openMenu(match);
                    event.preventDefault();
                }
            };
            parent.addEventListener("keydown", this.parentMnemonicHandler);
        } else {
            this.parentMnemonicHandler = null;
        }
    }

    public override getChildren(): readonly TUIElement[] {
        return [this.hflex];
    }

    public get isMenuOpen(): boolean {
        return this.activeMenu !== null;
    }

    public override getMinIntrinsicWidth(height: number): number {
        return this.hflex.getMinIntrinsicWidth(height);
    }

    public override getMaxIntrinsicWidth(height: number): number {
        return this.hflex.getMaxIntrinsicWidth(height);
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return 1;
    }

    public performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);

        this.hflex.localPosition = new Offset(0, 0);
        this.hflex.globalPosition = new Point(this.globalPosition.x, this.globalPosition.y);
        this.hflex.performLayout(BoxConstraints.tight(new Size(containerSize.width, 1)));

        return containerSize;
    }

    public render(context: RenderContext): void {
        this.hflex.render(context.withOffset(this.hflex.localPosition));
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type === "focus") {
            this.previousFocusedElement = (event as TUIFocusEvent).relatedTarget;
            if (this.activeIndex < 0) {
                this.activeIndex = 0;
            }
            this.updateItemActiveStates();
            this.markDirty();
        } else if (event.type === "blur") {
            this.deactivate();
            this.previousFocusedElement = null;
        } else if (event.type === "keydown") {
            this.handleKeydownDefault(event as TUIKeyboardEvent);
        }
    }

    private handleKeydownDefault(event: TUIKeyboardEvent): void {
        if (this.activeIndex < 0) {
            return;
        }

        if (event.key === "Escape") {
            if (this.activeMenu) {
                this.closePopup();
            } else {
                const prev = this.previousFocusedElement;
                this.deactivate();
                if (prev) {
                    prev.focus();
                } else {
                    this.blur();
                }
            }
            return;
        }

        if (event.key === "ArrowLeft") {
            const next = this.wrapIndex(this.activeIndex - 1);
            if (this.activeMenu) {
                this.openMenu(next);
            } else {
                this.activeIndex = next;
                this.updateItemActiveStates();
                this.markDirty();
            }
            return;
        }

        if (event.key === "ArrowRight") {
            const next = this.wrapIndex(this.activeIndex + 1);
            if (this.activeMenu) {
                this.openMenu(next);
            } else {
                this.activeIndex = next;
                this.updateItemActiveStates();
                this.markDirty();
            }
            return;
        }

        if (event.key === "ArrowDown" || event.key === "Enter") {
            if (this.activeMenu) {
                this.forwardToPopup(event);
            } else {
                this.openMenu(this.activeIndex);
            }
            return;
        }

        if (event.key === "ArrowUp") {
            if (this.activeMenu) {
                this.forwardToPopup(event);
            }
            return;
        }

        if (this.activeMenu) {
            this.forwardToPopup(event);
            return;
        }
    }

    private openMenu(index: number): void {
        if (index < 0 || index >= this.items.length) {
            return;
        }

        this.closePopup();

        const wrappedEntries = this.items[index].entries.map((entry) => {
            if (entry.type === "separator" || entry.type === "submenu") {
                return entry;
            }

            const originalOnSelect = entry.onSelect;
            return {
                ...entry,
                onSelect: () => {
                    originalOnSelect?.();
                    this.deactivate();
                    this.blur();
                },
            };
        });

        this.activeIndex = index;
        this.updateItemActiveStates();
        const menu = new PopupMenuElement(wrappedEntries);
        menu.setStyles(this.menuStyles);
        this.activeMenu = menu;

        const layer = this.getOverlayLayer();
        /* v8 ignore next -- defensive: меню-бар всегда прикреплён к BodyElement со слоем */
        if (!layer) return;
        const position = this.getMenuGlobalPosition(index);
        let session: OverlaySessionHandle | null = null;
        session = layer.createSession(menu, position, {
            visible: true,
            // Меню-бар сам управляет закрытием дропдауна: клик снаружи уводит фокус →
            // blur → deactivate, а повторный клик по тому же пункту тоглит его. Перехват
            // в OverlayLayer (close-on-outside) гонялся бы с этим тоглом, поэтому passthrough.
            pointerPolicy: "passthrough",
            // ...но клавиатурой дропдаун владеет (стрелки/Enter/Escape/мнемоники), поэтому
            // глобальные кейбинды при открытом меню гасим явным опт-ином.
            capturesKeyboard: true,
            disposeOnClose: true,
            onClose: () => {
                /* v8 ignore start -- guards against a stale onClose after the menu was switched; switching disposes the old session without firing onClose, so the mismatch (false) side is unreachable via the public API */
                if (this.activeMenuSession === session) {
                    this.activeMenuSession = null;
                }
                if (this.activeMenu === menu) {
                    this.activeMenu = null;
                }
                /* v8 ignore stop */
            },
        });
        menu.onClose = () => {
            session.close();
        };
        this.activeMenuSession = session;
        this.markDirty();
    }

    private closePopup(): void {
        this.activeMenuSession?.dispose();
        this.activeMenuSession = null;
        this.activeMenu = null;
        this.markDirty();
    }

    private deactivate(): void {
        this.closePopup();
        this.activeIndex = -1;
        this.updateItemActiveStates();
        this.markDirty();
    }

    private forwardToPopup(event: TUIKeyboardEvent): void {
        this.activeMenu?.dispatchEvent(
            new TUIKeyboardEvent("keydown", {
                key: event.key,
                code: event.code,
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
                raw: event.raw,
                bubbles: false,
            }),
        );
    }

    private wrapIndex(index: number): number {
        if (this.items.length === 0) {
            return -1;
        }

        if (index < 0) {
            return this.items.length - 1;
        }

        if (index >= this.items.length) {
            return 0;
        }

        return index;
    }

    private findMnemonicMatch(event: TUIKeyboardEvent): number {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1) {
            return -1;
        }

        const normalizedKey = event.key.toLowerCase();
        return this.items.findIndex((item) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            const mnemonic = (item.mnemonic ?? item.label[0] ?? "").toLowerCase();
            return mnemonic === normalizedKey;
        });
    }

    private getMenuGlobalPosition(index: number): Point {
        const el = this.itemElements[index];
        return new Point(this.globalPosition.x + el.localPosition.dx, this.globalPosition.y + 1);
    }

}

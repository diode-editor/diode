import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import { FillerElement } from "../layout/fillerElement.ts";
import { HFlexElement, hflexFill, hflexFit } from "../layout/hFlexElement.ts";

import { EditorTabItemElement } from "./editorTabItemElement.ts";

// ─── Tab Info ───

export interface TabInfo {
    label: string;
    icon: string;
    iconColor: number;
    isModified: boolean;
    /** Read-only буфер — вкладка получает метку-замок. */
    isReadOnly: boolean;
}

// ─── EditorTabStripElement ───

export class EditorTabStripElement extends TUIElement {
    private hflex: HFlexElement;
    private itemElements: EditorTabItemElement[] = [];
    private filler: FillerElement;
    private activeIndexValue = -1;

    public onTabActivate: ((index: number) => void) | null = null;
    public onTabClose: ((index: number) => void) | null = null;

    public constructor() {
        super();
        this.hflex = new HFlexElement();
        this.filler = new FillerElement();
        this.filler.style = { bg: "editorGroupHeader.tabsBackground" };
        this.hflex.addChild(this.filler, { width: hflexFill(), height: 1 });
        this.appendChild(this.hflex);
    }

    public get activeIndex(): number {
        return this.activeIndexValue;
    }

    public set activeIndex(value: number) {
        if (this.activeIndexValue === value) return;
        this.activeIndexValue = value;
        this.updateItemStyles();
        this.markDirty();
    }

    /** Observable state: tab labels with active/modified/readonly flags. */
    public override inspectState(): Record<string, unknown> {
        return {
            activeIndex: this.activeIndexValue,
            tabs: this.itemElements.map((item, i) => ({
                label: item.getLabel(),
                active: i === this.activeIndexValue,
                modified: item.getModified(),
                readOnly: item.getReadOnly(),
            })),
        };
    }

    public getItemElements(): readonly EditorTabItemElement[] {
        return this.itemElements;
    }

    public setTabs(tabs: TabInfo[]): void {
        const newItems: EditorTabItemElement[] = [];

        for (let i = 0; i < tabs.length; i++) {
            const tab = tabs[i];
            let item: EditorTabItemElement;

            if (i < this.itemElements.length) {
                item = this.itemElements[i];
                item.setLabel(tab.label);
                item.setIcon(tab.icon, tab.iconColor);
                item.setModified(tab.isModified);
                item.setReadOnly(tab.isReadOnly);
            } else {
                item = new EditorTabItemElement(tab.label, tab.icon, tab.iconColor, {
                    modified: tab.isModified,
                    readOnly: tab.isReadOnly,
                    paddingLeft: 2,
                    paddingRight: 2,
                });
                // Вкладка декларирует оба вида токенами; активность — состояние.
                item.style = {
                    fg: "tab.inactiveForeground",
                    bg: "tab.inactiveBackground",
                    when: [{ states: ["active"], fg: "tab.activeForeground", bg: "tab.activeBackground" }],
                };
                const index = i;
                item.onActivate = () => this.onTabActivate?.(index);
                item.onClose = () => this.onTabClose?.(index);
            }

            newItems.push(item);
        }

        this.itemElements = newItems;
        this.rebuildHFlex();
        this.updateItemStyles();
        this.markDirty();
    }

    private rebuildHFlex(): void {
        const children: TUIElement[] = [];

        for (const item of this.itemElements) {
            item.layoutStyle = { width: hflexFit(), height: 1 };
            children.push(item);
        }

        this.filler.layoutStyle = { width: hflexFill(), height: 1 };
        children.push(this.filler);

        this.hflex.replaceChildren(children);
    }

    private updateItemStyles(): void {
        for (let i = 0; i < this.itemElements.length; i++) {
            this.itemElements[i].setStyleState("active", i === this.activeIndexValue);
        }
    }

    // ─── Children ───

    // ─── Intrinsic Size ───

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

    // ─── Layout ───

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);

        this.layoutChild(this.hflex, 0, 0, BoxConstraints.tight(new Size(containerSize.width, 1)));

        return containerSize;
    }
}

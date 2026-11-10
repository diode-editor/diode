import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Disposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IClipboard } from "../../../../../platform/clipboard/common/iClipboard.ts";
import type { CommandRegistry } from "../../../../../platform/commands/common/commandRegistry.ts";
import type { ConfigurationRegistry } from "../../../../../platform/configuration/common/configurationRegistry.ts";
import type {
    ConfigurationTarget,
    IConfigurationService,
} from "../../../../../platform/configuration/common/iConfigurationService.ts";
import type { ContextMenuService } from "../../../../../platform/contextview/browser/contextMenuService.ts";
import type { IEditorPane } from "../../../../browser/parts/editor/iEditorPane.ts";

import type { ISettingItemHost, ISettingItemState } from "./settingItemElement.ts";
import { SettingItemElement, SettingsGroupHeaderElement } from "./settingItemElement.ts";
import type { ISettingDescriptor, ISettingsGroup } from "./settingsEditorModel.ts";
import {
    buildSettingsGroups,
    describeSetting,
    matchesQuery,
    parseQuery,
    settingKeyToDisplayFormat,
} from "./settingsEditorModel.ts";
import { SettingsScrollElement, WrappedTextElement } from "./settingsWidgets.ts";

// SPIKE: Settings UI look-and-feel (upstream `SettingsEditor2`). No tests, no session restore.

export const SETTINGS_EDITOR_SCHEME = "settings";

type SettingsTarget = "user" | "workspace";

const TOC_MIN_TOTAL_WIDTH = 80;
const TOC_MAX_WIDTH = 28;

/** Bordered search box with the result count on the right — upstream `.settings-header .search-container`. */
class SearchBoxElement extends TUIElement {
    public readonly input = new InputElement();
    private countText = "";
    public onClear: (() => void) | null = null;

    public constructor() {
        super();
        this.input.placeholder = "Search settings";
        this.appendChild(this.input);
        // The border color follows the input's focus.
        this.input.addEventListener("focus", () => {
            this.markDirty();
        });
        this.input.addEventListener("blur", () => {
            this.markDirty();
        });
        this.addEventListener("click", (event) => {
            const mouse = event as TUIMouseEvent;
            const x = mouse.screenX - this.globalPosition.x;
            if (x >= this.layoutSize.width - 3 && this.input.inputState.value !== "") {
                event.preventDefault();
                this.onClear?.();
            }
        });
    }

    public setCount(text: string): void {
        this.countText = text;
        this.markDirty();
    }

    public override getMaxIntrinsicHeight(): number {
        return 3;
    }

    private rightWidth(): number {
        const clear = this.input.inputState.value !== "" ? 3 : 0;
        return (this.countText.length > 0 ? this.countText.length + 2 : 0) + clear;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const width = Math.max(1, size.width - 4 - this.rightWidth());
        this.layoutChild(this.input, 2, 1, BoxConstraints.tight(new Size(width, 1)));
        return size;
    }

    public override render(context: RenderContext): void {
        const { width } = this.layoutSize;
        const focused = this.input.hasStyleState("focus");
        const bg = this.resolveColor("input.background");
        context.drawBox(0, 0, width, 3, {
            fg: this.resolveColor(focused ? "focusBorder" : "input.border"),
            bg,
            fill: true,
        });
        const dim = this.resolveColor("descriptionForeground");
        const hasClear = this.input.inputState.value !== "";
        const countX = width - 2 - this.rightWidth() + 1;
        if (this.countText.length > 0) context.drawText(countX, 1, this.countText, { fg: dim, bg });
        if (hasClear) context.drawText(width - 3, 1, "✕", { fg: this.resolveColor("input.foreground"), bg });
        this.renderChildren(context);
    }
}

/** `User | Workspace` tabs with the active one underlined; the underline merges into the header border. */
class TargetTabsElement extends TUIElement {
    public onSelect: ((target: SettingsTarget) => void) | null = null;
    public onOpenJson: (() => void) | null = null;
    private ranges: { target: SettingsTarget; start: number; end: number }[] = [];
    private jsonRange: [number, number] = [0, 0];

    public constructor(
        private active: SettingsTarget,
        private readonly workspaceEnabled: boolean,
    ) {
        super();
        this.addEventListener("click", (event) => {
            const mouse = event as TUIMouseEvent;
            const x = mouse.screenX - this.globalPosition.x;
            if (x >= this.jsonRange[0] && x < this.jsonRange[1]) {
                this.onOpenJson?.();
                return;
            }
            const hit = this.ranges.find((r) => x >= r.start && x < r.end);
            if (hit !== undefined && (hit.target === "user" || this.workspaceEnabled)) this.onSelect?.(hit.target);
        });
    }

    public setActive(target: SettingsTarget): void {
        this.active = target;
        this.markDirty();
    }

    public override getMaxIntrinsicHeight(): number {
        return 2;
    }

    public override render(context: RenderContext): void {
        const { width } = this.layoutSize;
        const activeFg = this.resolveColor("panelTitle.activeForeground");
        const inactiveFg = this.resolveColor("panelTitle.inactiveForeground");
        const disabledFg = this.resolveColor("disabledForeground");
        const borderFg = this.resolveColor("settings.headerBorder");
        const underlineFg = this.resolveColor("panelTitle.activeBorder");

        context.drawText(0, 1, "─".repeat(width), { fg: borderFg });
        this.ranges = [];
        let x = 2;
        for (const [target, label] of [
            ["user", "User"],
            ["workspace", "Workspace"],
        ] as const) {
            const isActive = target === this.active;
            const enabled = target === "user" || this.workspaceEnabled;
            const fg = isActive ? activeFg : enabled ? inactiveFg : disabledFg;
            context.drawText(x, 0, label, { fg, style: isActive ? StyleFlags.Bold : StyleFlags.None });
            if (isActive) context.drawText(x, 1, "━".repeat(label.length), { fg: underlineFg });
            this.ranges.push({ target, start: x, end: x + label.length });
            x += label.length + 3;
        }

        const json = "{ } Open Settings (JSON)";
        const jsonX = width - json.length - 2;
        if (jsonX > x) {
            const hovered = this.hasStyleState("hover");
            context.drawText(jsonX, 0, json, {
                fg: this.resolveColor("textLink.foreground"),
                style: hovered ? StyleFlags.Underline : StyleFlags.None,
            });
            this.jsonRange = [jsonX, jsonX + json.length];
        }
    }
}

/** Header on top; below, the TOC on the left and the settings list on the right. */
class SettingsEditorRootElement extends TUIElement {
    public constructor(
        private readonly search: SearchBoxElement,
        private readonly tabs: TargetTabsElement,
        private readonly toc: TUIElement,
        private readonly content: TUIElement,
    ) {
        super();
        this.id = "settingsEditor";
        this.style = { fg: "editor.foreground", bg: "editor.background" };
        this.appendChild(search);
        this.appendChild(tabs);
        this.appendChild(toc);
        this.appendChild(content);
    }

    private tocWidth(width: number): number {
        return width >= TOC_MIN_TOTAL_WIDTH ? Math.min(TOC_MAX_WIDTH, Math.floor(width * 0.22)) : 0;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const { width, height } = size;
        const headerWidth = Math.max(1, width - 4);
        this.layoutChild(this.search, 2, 1, BoxConstraints.tight(new Size(headerWidth, 3)));
        this.layoutChild(this.tabs, 0, 4, BoxConstraints.tight(new Size(width, 2)));
        const bodyTop = 7;
        const bodyHeight = Math.max(0, height - bodyTop);
        const tocWidth = this.tocWidth(width);
        this.toc.hidden = tocWidth === 0;
        this.layoutChild(this.toc, 1, bodyTop, BoxConstraints.tight(new Size(Math.max(0, tocWidth - 1), bodyHeight)));
        const contentX = tocWidth > 0 ? tocWidth + 1 : 0;
        this.layoutChild(
            this.content,
            contentX,
            bodyTop,
            BoxConstraints.tight(new Size(Math.max(0, width - contentX), bodyHeight)),
        );
        return size;
    }

    public override render(context: RenderContext): void {
        this.paintOwnBackground(context);
        const tocWidth = this.tocWidth(this.layoutSize.width);
        if (tocWidth > 0) {
            const fg = this.resolveColor("settings.sashBorder");
            for (let y = 7; y < this.layoutSize.height; y++) context.drawText(tocWidth, y, "│", { fg });
        }
        this.renderChildren(context);
    }
}

export class SettingsEditorPane extends Disposable implements IEditorPane, ISettingItemHost {
    public readonly uri = Uri.from({ scheme: SETTINGS_EDITOR_SCHEME, path: "/user" });
    public readonly label = "Settings";
    public readonly view: TUIElement;
    public readonly isModified = false;
    public readonly readOnly = true;

    private readonly search = new SearchBoxElement();
    private readonly tabs: TargetTabsElement;
    private readonly toc = new ListViewElement({ typeahead: false });
    private readonly scroll = new SettingsScrollElement();
    private readonly emptyMessage = new WrappedTextElement([{ text: "  No Settings Found" }]);

    private readonly groups: ISettingsGroup[];
    private readonly headers = new Map<string, SettingsGroupHeaderElement>();
    private readonly items = new Map<string, SettingItemElement>();
    private readonly groupOfElement = new Map<TUIElement, string>();
    private target: SettingsTarget = "user";
    private words: readonly string[] = [];
    private syncingToc = false;

    public constructor(
        registry: ConfigurationRegistry,
        private readonly config: IConfigurationService,
        private readonly commands: CommandRegistry,
        private readonly contextMenu: ContextMenuService,
        private readonly clipboard: IClipboard,
        hasWorkspace: boolean,
    ) {
        super();
        const settings = [...registry.getConfigurationProperties()]
            .filter(([key]) => !key.startsWith("["))
            .map(([key, schema]) => describeSetting(key, schema));
        this.groups = buildSettingsGroups(settings);

        this.tabs = new TargetTabsElement(this.target, hasWorkspace);
        this.tabs.onSelect = (target) => {
            this.target = target;
            this.tabs.setActive(target);
            this.rebuild();
        };
        this.tabs.onOpenJson = () => {
            this.openJson();
        };

        this.search.input.onChange = () => {
            this.rebuild();
            this.scroll.scrollTo(0, 0);
        };
        this.search.onClear = () => {
            this.search.input.inputState.value = "";
            this.rebuild();
            this.scroll.scrollTo(0, 0);
            this.search.input.focus();
        };
        this.search.input.addEventListener("keydown", (event) => {
            if ((event as TUIKeyboardEvent).key !== "ArrowDown") return;
            const first = this.scroll.getItems().find((el) => el instanceof SettingItemElement);
            if (first instanceof SettingItemElement) {
                event.preventDefault();
                first.focusControl();
            }
        });

        this.toc.id = "settingsToc";
        this.toc.onSelect = (element) => {
            if (this.syncingToc || element.id === undefined) return;
            const header = this.headers.get(element.id);
            if (header !== undefined) this.scroll.scrollToItem(header);
        };
        this.scroll.onDidScroll = () => {
            this.syncTocToScroll();
        };
        this.emptyMessage.id = "settingsEmpty";

        const content = new ScrollBarDecorator(this.scroll);
        this.view = new SettingsEditorRootElement(this.search, this.tabs, this.toc, content);

        this.register(
            this.config.onDidChangeConfiguration(() => {
                this.refreshStates();
                this.rebuild();
            }),
        );
        this.rebuild();
    }

    // ---- ISettingItemHost ----

    public write(key: string, value: unknown): void {
        void this.config.updateValue(key, value, this.target satisfies ConfigurationTarget);
    }

    public openJson(_key?: string): void {
        this.commands.execute(
            this.target === "user" ? "workbench.action.openSettingsJson" : "workbench.action.openWorkspaceSettingsFile",
        );
    }

    public showGearMenu(item: SettingItemElement, screenX: number, screenY: number): void {
        const { key } = item.setting;
        this.contextMenu.showContextMenu({
            getOwner: () => this.view,
            getAnchor: () => ({ screenX, screenY }),
            getEntries: () => [
                {
                    label: "Reset Setting",
                    onSelect: () => {
                        void this.config.updateValue(key, undefined, this.target);
                    },
                },
                { type: "separator" },
                {
                    label: "Copy Setting ID",
                    onSelect: () => {
                        void this.clipboard.writeText(key);
                    },
                },
                {
                    label: "Copy Setting as JSON",
                    onSelect: () => {
                        const value = this.config.inspect(key).value;
                        void this.clipboard.writeText(`"${key}": ${JSON.stringify(value)}`);
                    },
                },
            ],
        });
    }

    public keyToLabel(key: string): string {
        const { category, title } = settingKeyToDisplayFormat(key);
        return category.length > 0 ? `${category}: ${title}` : title;
    }

    public reveal(element: TUIElement): void {
        this.scroll.reveal(element);
    }

    public query(): readonly string[] {
        return this.words;
    }

    // ---- IEditorPane ----

    public getSelectedTexts(): string[] {
        return [];
    }

    public onDidChangeState(): IDisposable {
        return {
            dispose: () => {
                /* no-op */
            },
        };
    }

    public focusEditor(): void {
        this.search.input.focus();
    }

    // ---- model → view ----

    private stateOf(key: string): ISettingItemState {
        const inspect = this.config.inspect(key);
        if (this.target === "user") {
            return {
                value: inspect.user ?? inspect.default,
                modified: inspect.user !== undefined,
                alsoModifiedIn: inspect.workspace !== undefined ? "Workspace" : null,
            };
        }
        return {
            value: inspect.workspace ?? inspect.user ?? inspect.default,
            modified: inspect.workspace !== undefined,
            alsoModifiedIn: inspect.user !== undefined ? "User" : null,
        };
    }

    private itemFor(groupId: string, setting: ISettingDescriptor): SettingItemElement {
        const cacheKey = `${groupId}/${setting.key}`;
        let item = this.items.get(cacheKey);
        if (item === undefined) {
            item = new SettingItemElement(setting, this);
            this.items.set(cacheKey, item);
            this.groupOfElement.set(item, groupId);
        }
        return item;
    }

    private headerFor(group: ISettingsGroup): SettingsGroupHeaderElement {
        let header = this.headers.get(group.id);
        if (header === undefined) {
            header = new SettingsGroupHeaderElement(group.id, group.label, group.depth);
            this.headers.set(group.id, header);
            this.groupOfElement.set(header, group.id);
        }
        return header;
    }

    private refreshStates(): void {
        for (const item of this.items.values()) item.setState(this.stateOf(item.setting.key));
    }

    private applicable(setting: ISettingDescriptor): boolean {
        if (this.target === "user") return true;
        const { scope } = setting.schema;
        return scope !== "application" && scope !== "machine";
    }

    private rebuild(): void {
        const { words, modifiedOnly } = parseQuery(this.search.input.inputState.value);
        this.words = words;
        const searching = words.length > 0 || modifiedOnly;

        const matched = new Map<string, ISettingDescriptor[]>();
        for (const group of this.groups) {
            matched.set(
                group.id,
                group.settings.filter(
                    (s) =>
                        this.applicable(s) &&
                        matchesQuery(s, words) &&
                        (!modifiedOnly || this.stateOf(s.key).modified),
                ),
            );
        }
        const subtreeCount = (group: ISettingsGroup): number =>
            (matched.get(group.id)?.length ?? 0) +
            this.groups.filter((g) => g.parentId === group.id).reduce((sum, g) => sum + subtreeCount(g), 0);

        const elements: TUIElement[] = [];
        let total = 0;
        this.toc.clear();
        for (const group of this.groups) {
            if (searching && group.id === "commonlyUsed") continue;
            const count = subtreeCount(group);
            if (count === 0) continue;
            const own = matched.get(group.id) ?? [];
            total += own.length;

            const header = this.headerFor(group);
            elements.push(header);
            for (const setting of own) {
                const item = this.itemFor(group.id, setting);
                item.setState(this.stateOf(setting.key));
                elements.push(item);
            }

            const tocLabel = searching ? `${group.label} (${String(count)})` : group.label;
            const row = new TextLabelElement(tocLabel);
            row.id = group.id;
            this.toc.appendRow(row, group.parentId !== null ? { parentId: group.parentId } : undefined);
        }
        if (total === 0) elements.push(this.emptyMessage);

        this.search.setCount(
            searching ? (total === 0 ? "No Settings Found" : `${String(total)} Setting${total === 1 ? "" : "s"} Found`) : "",
        );
        this.scroll.setItems(elements);
    }

    private syncTocToScroll(): void {
        const top = this.scroll.itemAtTop();
        if (top === undefined) return;
        const groupId = this.groupOfElement.get(top);
        if (groupId === undefined) return;
        this.syncingToc = true;
        try {
            this.toc.setCursorTo(groupId);
        } finally {
            this.syncingToc = false;
        }
    }
}

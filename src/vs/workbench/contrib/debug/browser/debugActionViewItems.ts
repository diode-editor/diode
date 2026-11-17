/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugActionViewItems.ts
// `StartDebugActionViewItem`: the launcher in the Run and Debug title — ▶ starts the selected configuration, the
// dropdown selects one among the configurations of all launches, the three latest dynamic ones, a row per debug type
// with dynamic configurations ("<label>...", which opens its picker) and "Add Configuration..." of each visible
// launch. The types with dynamic configurations are asked when they may have changed (a configuration provider came
// or went), which activates nothing. Deviations: the dropdown is a select box with separators between upstream's
// categories, without its filter box and hovers; a dropdown row that selects nothing (a picker cancelled, Add
// Configuration) leaves the selection as it was. Not here: `FocusSessionActionViewItem` (the session picker of the
// docked toolbar), the accessibility labels.

import type { TUIEventBase } from "@tuidom/core/dom/events/tuiEventBase";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { HFlexElement, hflexFit } from "@tuidom/elements/layout/hFlexElement";
import { type ISelectOptionItem, SelectBoxElement } from "@tuidom/elements/selectbox/selectBoxElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { type IDebugService, type IDynamicConfigurationProvider, State } from "../common/debug.ts";

import { DEBUG_START_COMMAND_ID } from "./debugCommands.ts";
import { ADD_CONFIGURATION_ID } from "./debugQuickAccess.ts";

export const NO_CONFIGURATIONS = "No Configurations";

interface IDebugOption {
    readonly label: string;
    /** `true` — a configuration was selected. */
    readonly handler: () => Promise<boolean>;
    /** Upstream's category of the dropdown: a separator goes between two. */
    readonly category: string | undefined;
}

/** The row between two categories: the select box does not select it. */
const SEPARATOR: IDebugOption = { label: "─", handler: () => Promise.resolve(false), category: undefined };

/** In a narrow title the selected configuration shrinks down to this many characters. */
const MIN_LABEL_WIDTH = 10;
/** The chevron and the space before it. */
const CHEVRON_WIDTH = 2;

/**
 * The select box of the configurations, as wide as the selected one (the select box keeps the width of the longest
 * option); it shrinks in a narrow title as upstream's `flex-shrink`.
 */
class ConfigurationDropdownElement extends SelectBoxElement {
    private texts: readonly string[] = [];

    public override setOptions(options: readonly ISelectOptionItem[], selected?: number): void {
        this.texts = options.map((option) => option.text);
        super.setOptions(options, selected);
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return Math.min(this.selectedWidth(), MIN_LABEL_WIDTH) + CHEVRON_WIDTH;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.selectedWidth() + CHEVRON_WIDTH;
    }

    private selectedWidth(): number {
        return (this.texts.at(this.getSelected()) ?? "").length;
    }
}

/** The ▶ of the launcher: a button of one glyph, pressed by a click, Enter or Space. */
class StartButtonElement extends TextLabelElement {
    public onActivate?: () => void;

    public constructor() {
        super("");
        this.focusable = true;
        this.style = {
            fg: "debugIcon.startForeground",
            when: [
                { states: ["hover"], bg: "toolbar.hoverBackground" },
                { states: ["focus"], bg: "toolbar.hoverBackground" },
            ],
        };
        this.addEventListener("click", (event) => {
            if (event.button !== "left") return;
            this.onActivate?.();
        });
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type !== "keydown") return;
        const keyEvent = event as TUIKeyboardEvent;
        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
            event.preventDefault();
            this.onActivate?.();
        }
    }
}

export class StartDebugActionViewItem extends Disposable {
    public readonly element = new HFlexElement();
    public readonly start = new StartButtonElement();
    public readonly dropdown: SelectBoxElement = new ConfigurationDropdownElement();
    private debugOptions: IDebugOption[] = [];
    private selected = 0;
    private providers: readonly IDynamicConfigurationProvider[] = [];

    public constructor(
        private readonly debugService: IDebugService,
        configurationService: Pick<IConfigurationService, "onDidChangeConfiguration">,
        private readonly commands: Pick<CommandRegistry, "execute">,
        private readonly contextService: Pick<IWorkspaceContextService, "getWorkbenchState">,
        private readonly icons: Pick<IProductIconService, "codicon" | "onDidChange">,
    ) {
        super();
        this.element.id = "debugStartActionItem";
        this.element.addChild(this.start, { width: hflexFit(), height: 1 });
        this.element.addChild(this.dropdown, { width: hflexFit(), height: 1 });
        this.renderStart();
        this.start.onActivate = () => {
            if (this.debugService.state !== State.Initializing) {
                Promise.resolve(this.commands.execute(DEBUG_START_COMMAND_ID)).catch(onUnexpectedError);
            }
        };
        this.dropdown.onDidSelect = ({ index }) => {
            this.select(index);
        };

        this.register(
            configurationService.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration("launch")) {
                    this.updateOptions();
                }
            }),
        );
        const configManager = this.debugService.getConfigurationManager();
        this.register(
            configManager.onDidSelectConfiguration(() => {
                this.updateOptions();
            }),
        );
        this.register(
            icons.onDidChange(() => {
                this.renderStart();
            }),
        );

        const updateDynamicConfigs = (): void => {
            void configManager.getDynamicProviders().then((providers) => {
                if (providers.length !== this.providers.length) {
                    this.providers = providers;
                    this.updateOptions();
                }
            });
        };
        this.register(configManager.onDidChangeConfigurationProviders(updateDynamicConfigs));
        updateDynamicConfigs();
        this.updateOptions();
    }

    private renderStart(): void {
        this.start.setText(` ${this.icons.codicon("debug-start")} `);
    }

    /** The option at a row of the dropdown, whose separators are rows too. */
    private select(row: number): void {
        const option = this.rows()[row];
        // Selection state and label are reconciled by updateOptions(), triggered by manager.onDidSelectConfiguration.
        void option.handler().then((selected) => {
            if (!selected) this.renderOptions();
        }, onUnexpectedError);
    }

    /** The dropdown's rows: the options, with a separator between two categories. */
    private rows(): IDebugOption[] {
        const rows: IDebugOption[] = [];
        this.debugOptions.forEach((option, index) => {
            if (index > 0 && option.category !== this.debugOptions[index - 1].category) rows.push(SEPARATOR);
            rows.push(option);
        });
        return rows;
    }

    private updateOptions(): void {
        this.selected = 0;
        this.debugOptions = [];
        const manager = this.debugService.getConfigurationManager();
        const inWorkspace = this.contextService.getWorkbenchState() === "workspace";
        let lastGroup: string | undefined;
        let groupOrder = 0;

        manager.getAllConfigurations().forEach(({ launch, name, presentation }) => {
            if (lastGroup !== presentation?.group) {
                lastGroup = presentation?.group;
                if (this.debugOptions.length) {
                    groupOrder++;
                }
            }
            if (name === manager.selectedConfiguration.name && launch === manager.selectedConfiguration.launch) {
                this.selected = this.debugOptions.length;
            }

            const label = inWorkspace ? `${name} (${launch.name})` : name;
            this.debugOptions.push({
                label,
                handler: async () => {
                    await manager.selectConfiguration(launch, name);
                    return true;
                },
                category: `configurations-${groupOrder}`,
            });
        });

        // Only take 3 elements from the recent dynamic configurations to not clutter the dropdown
        manager
            .getRecentDynamicConfigurations()
            .slice(0, 3)
            .forEach(({ name, type }) => {
                if (type === manager.selectedConfiguration.type && manager.selectedConfiguration.name === name) {
                    this.selected = this.debugOptions.length;
                }
                this.debugOptions.push({
                    label: name,
                    handler: async () => {
                        await manager.selectConfiguration(undefined, name, undefined, { type });
                        return true;
                    },
                    category: "recent-dynamic",
                });
            });

        if (this.debugOptions.length === 0) {
            this.debugOptions.push({
                label: NO_CONFIGURATIONS,
                handler: () => Promise.resolve(false),
                category: undefined,
            });
        }

        this.providers.forEach((p) => {
            this.debugOptions.push({
                label: `${p.label}...`,
                handler: async () => {
                    const picked = await p.pick();
                    if (picked) {
                        await manager.selectConfiguration(picked.launch, picked.config.name, picked.config, {
                            type: p.type,
                        });
                        return true;
                    }
                    return false;
                },
                category: "actions",
            });
        });

        manager
            .getLaunches()
            .filter((l) => !l.hidden)
            .forEach((l) => {
                const label = inWorkspace ? `Add Config (${l.name})...` : "Add Configuration...";
                this.debugOptions.push({
                    label,
                    handler: async () => {
                        await this.commands.execute(ADD_CONFIGURATION_ID, l.uri.toString());
                        return false;
                    },
                    category: "actions",
                });
            });

        this.renderOptions();
    }

    private renderOptions(): void {
        const rows = this.rows();
        const options: ISelectOptionItem[] = rows.map((row) =>
            row === SEPARATOR ? { text: row.label, isSeparator: true } : { text: row.label },
        );
        this.dropdown.setOptions(options, rows.indexOf(this.debugOptions[this.selected]));
    }
}

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
// Configuration) leaves the selection as it was. `FocusSessionActionViewItem` is in
// `focusSessionActionViewItem.ts` (the docked toolbar has a button that opens Select Debug Session instead). Not
// here: the accessibility labels.

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
    /** Selects the row's configuration, or does what the row does (a picker, Add Configuration). */
    readonly handler: () => Promise<unknown>;
}

/** The rows of the dropdown: upstream's categories (a separator goes between two) and the selected configuration. */
interface IDebugOptions {
    readonly groups: readonly (readonly IDebugOption[])[];
    readonly selected: IDebugOption | undefined;
}

/** A row that selects nothing: the separators and "No Configurations". */
const selectsNothing = (): Promise<void> => Promise.resolve();
/** The row between two categories: the select box does not select it. */
const SEPARATOR: IDebugOption = { label: "─", handler: selectsNothing };

/** In a narrow title the selected configuration shrinks down to this many characters. */
const MIN_LABEL_WIDTH = 8;
/** The chevron and the space before it. */
const CHEVRON_WIDTH = 2;

/**
 * The select box of the configurations, as wide as the selected one (the select box keeps the width of the longest
 * option); it shrinks in a narrow title as upstream's `flex-shrink`.
 */
class ConfigurationDropdownElement extends SelectBoxElement {
    // Stryker disable next-line ArrayDeclaration: equivalent — the launcher sets the options in its constructor, before any layout reads them
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
        // The launcher selects a row of every list it sets.
        return this.texts[this.getSelected()].length;
    }
}

/** The ▶ of the launcher: a button of one glyph, pressed by a click, Enter or Space. */
class StartButtonElement extends TextLabelElement {
    public constructor(
        text: string,
        private readonly onActivate: () => void,
    ) {
        super(text);
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
            this.onActivate();
        });
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type !== "keydown") return;
        const keyEvent = event as TUIKeyboardEvent;
        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
            event.preventDefault();
            this.onActivate();
        }
    }
}

export class StartDebugActionViewItem extends Disposable {
    public readonly element = new HFlexElement();
    public readonly start: StartButtonElement;
    public readonly dropdown: SelectBoxElement = new ConfigurationDropdownElement();
    private options: IDebugOptions;
    private providers: readonly IDynamicConfigurationProvider[] = [];

    public constructor(
        private readonly debugService: IDebugService,
        configurationService: Pick<IConfigurationService, "onDidChangeConfiguration">,
        private readonly commands: Pick<CommandRegistry, "execute">,
        private readonly contextService: Pick<IWorkspaceContextService, "getWorkbenchState">,
        icons: Pick<IProductIconService, "codicon" | "onDidChange">,
    ) {
        super();
        const startText = (): string => ` ${icons.codicon("debug-start")} `;
        this.start = new StartButtonElement(startText(), () => {
            if (this.debugService.state !== State.Initializing) {
                Promise.resolve(this.commands.execute(DEBUG_START_COMMAND_ID)).catch(onUnexpectedError);
            }
        });
        this.element.addChild(this.start, { width: hflexFit(), height: 1 });
        this.element.addChild(this.dropdown, { width: hflexFit(), height: 1 });
        this.dropdown.onDidSelect = ({ index }) => {
            this.select(index);
        };

        // Upstream rebuilds on a change of `launch` only; the rows are as cheap to rebuild as to check that.
        this.register(
            configurationService.onDidChangeConfiguration(() => {
                this.updateOptions();
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
                this.start.setText(startText());
            }),
        );

        const updateDynamicConfigs = (): void => {
            void configManager
                .getDynamicProviders()
                .then((providers) => {
                    this.providers = providers;
                    this.updateOptions();
                })
                .catch(onUnexpectedError);
        };
        this.register(configManager.onDidChangeConfigurationProviders(updateDynamicConfigs));
        updateDynamicConfigs();
        this.options = this.buildOptions();
        this.renderOptions();
    }

    /**
     * Runs the row's handler. Selecting a configuration rebuilds the rows (`onDidSelectConfiguration`); a row that
     * selects nothing (a cancelled picker, Add Configuration) puts the select box back on the selected configuration.
     */
    private select(row: number): void {
        const option = this.rows()[row];
        void option.handler().then(() => {
            this.renderOptions();
        }, onUnexpectedError);
    }

    /** The dropdown's rows: the groups, with a separator between two. */
    private rows(): readonly IDebugOption[] {
        return this.options.groups.flatMap((group, index) => (index > 0 ? [SEPARATOR, ...group] : group));
    }

    private updateOptions(): void {
        this.options = this.buildOptions();
        this.renderOptions();
    }

    private buildOptions(): IDebugOptions {
        const manager = this.debugService.getConfigurationManager();
        const inWorkspace = this.contextService.getWorkbenchState() === "workspace";
        const current = manager.selectedConfiguration;
        let selected: IDebugOption | undefined;

        // A category per group of `presentation`: the configurations come sorted by their group.
        const configurations = new Map<string | undefined, IDebugOption[]>();
        for (const { launch, name, presentation } of manager.getAllConfigurations()) {
            const option: IDebugOption = {
                label: inWorkspace ? `${name} (${launch.name})` : name,
                handler: () => manager.selectConfiguration(launch, name),
            };
            if (name === current.name && launch === current.launch) selected = option;
            const group = presentation?.group;
            configurations.set(group, [...(configurations.get(group) ?? []), option]);
        }

        // Only take 3 elements from the recent dynamic configurations to not clutter the dropdown
        const recent = manager
            .getRecentDynamicConfigurations()
            .slice(0, 3)
            .map(({ name, type }) => {
                const option: IDebugOption = {
                    label: name,
                    handler: () => manager.selectConfiguration(undefined, name, undefined, { type }),
                };
                if (type === current.type && name === current.name) selected = option;
                return option;
            });

        const groups = [...configurations.values(), recent];
        if (groups.every((group) => group.length === 0)) {
            groups.push([{ label: NO_CONFIGURATIONS, handler: selectsNothing }]);
        }

        const actions: IDebugOption[] = [
            ...this.providers.map((p) => ({
                label: `${p.label}...`,
                handler: async () => {
                    const picked = await p.pick();
                    if (picked) {
                        await manager.selectConfiguration(picked.launch, picked.config.name, picked.config, {
                            type: p.type,
                        });
                    }
                },
            })),
            ...manager
                .getLaunches()
                .filter((l) => !l.hidden)
                .map((l) => ({
                    label: inWorkspace ? `Add Config (${l.name})...` : "Add Configuration...",
                    handler: async () => {
                        await this.commands.execute(ADD_CONFIGURATION_ID, l.uri.toString());
                    },
                })),
        ];

        return { groups: [...groups, actions].filter((group) => group.length > 0), selected };
    }

    private renderOptions(): void {
        const rows = this.rows();
        const options: ISelectOptionItem[] = rows.map((row) =>
            row === SEPARATOR ? { text: row.label, isSeparator: true } : { text: row.label },
        );
        this.dropdown.setOptions(options, rows.indexOf(this.options.selected ?? rows[0]));
    }
}

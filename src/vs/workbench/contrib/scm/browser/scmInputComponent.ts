import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VFlexElement, vflexFit, vflexFixed } from "@tuidom/elements/layout/vFlexElement";

import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    keybindingLabelStyle,
    KeybindingRegistryDIToken,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import { Component } from "../../../browser/component.ts";
import { ActionButtonElement } from "../../../browser/parts/views/actionButtonElement.ts";
import { SCM_INPUT_MESSAGE_STATE } from "../../../common/stateKeys.ts";
import { SCM_CHANGES_VIEW_ID } from "../common/scmViews.ts";

import type { ScmChangesService } from "./changesService.ts";
import { ScmChangesServiceDIToken } from "./changesService.ts";
import type { ScmRepoStateService } from "./repoStateService.ts";
import { ScmRepoStateServiceDIToken } from "./repoStateService.ts";

export const ScmInputComponentDIToken = token<ScmInputComponent>("ScmInputComponent");

/**
 * Field, gap, button, bottom padding. No top padding: the CHANGES section header
 * already sets the block apart, a second blank line looked like a gap to nowhere.
 */
export const SCM_INPUT_HEIGHT = 4;

/** Marker that sets `scmInputFocus`, which Ctrl+Enter = commit depends on. */
export class ScmCommitInputElement extends InputElement {}

export interface IScmActionButtonState {
    readonly visible: boolean;
    readonly label: string;
    readonly command: string | null;
}

/** VS Code SCM action button rules. */
export function computeActionButton(
    hasChanges: boolean,
    repo: {
        readonly hasRepository: boolean;
        readonly branch: string | null;
        readonly upstream: string | null;
        readonly ahead: number;
        readonly behind: number;
    },
): IScmActionButtonState {
    if (!repo.hasRepository) return { visible: false, label: "", command: null };
    if (hasChanges) return { visible: true, label: "Commit", command: "git.commit" };
    if (repo.branch !== null && repo.upstream === null) {
        return { visible: true, label: "Publish Branch", command: "git.publish" };
    }
    if (repo.upstream !== null && repo.ahead + repo.behind > 0) {
        return {
            visible: true,
            label: `Sync Changes ↓${String(repo.behind)} ↑${String(repo.ahead)}`,
            command: "git.sync",
        };
    }
    return { visible: true, label: "Commit", command: null };
}

/**
 * The draft is persisted per project: write-through on every input, restore
 * strictly after `openWorkspace`.
 */
export class ScmInputComponent extends Component implements IContextKeyContributor {
    public static dependencies = [
        StateServiceDIToken,
        ScmChangesServiceDIToken,
        ScmRepoStateServiceDIToken,
        CommandRegistryDIToken,
        ProgressServiceDIToken,
        KeybindingRegistryDIToken,
        ContextKeyServiceDIToken,
    ] as const;

    public readonly input = new ScmCommitInputElement();
    public readonly actionButton = new ActionButtonElement();
    public readonly view: PaddingContainerElement;

    private buttonCommand: string | null = null;

    public constructor(
        private readonly stateService: IStateService,
        private readonly changesService: ScmChangesService,
        private readonly repoState: ScmRepoStateService,
        private readonly commands: CommandRegistry,
        private readonly progress: ProgressService,
        private readonly keybindings: KeybindingRegistry,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        this.register(
            this.stateService.onDidOpenWorkspace(() => {
                this.restoreDraft();
            }),
        );
        this.input.id = "scmCommitInput";
        this.updatePlaceholder();
        this.input.onChange = (value) => {
            this.stateService.store(SCM_INPUT_MESSAGE_STATE, value);
        };

        this.actionButton.id = "scmActionButton";
        this.actionButton.onActivate = () => {
            if (this.buttonCommand !== null) this.commands.execute(this.buttonCommand);
        };

        const stack = new VFlexElement();
        stack.addChild(this.input, { height: vflexFit(), width: "fill" });
        // The layout model has no gap concept: the gap is a filler with inherited background.
        stack.addChild(new FillerElement(), { height: vflexFixed(1), width: "fill" });
        stack.addChild(this.actionButton, { height: vflexFit(), width: "fill" });
        this.view = new PaddingContainerElement(stack, { left: 1, right: 1, top: 0, bottom: 1 });
        this.view.id = "scmInputBox";
        this.view.style = { fg: "sideBar.foreground", bg: "sideBar.background" };

        this.register(
            this.changesService.onDidChangeChanges(() => {
                this.updateActionButton();
            }),
        );
        this.register(
            this.repoState.onDidChangeState(() => {
                this.updateActionButton();
            }),
        );
        this.register(
            this.progress.onDidChange(() => {
                this.updateActionButton();
            }),
        );
        // The binding label changes: OS and Cmd are learned after startup (Ctrl+Enter → ⌘Enter),
        // tier on the first CSI-u key (Alt+Enter → Ctrl+Enter).
        this.register(
            this.contextKeys.onDidChange((changed) => {
                // Stryker disable next-line ConditionalExpression: recompute on an unrelated key gives the same text
                if (changed.has("isMac") || changed.has("macKeys") || changed.has("tier")) this.updatePlaceholder();
            }),
        );
        this.updateActionButton();
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("scmInputFocus", active instanceof ScmCommitInputElement);
    }

    /** The binding lives under `scmInputFocus` and the field may be unfocused — look up "as if focused". */
    private updatePlaceholder(): void {
        const chord = this.keybindings.getKeybindingForCommand("git.commit", this.contextKeys, {
            scmInputFocus: true,
        });
        this.input.placeholder =
            chord === undefined
                ? "Message"
                : `Message (${formatKeybinding(chord, keybindingLabelStyle(this.contextKeys))} to commit)`;
    }

    public get message(): string {
        return this.input.inputState.value;
    }

    public setMessage(value: string): void {
        this.input.inputState.value = value;
        this.stateService.store(SCM_INPUT_MESSAGE_STATE, value);
        this.input.markDirty();
    }

    public focus(): void {
        this.input.focus();
    }

    /** Strictly after `openWorkspace`, no write-through. */
    public restoreDraft(): void {
        const stored = this.stateService.get(SCM_INPUT_MESSAGE_STATE);
        if (stored === this.input.inputState.value) return;
        this.input.inputState.value = stored;
        this.input.markDirty();
    }

    private updateActionButton(): void {
        const state = computeActionButton(this.changesService.changes.length > 0, {
            hasRepository: this.repoState.hasRepository,
            branch: this.repoState.state.branch,
            upstream: this.repoState.state.upstream,
            ahead: this.repoState.state.ahead,
            behind: this.repoState.state.behind,
        });
        this.buttonCommand = state.command;
        this.actionButton.hidden = !state.visible;

        // An operation is running — progress owns the label. Disable is immediate (isBusy), while display
        // waits for a delay: the click is disabled instantly and a fast operation does not flash text.
        const running = this.progress.operationProgress(SCM_CHANGES_VIEW_ID);
        if (running !== null) {
            this.actionButton.setLabel(`${running.spinner} ${running.title}`);
            this.actionButton.setDisabled(true);
            return;
        }
        this.actionButton.setLabel(state.label);
        this.actionButton.setDisabled(state.command === null || this.progress.isBusy(SCM_CHANGES_VIEW_ID));
    }
}

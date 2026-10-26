import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import {
    type ILanguageStatus,
    type LanguageStatusService,
    LanguageStatusServiceDIToken,
    type LanguageStatusSeverity,
} from "../../../services/languageStatus/common/languageStatusService.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

export const LanguageStatusContributionDIToken =
    // Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string inside is only a debug label
    token<LanguageStatusContribution>("LanguageStatusContribution");

export const LANGUAGE_STATUS_ID = "status.languageStatus";
export const LANGUAGE_STATUS_NAME = "Editor Language Status";

/** Upstream places it left of `status.editor.mode` (70); the EOL segment (80) stays to its left. */
const LANGUAGE_STATUS_PRIORITY = 75;

/** Upstream `LanguageStatus._severityToComboCodicon`; any busy item turns it into a spinner. */
export function languageStatusGlyph(statuses: readonly ILanguageStatus[]): string {
    if (statuses.some((status) => status.busy)) return "$(loading~spin)";
    return SEVERITY_GLYPHS[statuses[0]?.severity ?? 0];
}

const SEVERITY_GLYPHS: Readonly<Record<LanguageStatusSeverity, string>> = {
    0: "$(bracket)",
    1: "$(bracket-dot)",
    2: "$(bracket-error)",
};

interface ILanguageStatusPick extends QuickPickItem {
    readonly status: ILanguageStatus;
}

/**
 * Upstream `LanguageStatus` (contrib/languageStatus): one combined segment for the active editor's items.
 * Deviation: a click opens a quick pick of the items instead of the hover — the bar has no hovers and not
 * every terminal has a mouse. No pinned (dedicated) segments.
 */
export class LanguageStatusContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [
        EditorServiceDIToken,
        StatusBarServiceDIToken,
        LanguageStatusServiceDIToken,
        QuickInputServiceDIToken,
        CommandRegistryDIToken,
        ProductIconServiceDIToken,
    ] as const;

    private handle: IStatusBarEntryHandle | null = null;
    private languageSubscription: IDisposable | null = null;
    // Stryker disable next-line ArrayDeclaration: the constructor's `follow` overwrites it before anything reads it
    private statuses: readonly ILanguageStatus[] = [];

    public constructor(
        private readonly editors: IEditorService,
        private readonly statusBar: StatusBarService,
        private readonly languageStatus: LanguageStatusService,
        private readonly quickInput: QuickInputService,
        private readonly commands: CommandRegistry,
        private readonly icons: IProductIconService,
    ) {
        super();
        this.register(
            editors.onActiveEditorChanged((editor) => {
                this.follow(editor);
            }),
        );
        this.register(
            languageStatus.onDidChange(() => {
                this.update();
            }),
        );
        this.register(
            icons.onDidChange(() => {
                this.update();
            }),
        );
        this.register({
            dispose: () => {
                this.languageSubscription?.dispose();
                this.handle?.dispose();
            },
        });
        this.follow(editors.getActiveEditor());
    }

    private follow(editor: TextEditorPane | null): void {
        this.languageSubscription?.dispose();
        this.languageSubscription =
            editor?.onDidChangeLanguage(() => {
                this.update();
            }) ?? null;
        this.update();
    }

    private update(): void {
        const editor = this.editors.getActiveEditor();
        this.statuses = editor === null ? [] : this.languageStatus.getLanguageStatus(editor.uri, editor.languageId);
        if (this.statuses.length === 0) {
            this.handle?.dispose();
            this.handle = null;
            return;
        }
        const text = this.icons.renderCodicons(languageStatusGlyph(this.statuses));
        if (this.handle !== null) {
            this.handle.update({ text });
            return;
        }
        this.handle = this.statusBar.addEntry({
            id: LANGUAGE_STATUS_ID,
            name: LANGUAGE_STATUS_NAME,
            text,
            alignment: "right",
            priority: LANGUAGE_STATUS_PRIORITY,
            // A fire-and-forget promise must not reject past the click: an unhandled rejection takes the process down.
            onClick: () => {
                this.showPicker().catch(onUnexpectedError);
            },
        });
    }

    private async showPicker(): Promise<void> {
        const items = this.statuses.map((status): ILanguageStatusPick => this.toPick(status));
        const picked = (await this.quickInput.quickPick({ title: LANGUAGE_STATUS_NAME, items })) as
            | ILanguageStatusPick
            | undefined;
        const command = picked?.status.command;
        if (command === undefined) return;
        const { id, arguments: args } = command;
        try {
            // A rejected extension command is logged by the registry.
            this.commands.execute(id, ...args);
        } catch {
            // A command that throws synchronously must not take the editor down; the item stays usable.
        }
    }

    private toPick(status: ILanguageStatus): ILanguageStatusPick {
        const render = (text: string): string => this.icons.renderCodicons(text);
        const { command } = status;
        return {
            status,
            label: render(status.label),
            // An empty description is not drawn at all, so it needs no guard.
            description: render(status.detail),
            ...(command === undefined ? {} : { hint: render(command.title) }),
        };
    }
}

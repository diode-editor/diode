import * as nodePath from "node:path";

import { onUnexpectedError } from "../../../../../base/common/errors.ts";
import { token } from "../../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkspaceContextService } from "../../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { QuickInputService } from "../../../../browser/parts/quickinput/quickInputService.ts";
import { QuickInputServiceDIToken } from "../../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickSessionItem } from "../../../../browser/parts/quickinput/quickPickSession.ts";
import type { ITerminalInstance } from "../../../terminal/browser/terminalService.ts";
import type { IDetectedLinks } from "../common/terminalDetectedLinks.ts";
import type { ITerminalLink } from "../common/terminalLinkProvider.ts";

import type { TerminalLinkOpener } from "./terminalLinkOpener.ts";
import {
    TerminalLinkOpenerDIToken,
    type TerminalLinkService,
    TerminalLinkServiceDIToken,
} from "./terminalLinkService.ts";

export const TERMINAL_LINK_QUICKPICK_PLACEHOLDER = "Select the link to open, type to filter all links";

export const TerminalLinkQuickpickDIToken = token<TerminalLinkQuickpick>("TerminalLinkQuickpick");

export interface ITerminalLinkQuickPickItem extends QuickPickSessionItem {
    readonly link: ITerminalLink;
}

/**
 * Upstream `TerminalLinkQuickpick`: the links of the viewport, all of the buffer once the user types. The
 * active item is underlined and scrolled into view in the terminal; closing restores the terminal's scroll.
 *
 * Ours: our picker has no group separators — the group label ("File", "Folder") is a hint on the group's first
 * row. The list starts with the viewport even when the whole buffer is ready (upstream races it for 500 ms).
 * The active file is not previewed in an editor (upstream `PickerEditorState`).
 */
export class TerminalLinkQuickpick {
    public static dependencies = [
        QuickInputServiceDIToken,
        TerminalLinkServiceDIToken,
        TerminalLinkOpenerDIToken,
        IWorkspaceContextServiceDIToken,
    ] as const;

    public constructor(
        private readonly quickInput: QuickInputService,
        private readonly links: TerminalLinkService,
        private readonly opener: TerminalLinkOpener,
        private readonly workspace: IWorkspaceContextService,
    ) {}

    /** Resolves when the picker closes; an accepted link opens after that. */
    public async show(instance: ITerminalInstance): Promise<void> {
        const detected = this.links.getLinks(instance);
        const viewport = await detected.viewport;
        const scrollOffset = instance.session.scrollOffset;

        return new Promise<void>((resolve) => {
            // A hidden pick neither repaints nor reports the active item: an update or a reveal after closing is moot.
            const pick = this.quickInput.createQuickPick<ITerminalLinkQuickPickItem>({
                onDidChangeValue: () => {
                    // The same promise every time: the buffer is collected once.
                    void detected.all.then((all) => {
                        pick.update({ items: this.picks(all) });
                    }, onUnexpectedError);
                },
                onDidChangeActive: (items) => {
                    this.links.revealLink(instance, items.at(0)?.link);
                },
                onDidAccept: () => {
                    const link = pick.getState().activeItems.at(0)?.link;
                    // Deferred, as the promise flavor: the rest of this Enter must not reach the terminal.
                    queueMicrotask(() => {
                        pick.dispose();
                        if (link !== undefined) this.opener.open(link).catch(onUnexpectedError);
                    });
                },
                onDidChangeSelection: () => undefined,
                onDidHide: () => {
                    this.links.revealLink(instance, undefined);
                    instance.session.scrollLines(instance.session.scrollOffset - scrollOffset);
                    resolve();
                },
            });
            pick.update({ items: this.picks(viewport), placeholder: TERMINAL_LINK_QUICKPICK_PLACEHOLDER });
            pick.show();
        });
    }

    private picks(links: IDetectedLinks): ITerminalLinkQuickPickItem[] {
        return [
            ...withGroupLabel(this.toPicks(links.fileLinks), "File"),
            ...withGroupLabel(this.toPicks(links.folderLinks), "Folder"),
        ];
    }

    /**
     * Upstream `_generatePicks`: one item per label + directory. Upstream also skips a repeated link text first;
     * the same text resolves to the same label and directory, so that is the same check.
     */
    private toPicks(links: readonly ITerminalLink[]): ITerminalLinkQuickPickItem[] {
        const labels = new Set<string>();
        const picks: ITerminalLinkQuickPickItem[] = [];
        for (const link of links) {
            const label = nodePath.basename(link.uri.fsPath) + suffixOf(link);
            const description = this.directoryOf(link);
            const key = `${label}|${description}`;
            if (labels.has(key)) continue;
            labels.add(key);
            picks.push({ label, description, link });
        }
        return picks;
    }

    /** As Go to File: relative to the workspace folder, absolute outside of one. */
    private directoryOf(link: ITerminalLink): string {
        const directory = nodePath.dirname(link.uri.fsPath);
        const folder = this.workspace.getWorkspaceFolder(link.uri);
        if (folder === null) return directory;
        return nodePath.relative(folder.uri.fsPath, directory).split(nodePath.sep).join("/");
    }
}

/** `:row[-rowEnd][:col[-colEnd]]`, as printed after the path (a folder's suffix too: it was in the output). */
function suffixOf(link: ITerminalLink): string {
    const suffix = link.parsedLink?.suffix;
    if (suffix?.row === undefined) return "";
    let text = `:${String(suffix.row)}`;
    if (suffix.rowEnd !== undefined) text += `-${String(suffix.rowEnd)}`;
    if (suffix.col !== undefined) {
        text += `:${String(suffix.col)}`;
        if (suffix.colEnd !== undefined) text += `-${String(suffix.colEnd)}`;
    }
    return text;
}

function withGroupLabel(picks: ITerminalLinkQuickPickItem[], label: string): ITerminalLinkQuickPickItem[] {
    return picks.map((pick, index) => (index === 0 ? { ...pick, hint: label } : pick));
}

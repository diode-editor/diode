import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { DiffSide } from "../../../../editor/common/diff/diffSide.ts";
import type { IFileService } from "../../../../platform/files/common/files.ts";
import { IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { IEditorGroupsService } from "../../../services/editor/common/editorGroupsService.ts";
import { EditorGroupsServiceDIToken } from "../../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { refreshDiffSnapshots } from "./openDiffPair.ts";

export const DiffSnapshotRefreshContributionDIToken = token<DiffSnapshotRefreshContribution>(
    "DiffSnapshotRefreshContribution",
);

/** Pause for a burst of provider events (git touches `.git` in batches on rebase/commit). */
const REFRESH_DEBOUNCE_MS = 200;

/** US-31: snapshot sides (a `git:` revision) don't update themselves; refresh them on providers' `onDidChangeFile`. */
export class DiffSnapshotRefreshContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [EditorGroupsServiceDIToken, IFileServiceDIToken, EditorServiceDIToken] as const;

    private readonly pending = new Set<string>();
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    /** Monotonic run number: stale async reads don't overwrite fresh ones. */
    private refreshSeq = 0;

    public constructor(
        private readonly groups: IEditorGroupsService,
        private readonly providers: IFileService,
        private readonly editors: IEditorService,
    ) {
        super();
        this.register(
            this.providers.onDidFilesChange((uris) => {
                this.schedule(uris);
            }),
        );
        this.register({
            dispose: () => {
                if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
            },
        });
    }

    private schedule(uris: readonly Uri[]): void {
        for (const uri of uris) this.pending.add(uri.toString());
        if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            void this.flush();
        }, REFRESH_DEBOUNCE_MS);
    }

    private async flush(): Promise<void> {
        const changed = new Set(this.pending);
        this.pending.clear();
        const seq = ++this.refreshSeq;

        for (const group of this.groups.groups) {
            for (const pane of group.getPanes()) {
                if (!(pane instanceof DiffEditorPane2)) continue;
                if (!pane.snapshotSides().some((side) => this.sideTouched(pane, side, changed))) continue;
                await refreshDiffSnapshots({ files: this.providers, editors: this.editors }, pane);
                /* v8 ignore start -- the race "a new batch arrived while reading" can't be reproduced
                   deterministically in a unit test: its run is already scheduled, ours is stale */
                if (seq !== this.refreshSeq) return;
                /* v8 ignore stop */
            }
        }
    }

    /** The side's resource (the real one from the command input, not the model's synthetic one). */
    private sideTouched(pane: DiffEditorPane2, side: DiffSide, changed: ReadonlySet<string>): boolean {
        const uri = side === "original" ? pane.originalUri : pane.modifiedUri;
        return uri !== null && changed.has(uri.toString());
    }
}

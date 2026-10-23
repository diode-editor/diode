import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRegistryExtensionMeta } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type {
    IExtensionListEntry,
    IExtensionOperationResult,
    IExtensionsWorkbenchService,
} from "../common/extensionsWorkbench.ts";

import type { IExtensionPageActions } from "./extensionPageActions.ts";
import type { ExtensionButtonKind } from "./extensionPageButtons.ts";
import { describeExtensionButtons } from "./extensionPageButtons.ts";
import type { IExtensionPageContent } from "./extensionPageContent.ts";
import { ExtensionPageElement } from "./extensionPageElement.ts";

/** Tab identity, not a file: `EditorService.openPane` uses it to switch to an already open page. */
export const EXTENSION_SCHEME = "extension";

export function extensionUri(id: string): Uri {
    return Uri.from({ scheme: EXTENSION_SCHEME, path: id });
}

/**
 * No text projection: there is no `viewState`, so cursor commands do not see it. Subscribes to the service
 * because the entry can change while the tab is open.
 */
export class ExtensionEditorPane extends Disposable implements IEditorPane {
    public readonly uri: Uri;
    public readonly view: TUIElement;
    public readonly isModified = false;
    public readonly readOnly = true;

    private readonly element: ExtensionPageElement;
    private readonly onDidChangeStateEmitter = this.register(new Emitter<void>());
    private labelValue: string;
    private busy = false;
    /**
     * Monotonic and owned by the pane: a removed extension outside the registry drops out of the entries,
     * but the reload prompt must stay.
     */
    private needsReload: boolean;
    private operationError: string | null = null;

    public constructor(
        private readonly service: IExtensionsWorkbenchService,
        private readonly actions: IExtensionPageActions,
        private entry: IExtensionListEntry,
        private readonly meta: IRegistryExtensionMeta | undefined,
        private readonly metaError: string | null,
    ) {
        super();
        this.uri = extensionUri(entry.id);
        this.labelValue = entry.displayName;
        this.needsReload = entry.needsReload;
        this.element = new ExtensionPageElement(this.content(), this.buttons(), (kind) => {
            this.activateButton(kind);
        });
        // Dots in the id are outside the inspector selector alphabet (`#id`), same as for view containers.
        this.element.id = `extensionPage-${entry.id.replaceAll(".", "-")}`;
        this.element.style = { fg: "editor.foreground", bg: "editor.background" };
        this.view = this.element;

        this.register(
            service.onDidChange(() => {
                this.syncEntry();
            }),
        );
        this.register(
            actions.onDidChangeAutoUpdate(() => {
                this.render();
            }),
        );
    }

    public get label(): string {
        return this.labelValue;
    }

    public getSelectedTexts(): string[] {
        return [];
    }

    public readonly onDidChangeState = this.onDidChangeStateEmitter.event;

    public focusEditor(): void {
        this.element.focus();
    }

    private content(): IExtensionPageContent {
        return {
            entry: this.entry,
            meta: this.meta,
            metaError: this.metaError,
            operationError: this.operationError,
        };
    }

    private buttons(): ReturnType<typeof describeExtensionButtons> {
        return describeExtensionButtons(this.entry, {
            busy: this.busy,
            needsReload: this.needsReload,
            autoUpdate: this.actions.isAutoUpdateEnabled(),
        });
    }

    private render(): void {
        this.element.setContent(this.content(), this.buttons());
    }

    private activateButton(kind: ExtensionButtonKind): void {
        if (kind === "reload") {
            this.actions.reloadWindow();
            return;
        }
        if (kind === "uninstall") {
            void this.runOperation(() => this.actions.uninstall(this.entry.id));
            return;
        }
        if (kind === "installAnotherVersion") {
            void this.installAnotherVersion();
            return;
        }
        if (kind === "toggleAutoUpdate") {
            void this.toggleAutoUpdate();
            return;
        }
        // install and update are the same operation: installing removes previous versions.
        void this.runOperation(() => this.actions.install(this.entry.id));
    }

    /** The buttons stay enabled while the picker is open: nothing runs until a version is picked. */
    private async installAnotherVersion(): Promise<void> {
        const id = this.entry.id;
        let version: string | undefined;
        try {
            version = await this.actions.pickVersion(id);
        } catch (error) {
            this.operationError = error instanceof Error ? error.message : String(error);
            this.render();
            return;
        }
        if (version === undefined) return;
        await this.runOperation(() => this.actions.install(id, { version }));
    }

    /** Not an operation: only the pin changes, so no busy state and no reload; the card brings the new label. */
    private async toggleAutoUpdate(): Promise<void> {
        const result = await this.actions.setAutoUpdate(this.entry.id, this.entry.pinned);
        this.operationError = result.ok ? null : result.error;
        this.render();
    }

    private async runOperation(run: () => Promise<IExtensionOperationResult>): Promise<void> {
        this.busy = true;
        this.operationError = null;
        this.render();
        const result = await run();
        this.busy = false;
        if (!result.ok) {
            this.operationError = result.error;
            this.render();
            return;
        }
        this.needsReload = true;
        this.render();
        // Focus lands on the first button, which is now Reload Window.
        this.element.focus();
    }

    private syncEntry(): void {
        const fresh = this.service.getEntries().find((e) => e.id === this.entry.id);
        if (fresh === undefined) {
            // The entry is gone: removed and not in the registry. Don't close the tab under the user.
            this.entry = { ...this.entry, installedVersion: null };
            this.render();
            return;
        }
        this.entry = fresh;
        // Monotonic: only a window reload clears it.
        this.needsReload = this.needsReload || fresh.needsReload;
        this.render();
        if (fresh.displayName !== this.labelValue) {
            this.labelValue = fresh.displayName;
            this.onDidChangeStateEmitter.fire();
        }
    }
}

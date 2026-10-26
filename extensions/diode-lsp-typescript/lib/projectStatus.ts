import * as path from "node:path";

import {
    configFileBaseName,
    inferredProjectConfigText,
    isImplicitProjectConfigFile,
    type ProjectType,
    projectTypeForLanguage,
    workspaceRootForFile,
} from "./projectConfig.ts";

/**
 * Upstream `IntellisenseStatus` and the `tsconfig.ts` commands over the stock `typescript-language-server`:
 * `projectInfo` goes through its `typescript.tsserverRequest`. Deviations: "Configure JSConfig" writes the
 * config to disk with one workspace edit and opens it (no untitled buffer and snippet); a `projectInfo`
 * without an answer removes the item instead of leaving it loading; the active editor is
 * `window.activeTextEditor`, not the active tab.
 */

export const OPEN_CONFIG_COMMAND = "_typescript.openConfig";
export const CREATE_OR_OPEN_CONFIG_COMMAND = "_typescript.createOrOpenConfig";
export const TYPESCRIPT_GO_TO_PROJECT_CONFIG_COMMAND = "typescript.goToProjectConfig";
export const JAVASCRIPT_GO_TO_PROJECT_CONFIG_COMMAND = "javascript.goToProjectConfig";

export const PROJECT_STATUS_ITEM_ID = "typescript.projectStatus";
export const PROJECT_STATUS_ITEM_NAME = "JS/TS IntelliSense Status";

const JSCONFIG_DOCS = "https://go.microsoft.com/fwlink/?linkid=759670";
const TSCONFIG_DOCS = "https://go.microsoft.com/fwlink/?linkid=841896";

export interface IProjectStatusEditor {
    readonly uri: string;
    readonly scheme: string;
    readonly fsPath: string;
    readonly languageId: string;
}

export interface IProjectStatusCommand {
    readonly command: string;
    readonly title: string;
    readonly arguments?: unknown[];
}

/** The subset of `vscode.LanguageStatusItem` the status writes; severity stays Information. */
export interface IProjectStatusItem {
    text: string;
    detail?: string | undefined;
    busy: boolean;
    command: IProjectStatusCommand | undefined;
    dispose(): void;
}

export interface IProjectStatusHost {
    createItem(): IProjectStatusItem;
    /** `configFileName` from tsserver's `projectInfo`; `undefined` when the server gave no answer. */
    projectInfo(documentUri: string): Promise<string | undefined>;
    workspaceFolders(): readonly string[];
    asRelativePath(filePath: string): string;
    fileExists(filePath: string): Promise<boolean>;
    /** Creates the file with the text as one undoable workspace edit. */
    createFile(filePath: string, text: string): PromiseLike<boolean>;
    openFile(filePath: string): Promise<void>;
    showInformationMessage(message: string, ...items: string[]): PromiseLike<string | undefined>;
    showWarningMessage(message: string): void;
}

/** Arguments of the item's command: a workspace folder path, not a `Uri`, so they survive the wire as is. */
type ConfigCommandArgs = [root: string, projectType: ProjectType];

type State =
    | { readonly type: "none" }
    | { readonly type: "pending"; readonly editor: IProjectStatusEditor; readonly projectType: ProjectType }
    | {
          readonly type: "resolved";
          readonly editor: IProjectStatusEditor;
          readonly projectType: ProjectType;
          readonly configFile: string;
      };

const NONE: State = { type: "none" };

export class ProjectStatus {
    private readonly host: IProjectStatusHost;
    private item: IProjectStatusItem | undefined;
    private state: State = NONE;
    private ready = false;
    private failed = false;
    private editor: IProjectStatusEditor | undefined;

    public constructor(host: IProjectStatusHost) {
        this.host = host;
    }

    /** The language server started: the pending editor gets its project. */
    public setReady(): void {
        this.ready = true;
        void this.update(this.editor);
    }

    /** The language server did not start: no item, it would never leave Loading. */
    public setFailed(): void {
        this.failed = true;
        this.setState(NONE);
    }

    public async update(editor: IProjectStatusEditor | undefined): Promise<void> {
        this.editor = editor;
        // The client syncs only `file` documents with the server.
        if (editor?.scheme !== "file" || this.failed) {
            this.setState(NONE);
            return;
        }
        const projectType = projectTypeForLanguage(editor.languageId);
        if (projectType === undefined) {
            this.setState(NONE);
            return;
        }
        const pending: State = { type: "pending", editor, projectType };
        this.setState(pending);
        if (!this.ready) return;

        const configFile = await this.host.projectInfo(editor.uri);
        // A newer editor or state took over while the request was in flight.
        if (this.state !== pending) return;
        this.setState(configFile === undefined ? NONE : { type: "resolved", editor, projectType, configFile });
    }

    /**
     * A jsconfig/tsconfig appeared, changed or went away, and the server has been told: ask again for the same
     * editor. Without the Loading flash; a request already in flight may predate the change, so it is restarted.
     */
    public async refresh(): Promise<void> {
        const state = this.state;
        // Before the server is ready this only shows Loading again.
        if (state.type === "pending") {
            await this.update(state.editor);
            return;
        }
        if (state.type !== "resolved") return;
        const configFile = await this.host.projectInfo(state.editor.uri);
        if (this.state !== state || configFile === undefined) return;
        this.setState({ ...state, configFile });
    }

    public dispose(): void {
        this.item?.dispose();
        this.item = undefined;
    }

    /** Commands by id, for the extension to register. */
    public commands(): Record<string, (...args: unknown[]) => Promise<void>> {
        return {
            [OPEN_CONFIG_COMMAND]: async (...args) => {
                const [root, projectType] = args as ConfigCommandArgs;
                if (this.state.type === "resolved") {
                    await this.openProjectConfigOrPromptToCreate(projectType, root, this.state.configFile);
                } else if (this.state.type === "pending") {
                    await this.openProjectConfigForFile(projectType, this.state.editor);
                }
            },
            [CREATE_OR_OPEN_CONFIG_COMMAND]: async (...args) => {
                const [root, projectType] = args as ConfigCommandArgs;
                await this.openOrCreateConfig(projectType, root);
            },
            [TYPESCRIPT_GO_TO_PROJECT_CONFIG_COMMAND]: () => this.goToProjectConfig("typescript"),
            [JAVASCRIPT_GO_TO_PROJECT_CONFIG_COMMAND]: () => this.goToProjectConfig("javascript"),
        };
    }

    private async goToProjectConfig(projectType: ProjectType): Promise<void> {
        const editor = this.editor;
        if (editor !== undefined && projectTypeForLanguage(editor.languageId) !== undefined) {
            await this.openProjectConfigForFile(projectType, editor);
        }
    }

    /** Upstream `openProjectConfigForFile`. */
    private async openProjectConfigForFile(projectType: ProjectType, editor: IProjectStatusEditor): Promise<void> {
        const root = workspaceRootForFile(this.host.workspaceFolders(), editor.fsPath);
        if (root === undefined) {
            void this.host.showInformationMessage(
                "Please open a folder in Diode to use a TypeScript or JavaScript project",
            );
            return;
        }
        const configFile = this.failed ? undefined : await this.host.projectInfo(editor.uri);
        if (configFile === undefined) {
            this.host.showWarningMessage("Could not determine TypeScript or JavaScript project");
            return;
        }
        await this.openProjectConfigOrPromptToCreate(projectType, root, configFile);
    }

    /** Upstream `openProjectConfigOrPromptToCreate`. */
    private async openProjectConfigOrPromptToCreate(
        projectType: ProjectType,
        root: string,
        configFile: string,
    ): Promise<void> {
        if (!isImplicitProjectConfigFile(configFile)) {
            await this.host.openFile(configFile);
            return;
        }
        const createItem = projectType === "typescript" ? "Configure tsconfig.json" : "Configure jsconfig.json";
        const message =
            projectType === "typescript"
                ? `File is not part of a TypeScript project. View the [tsconfig.json documentation](${TSCONFIG_DOCS}) to learn more.`
                : `File is not part of a JavaScript project. View the [jsconfig.json documentation](${JSCONFIG_DOCS}) to learn more.`;
        if ((await this.host.showInformationMessage(message, createItem)) === createItem) {
            await this.openOrCreateConfig(projectType, root);
        }
    }

    /** Upstream `openOrCreateConfig`; an existing file is opened as is, never overwritten. */
    private async openOrCreateConfig(projectType: ProjectType, root: string): Promise<void> {
        const configFile = path.join(root, configFileBaseName(projectType));
        if (
            (await this.host.fileExists(configFile)) ||
            (await this.host.createFile(configFile, inferredProjectConfigText(projectType)))
        ) {
            await this.host.openFile(configFile);
        }
    }

    private setState(state: State): void {
        this.state = state;
        switch (state.type) {
            case "none":
                this.dispose();
                break;
            case "pending": {
                const item = this.ensureItem();
                item.text = "Loading IntelliSense status";
                item.detail = undefined;
                item.command = undefined;
                item.busy = true;
                break;
            }
            case "resolved":
                this.showResolved(state.editor, state.projectType, state.configFile);
                break;
        }
    }

    private showResolved(editor: IProjectStatusEditor, projectType: ProjectType, configFile: string): void {
        const item = this.ensureItem();
        const noConfigText = projectType === "typescript" ? "No tsconfig" : "No jsconfig";
        const folders = this.host.workspaceFolders();
        const root = workspaceRootForFile(folders, editor.fsPath);
        item.busy = false;
        if (root === undefined) {
            item.text = noConfigText;
            item.detail = folders.length === 0 ? "No opened folders" : "File is not part opened folders";
            item.command = undefined;
            return;
        }
        item.detail = undefined;
        const args: ConfigCommandArgs = [root, projectType];
        if (isImplicitProjectConfigFile(configFile)) {
            item.text = noConfigText;
            item.command = {
                command: CREATE_OR_OPEN_CONFIG_COMMAND,
                title: projectType === "typescript" ? "Configure TSConfig" : "Configure JSConfig",
                arguments: args,
            };
        } else {
            item.text = this.host.asRelativePath(configFile);
            item.command = { command: OPEN_CONFIG_COMMAND, title: "Open Config File", arguments: args };
        }
    }

    private ensureItem(): IProjectStatusItem {
        this.item ??= this.host.createItem();
        return this.item;
    }
}

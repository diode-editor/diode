import * as path from "node:path";

import { codicon } from "../../../../base/common/codicons.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { FileType, type IFileService } from "../../../../platform/files/common/files.ts";
import { type IProductIconService, NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import type {
    QuickPickSession,
    QuickPickSessionItem,
    QuickPickSessionState,
} from "../../../browser/parts/quickinput/quickPickSession.ts";

import {
    endsWithSeparator,
    equalsIgnoreCase,
    expandTilde,
    type IFileDialogFilter,
    isValidBasename,
    matchesFilters,
    pathAppend,
    pathsEqual,
    startsWithIgnoreCase,
    stripTrailingSeparator,
    withFilterExtension,
    withSeparator,
} from "./fileDialogPaths.ts";

export type { IFileDialogFilter } from "./fileDialogPaths.ts";

/** Upstream `IOpenDialogOptions` without remote file systems. */
export interface IOpenDialogOptions {
    readonly title?: string;
    readonly defaultUri?: Uri;
    readonly openLabel?: string;
    readonly canSelectFiles?: boolean;
    readonly canSelectFolders?: boolean;
    readonly canSelectMany?: boolean;
    readonly filters?: readonly IFileDialogFilter[];
}

/** Upstream `ISaveDialogOptions` without remote file systems. */
export interface ISaveDialogOptions {
    readonly title?: string;
    readonly defaultUri?: Uri;
    readonly saveLabel?: string;
    readonly filters?: readonly IFileDialogFilter[];
}

/** A dialog row: a file or a directory (a directory path ends with a separator). */
interface IFileItem extends QuickPickSessionItem {
    readonly path: string;
    readonly isFolder: boolean;
}

/** Outcome of updating the list from typed input; upstream `UpdateResult`. */
const enum UpdateResult {
    Updated,
    NotUpdated,
    InvalidPath,
}

export interface ISimpleFileDialogEnvironment {
    readonly userHome: string;
    readonly defaultFolder: () => string;
}

const FOLDER_ICON = codicon("folder");
const FILE_ICON = codicon("file");

/**
 * Port of upstream `SimpleFileDialog` (its terminal dialog, `files.simpleDialog.enable`).
 * Single-use: one show per instance, so state lives in fields without a reset.
 *
 * Deviations: local file system only, no "OK"/"Show Local"/"hide dot files" buttons and no
 * file-type icons. Upstream tells its own value change from user typing by the
 * `userEnteredPathSegment`/`autoCompletePathSegment` segments because its picker events arrive
 * later; ours are synchronous, so our own change is flagged for the duration of the call, and
 * `onDidChangeActive` comes only from the user. The one visible difference: input erased down to
 * the directory does not highlight the first row (there is nothing to match an empty name against).
 */
export class SimpleFileDialog {
    // Set in show*Dialog, before the first read.
    private title!: string | undefined;
    private filters!: readonly IFileDialogFilter[] | undefined;
    private defaultUri!: Uri | undefined;
    private allowFileSelection!: boolean;
    private allowFolderSelection!: boolean;
    /** Save dialog: the path ends with a file name (upstream `requiresTrailing`). */
    private requiresTrailing = false;
    private trailing: string | undefined;
    // Set in pickResource before the picker is shown.
    private currentFolder!: string;
    private badPath: string | undefined;
    private hidden = false;
    /** The dialog itself is changing the query line; this is not user typing. */
    private settingValue = false;
    /** The current directory load; a newer one supersedes the previous by number. */
    private updating: Promise<void> | undefined;
    private updateGeneration = 0;
    /** User typing still being processed (stat, loading): all started value changes. */
    private valueChanges: Promise<unknown> = Promise.resolve();
    /** Created in pickResource; nobody calls in before that. */
    private session!: QuickPickSession<IFileItem>;

    public constructor(
        private readonly quickInput: QuickInputService,
        private readonly files: IFileService,
        private readonly environment: ISimpleFileDialogEnvironment,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {}

    public async showOpenDialog(options: IOpenDialogOptions = {}): Promise<Uri[] | undefined> {
        this.takeCommonOptions(options);
        // Neither files nor folders requested means files (upstream `_convertOpenOptions`).
        this.allowFolderSelection = options.canSelectFolders === true;
        this.allowFileSelection = options.canSelectFiles === true || !this.allowFolderSelection;
        const picked = await this.pickResource();
        return picked === undefined ? undefined : [Uri.file(picked)];
    }

    public async showSaveDialog(options: ISaveDialogOptions = {}): Promise<Uri | undefined> {
        this.takeCommonOptions(options);
        // Directories are always visible anyway; folder selection is checked only when opening.
        this.allowFileSelection = true;
        this.requiresTrailing = true;
        const picked = await this.pickResource();
        return picked === undefined ? undefined : Uri.file(picked);
    }

    private takeCommonOptions(options: IOpenDialogOptions | ISaveDialogOptions): void {
        this.title = options.title;
        this.filters = options.filters;
        this.defaultUri = options.defaultUri;
    }

    private get value(): string {
        return this.state().value;
    }

    private state(): QuickPickSessionState<IFileItem> {
        return this.session.getState();
    }

    private update(changes: Partial<QuickPickSessionState<IFileItem>>): void {
        this.session.update(changes);
    }

    /** The query line value and its selection; by default the cursor is at the end. */
    private setValue(value: string, selection?: readonly [number, number]): void {
        this.settingValue = true;
        try {
            this.update({ value, valueSelection: selection ?? [value.length, value.length] });
        } finally {
            this.settingValue = false;
        }
    }

    private async pickResource(): Promise<string | undefined> {
        let homedir = this.defaultUri?.fsPath ?? this.environment.defaultFolder();
        // A `defaultUri` pointing at a file (or at something that does not exist yet) puts its name into the line.
        if (this.defaultUri !== undefined && (await this.statOrUndefined(homedir))?.isDirectory !== true) {
            this.trailing = path.basename(homedir);
            homedir = path.dirname(homedir);
        }

        return new Promise<string | undefined>((resolve) => {
            let isResolving = 0;
            let isAcceptHandled = false;
            const session = this.quickInput.createQuickPick<IFileItem>({
                onDidChangeValue: (value) => {
                    if (this.settingValue) return;
                    this.valueChanges = Promise.all([this.valueChanges, this.handleValueChange(value)]);
                },
                onDidAccept: () => {
                    handleAccept();
                },
                onDidChangeActive: (items) => {
                    isAcceptHandled = false;
                    // The user moved the highlight, so the query line follows it.
                    const item = items.at(0);
                    if (item === undefined) return;
                    this.update({ validationMessage: undefined });
                    this.completeWith(item);
                },
                onDidChangeSelection: () => undefined,
                onDidHide: () => {
                    this.hidden = true;
                    if (isResolving === 0) doResolve(undefined);
                },
            });
            this.session = session;

            const doResolve = (picked: string | undefined): void => {
                resolve(picked === undefined ? undefined : stripTrailingSeparator(picked));
                session.dispose();
            };

            const handleAccept = (): void => {
                if (isAcceptHandled) return;
                isAcceptHandled = true;
                isResolving++;
                void this.onDidAccept().then((picked) => {
                    if (picked !== undefined) {
                        doResolve(picked);
                    } else if (this.hidden) {
                        doResolve(undefined);
                    } else {
                        isResolving--;
                        isAcceptHandled = false;
                    }
                });
            };

            this.currentFolder = withSeparator(path.dirname(homedir));
            session.update({
                title: this.title,
                placeholder: "Folder path",
                matchOnLabel: false,
                value: withSeparator(this.currentFolder),
            });
            session.show();
            const trailing = this.trailing;
            void this.updateItems(homedir, { force: true, trailing }).then(() => {
                const value = this.value;
                const name = trailing ?? "";
                // The name without its extension is selected: "[report].txt". Without a name the
                // cursor is already at the end, since loading sets the line.
                // Stryker disable next-line ConditionalExpression,StringLiteral: without a name the selection is empty and at the end of the line, exactly where loading left the cursor
                if (this.requiresTrailing && name !== "") {
                    const ext = path.extname(name);
                    this.update({ valueSelection: [value.length - name.length, value.length - ext.length] });
                }
            });
        });
    }

    private async handleValueChange(value: string): Promise<void> {
        try {
            // Typing further along a nonexistent path: no stat per keystroke
            // (there is no highlight there, as the path leads to no row).
            if (this.isBadSubpath(value) && !this.canTildaEscapeHatch(value)) return;
            this.update({ validationMessage: undefined });
            // Highlight by the query line as it is now: text typed during the path check
            // is accounted for both here and in the handler of its own change.
            if ((await this.tryUpdateItems(value, this.filePickBoxValue())) === UpdateResult.NotUpdated) {
                this.setActiveItems();
            }
        } catch {
            // Anything can be typed; invalid input breaks nothing.
        }
    }

    private isBadSubpath(value: string): boolean {
        // The bad path itself never gets here: the next value change is already different.
        const bad = this.badPath;
        return bad !== undefined && startsWithIgnoreCase(value, bad);
    }

    /** The path typed in the query line (a relative one is resolved against the current directory). */
    private filePickBoxValue(): string {
        const typed = this.value.trimEnd();
        const resolved = path.isAbsolute(typed) ? typed : path.join(this.currentFolder, typed);
        // A trailing ".." stays a segment: the directory above it is where it was typed.
        if (path.basename(typed) === "..") return withSeparator(path.normalize(resolved)) + "..";
        return endsWithSeparator(typed) ? withSeparator(resolved) : resolved;
    }

    private async onDidAccept(): Promise<string | undefined> {
        // Enter during typing processing or a directory load is handled after them:
        // rows and highlight then belong to the directory in the query line, rather than
        // a path typed right after swallowing Enter by navigating into its directory.
        await this.valueChanges;
        await this.updating;
        const item = this.state().activeItems.at(0);
        if (item?.isFolder === true) {
            // Enter the directory. When saving, the typed name moves there too and the
            // cursor goes before it; without a name, to the end.
            await this.updateItems(item.path, { force: true, trailing: this.trailing });
            const at = this.value.length - (this.trailing ?? "").length;
            this.update({ valueSelection: [at, at] });
            return undefined;
        }
        // The input changed the directory, so it is too early to accept (a highlighted file
        // does not change the directory: the query line then leads into it).
        if ((await this.tryUpdateItems(this.value, this.filePickBoxValue())) !== UpdateResult.NotUpdated) {
            return undefined;
        }

        let picked = item === undefined ? this.filePickBoxValue() : item.path;
        // Stryker disable next-line ConditionalExpression: when opening the outcome is the same, since a file with the filter extension would be highlighted by the typed name prefix and accepted as a row
        if (this.requiresTrailing) picked = withFilterExtension(picked, this.filters);
        return (await this.validate(picked)) ? picked : undefined;
    }

    private canTildaEscapeHatch(value: string): boolean {
        return value.endsWith("~") && this.isBadSubpath(value);
    }

    private async tryUpdateItems(value: string, valuePath: string): Promise<UpdateResult> {
        if (value.startsWith("~")) {
            await this.updateItems(expandTilde(value, this.environment.userHome), { force: true });
            return UpdateResult.Updated;
        }
        if (this.canTildaEscapeHatch(value)) {
            await this.updateItems(this.environment.userHome, { force: true });
            return UpdateResult.Updated;
        }
        // Upstream has "not the same directory AND (separator OR parent OR
        // unrelated)" here, but its "parent" includes equality and "unrelated" is
        // its negation, so the parenthesized part is always true.
        if (!pathsEqual(this.currentFolder, valuePath)) {
            const stat = await this.statOrUndefined(valuePath);
            // The user kept typing during the stat: the answer about the old value is stale,
            // and loading by it would override a fresher one (deviation from upstream,
            // where the same race is left open).
            if (this.value !== value) return UpdateResult.NotUpdated;
            if (stat?.isDirectory === true && endsWithSeparator(value)) {
                await this.updateItems(withSeparator(valuePath));
                return UpdateResult.Updated;
            } else if (endsWithSeparator(value)) {
                // No such directory. Remember the bad prefix: a user who typed a
                // nonexistent path usually keeps typing it, and a stat per keystroke
                // would be expensive.
                this.update({ validationMessage: "The path does not exist. Use ~ to go to your home directory." });
                this.badPath = value;
                return UpdateResult.InvalidPath;
            } else {
                const inputDirname = path.dirname(valuePath);
                if (!pathsEqual(this.currentFolder, inputDirname)) {
                    const dirStat = await this.statOrUndefined(inputDirname);
                    if (this.value !== value) return UpdateResult.NotUpdated;
                    if (dirStat?.isDirectory === true) {
                        this.badPath = undefined;
                        await this.updateItems(withSeparator(inputDirname), { trailing: path.basename(valuePath) });
                        return UpdateResult.Updated;
                    }
                }
            }
        }
        this.badPath = undefined;
        return UpdateResult.NotUpdated;
    }

    /**
     * Highlights by typed input: the first row of the current directory whose name
     * starts with the input (case-insensitive). When saving with a file name only
     * directories are highlighted, so typing a name must not latch onto another file;
     * the typed name with its extension then becomes that name.
     */
    private setActiveItems(): void {
        // A path ending with a separator is a directory: its name lives one level up.
        const typed = this.filePickBoxValue();
        const name = path.basename(typed);
        // Loading is still in progress, so list rows belong to the previous directory.
        const match =
            this.updating === undefined && name !== "" && pathsEqual(path.dirname(typed), this.currentFolder)
                ? this.state().items.find((item) => item.label !== ".." && startsWithIgnoreCase(item.label, name))
                : undefined;
        if (match !== undefined && (match.isFolder || this.trailing === undefined)) {
            this.update({ activeItems: [match] });
            return;
        }
        this.update({ activeItems: [] });
        if (this.trailing !== undefined && path.extname(typed) !== "") this.trailing = name;
    }

    /** A row highlighted by the user: its name is completed as a selection; not for "..". */
    private completeWith(item: IFileItem): void {
        if (item.label === "..") {
            // Text completed by the previous row goes away with the selection; cursor to the end.
            this.setValue(this.value);
            return;
        }
        const whole = pathAppend(this.currentFolder, item.label);
        this.setValue(whole, [whole.length - item.label.length, whole.length]);
    }

    /** A yes/no question in a second picker, upstream `yesNoPrompt`: Enter is yes, anything else is no. */
    private yesNoPrompt(target: string, message: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            let isResolving = false;
            const prompt = this.quickInput.createQuickPick<IFileItem>({
                onDidChangeValue: () => {
                    prompt.hide();
                },
                onDidAccept: () => {
                    isResolving = true;
                    prompt.hide();
                    resolve(true);
                },
                onDidChangeActive: () => undefined,
                onDidChangeSelection: () => undefined,
                onDidHide: () => {
                    if (!isResolving) {
                        resolve(false);
                        // Restore the dialog after the keypress that closed the question: the same
                        // Escape would otherwise reach the shared widget and close the dialog too.
                        queueMicrotask(() => {
                            this.session.show();
                        });
                    }
                    this.hidden = false;
                },
            });
            prompt.update({ title: message, value: target, valueSelection: [target.length, target.length] });
            prompt.show();
        });
    }

    private async validate(picked: string): Promise<boolean> {
        const stat = await this.statOrUndefined(picked);
        const statDirname = await this.statOrUndefined(path.dirname(picked));
        if (this.requiresTrailing) {
            if (stat?.isDirectory === true) {
                this.update({ validationMessage: "The folder already exists. Please use a new file name." });
                return false;
            } else if (stat !== undefined) {
                return this.yesNoPrompt(
                    picked,
                    `${path.basename(picked)} already exists. Are you sure you want to overwrite it?`,
                );
            } else if (!isValidBasename(path.basename(picked))) {
                this.update({ validationMessage: "Please enter a valid file name." });
                return false;
            } else if (statDirname === undefined) {
                const ok = await this.yesNoPrompt(
                    picked,
                    `The folder ${path.basename(path.dirname(picked))} does not exist. Would you like to create it?`,
                );
                return ok && (await this.createFolder(path.dirname(picked)));
            } else if (!statDirname.isDirectory) {
                this.update({ validationMessage: "Please enter a path that exists." });
                return false;
            }
            return true;
        }
        if (stat === undefined) {
            if (
                this.allowFolderSelection &&
                !this.allowFileSelection &&
                statDirname?.isDirectory === true &&
                isValidBasename(path.basename(picked))
            ) {
                const create = await this.yesNoPrompt(
                    picked,
                    `The folder ${path.basename(picked)} does not exist. Would you like to create it?`,
                );
                return create && (await this.createFolder(picked));
            }
            this.update({ validationMessage: "Please enter a path that exists." });
            return false;
        } else if (stat.isDirectory && !this.allowFolderSelection) {
            this.update({ validationMessage: "Please select a file." });
            return false;
        } else if (!stat.isDirectory && !this.allowFileSelection) {
            this.update({ validationMessage: "Please select a folder." });
            return false;
        }
        return true;
    }

    /** On failure the dialog comes back (the question already closed it) with the reason in the message line. */
    private async createFolder(folder: string): Promise<boolean> {
        try {
            await this.files.createFolder(Uri.file(folder));
            return true;
        } catch (error) {
            this.session.show();
            this.update({ validationMessage: `Could not create folder: ${errorMessage(error)}` });
            return false;
        }
    }

    /** Loads a directory; a file path loads its directory and puts the name at the end of the line. */
    private updateItems(newFolder: string, options: { force?: boolean; trailing?: string } = {}): Promise<void> {
        const force = options.force === true;
        const wasDotDot = options.trailing === "..";
        let trailing = wasDotDot ? undefined : options.trailing;
        // Stryker disable next-line UpdateOperator: the number only labels a load, and a decreasing counter tells them apart just as well
        const generation = ++this.updateGeneration;

        const run = async (): Promise<void> => {
            let folder = newFolder;
            // No directory leaves the list empty.
            let children: readonly { name: string; type: FileType }[] = [];
            try {
                const resolved = await this.files.resolve(fileUri(folder));
                if (resolved.isDirectory) {
                    children = resolved.children;
                } else {
                    trailing = path.basename(folder);
                    folder = path.dirname(folder);
                    children = (await this.files.resolve(fileUri(folder))).children;
                }
            } catch {
                // An unreadable path gives an empty list; the query line stays.
            }
            const newValue = trailing !== undefined ? pathAppend(folder, trailing) : withSeparator(folder);
            this.currentFolder = withSeparator(folder);
            const items = await this.createItems(this.currentFolder, children);
            if (generation !== this.updateGeneration) return;

            this.update({ itemActivation: "none", items });
            // The user may have typed during the load: touch the line only
            // if it does not match the directory.
            if (!equalsIgnoreCase(this.value, newValue) && (force || wasDotDot)) this.setValue(newValue);
            this.updating = undefined;
        };
        const promise = run();
        this.updating = promise;
        return promise;
    }

    private async createItems(
        currentFolder: string,
        children: readonly { name: string; type: FileType }[],
    ): Promise<IFileItem[]> {
        const items: IFileItem[] = [];
        for (const child of children) {
            const full = path.join(currentFolder, child.name);
            if ((child.type & FileType.Directory) !== 0) {
                items.push({
                    label: child.name,
                    icon: this.icons.glyph(FOLDER_ICON),
                    path: withSeparator(full),
                    isFolder: true,
                });
            } else if (this.allowFileSelection && matchesFilters(full, this.filters)) {
                items.push({ label: child.name, icon: this.icons.glyph(FILE_ICON), path: full, isFolder: false });
            }
        }
        items.sort((a, b) => {
            if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
            return a.label.localeCompare(b.label);
        });
        const parent = path.dirname(stripTrailingSeparator(currentFolder));
        if (!pathsEqual(parent, currentFolder) && (await this.files.exists(fileUri(parent)))) {
            items.unshift({
                label: "..",
                icon: this.icons.glyph(FOLDER_ICON),
                path: withSeparator(parent),
                isFolder: true,
            });
        }
        return items;
    }

    private statOrUndefined(target: string): Promise<{ isDirectory: boolean } | undefined> {
        return this.files.stat(fileUri(target)).catch(() => undefined);
    }
}

/**
 * Without a trailing separator (a directory has one in the query line) and
 * with `.`/`..` resolved: typed "/ws/src/.." reaches the file system as "/ws".
 */
function fileUri(target: string): Uri {
    return Uri.file(stripTrailingSeparator(path.normalize(target)));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

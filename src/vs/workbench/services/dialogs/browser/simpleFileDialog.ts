import * as path from "node:path";

import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { FileType, type IFileService } from "../../../../platform/files/common/files.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import type {
    QuickPickSession,
    QuickPickSessionItem,
    QuickPickSessionState,
} from "../../../browser/parts/quickinput/quickPickSession.ts";

/** Фильтр по расширениям (`{ name: "Images", extensions: ["png"] }`); `*` — любое. */
export interface IFileDialogFilter {
    readonly name: string;
    readonly extensions: readonly string[];
}

/** Опции диалога открытия — `IOpenDialogOptions` эталона без удалённых ФС. */
export interface IOpenDialogOptions {
    readonly title?: string;
    readonly defaultUri?: Uri;
    readonly openLabel?: string;
    readonly canSelectFiles?: boolean;
    readonly canSelectFolders?: boolean;
    readonly canSelectMany?: boolean;
    readonly filters?: readonly IFileDialogFilter[];
}

/** Опции диалога сохранения — `ISaveDialogOptions` эталона без удалённых ФС. */
export interface ISaveDialogOptions {
    readonly title?: string;
    readonly defaultUri?: Uri;
    readonly saveLabel?: string;
    readonly filters?: readonly IFileDialogFilter[];
}

/** Строка диалога: файл или каталог (у каталога путь с разделителем на конце). */
interface IFileItem extends QuickPickSessionItem {
    readonly path: string;
    readonly isFolder: boolean;
}

/** Исход попытки обновить список по набранному — `UpdateResult` эталона. */
const enum UpdateResult {
    Updated,
    UpdatedWithTrailing,
    NotUpdated,
    InvalidPath,
}

/** Окружение диалога: где дом человека и откуда начинать без `defaultUri`. */
export interface ISimpleFileDialogEnvironment {
    readonly userHome: string;
    readonly defaultFolder: () => string;
}

const FOLDER_ICON = CODICON_GLYPHS.folder ?? "";
const FILE_ICON = CODICON_GLYPHS.file ?? "";

/**
 * Диалог файлов на QuickInput-оверлее — порт `SimpleFileDialog` эталона
 * (`workbench/services/dialogs/browser/simpleFileDialog.ts`), его терминальный
 * диалог (`files.simpleDialog.enable`). В строке запроса — путь целиком, под
 * ней — содержимое каталога из этого пути; набор переходит по каталогам
 * (разделитель на конце, `..`, `~`), начало имени подсвечивает строку и
 * дописывает хвост выделенным (следующая буква его заменит), Enter на каталоге
 * входит в него, на файле или набранном пути — принимает после проверок
 * эталона (несуществующий путь, папка вместо файла, перезапись — вопросом).
 *
 * Отступления: только локальная ФС (без удалённых и `availableFileSystems`), без
 * кнопок «OK»/«Show Local»/«скрыть dot-файлы» (Enter и Escape делают своё,
 * dot-файлы видны, как по умолчанию у эталона), без иконок по типу файла —
 * каталог и файл различаются значками. `canSelectMany` не поддержан и у эталона.
 */
export class SimpleFileDialog {
    private options: IOpenDialogOptions = {};
    private allowFileSelection = true;
    private allowFolderSelection = false;
    /** Диалог сохранения: в конце пути — имя файла (`requiresTrailing` эталона). */
    private requiresTrailing = false;
    private trailing: string | undefined;
    private currentFolder = "";
    private userEnteredPathSegment = "";
    private autoCompletePathSegment = "";
    private activeItem: IFileItem | undefined;
    private badPath: string | undefined;
    private hidden = false;
    private busy = false;
    /** Текущая подгрузка каталога; более новая отменяет прежнюю номером. */
    private updating: Promise<boolean> | undefined;
    private updateGeneration = 0;
    /** Пикер диалога; заводится первой строкой pickResource, до неё никто не зовёт. */
    private session!: QuickPickSession<IFileItem>;

    public constructor(
        private readonly quickInput: QuickInputService,
        private readonly files: IFileService,
        private readonly environment: ISimpleFileDialogEnvironment,
    ) {}

    public async showOpenDialog(options: IOpenDialogOptions = {}): Promise<Uri[] | undefined> {
        // Ни файлов, ни папок не просили — файлы (`_convertOpenOptions` эталона).
        const canSelectFiles = options.canSelectFiles === true || options.canSelectFolders !== true;
        this.options = { ...options, canSelectFiles };
        const picked = await this.pickResource(false);
        return picked === undefined ? undefined : [Uri.file(picked)];
    }

    public async showSaveDialog(options: ISaveDialogOptions = {}): Promise<Uri | undefined> {
        this.options = { ...options, openLabel: options.saveLabel, canSelectFiles: true, canSelectFolders: true };
        this.requiresTrailing = true;
        const picked = await this.pickResource(true);
        return picked === undefined ? undefined : Uri.file(picked);
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

    /** Значение строки запроса и выделение в ней; по умолчанию курсор в конце. */
    private setValue(value: string, selection?: readonly [number, number]): void {
        this.update({ value, valueSelection: selection ?? [value.length, value.length] });
    }

    private async pickResource(isSave: boolean): Promise<string | undefined> {
        this.allowFolderSelection = this.options.canSelectFolders === true;
        this.allowFileSelection = this.options.canSelectFiles === true;
        this.hidden = false;
        let homedir = this.options.defaultUri?.fsPath ?? this.environment.defaultFolder();
        if (this.options.defaultUri !== undefined) {
            const stat = await this.statOrUndefined(homedir);
            if (!stat?.isDirectory) {
                this.trailing = path.basename(homedir);
                homedir = path.dirname(homedir);
            }
        }

        return new Promise<string | undefined>((resolve) => {
            let isResolving = 0;
            let isAcceptHandled = false;
            const session = this.quickInput.createQuickPick<IFileItem>({
                onDidChangeValue: (value) => {
                    void this.handleValueChange(value);
                },
                onDidAccept: () => {
                    handleAccept();
                },
                onDidChangeActive: (items) => {
                    isAcceptHandled = false;
                    // Подсветку сдвинул человек — строка запроса идёт за ней.
                    const item = items.at(0);
                    if (items.length === 1 && item !== undefined && this.isSelectionChangeFromUser(item)) {
                        this.update({ validationMessage: undefined });
                        const userPath = this.constructFullUserPath();
                        if (!equalsIgnoreCase(this.value.substring(0, userPath.length), userPath)) {
                            this.setValue(userPath);
                        }
                        this.setAutoComplete(userPath, this.userEnteredPathSegment, item, true);
                    }
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
                if (this.busy) {
                    // Подгрузка каталога ещё идёт — принять, когда она кончится.
                    void this.updating?.then(() => {
                        handleAccept();
                    });
                    return;
                }
                isAcceptHandled = true;
                isResolving++;
                void this.onDidAccept().then((picked) => {
                    if (picked !== undefined) {
                        session.hide();
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
            this.userEnteredPathSegment = "";
            this.autoCompletePathSegment = "";
            session.update({
                title: this.options.title,
                placeholder: "Folder path",
                matchOnLabel: false,
                itemActivation: "none",
                value: withSeparator(this.currentFolder),
            });
            session.show();
            const trailing = this.trailing;
            void this.updateItems(homedir, true, trailing).then(() => {
                const value = this.value;
                if (trailing !== undefined && isSave) {
                    // Курсор — перед расширением имени: «report|.txt».
                    const ext = path.extname(trailing);
                    this.update({ valueSelection: [value.length - trailing.length, value.length - ext.length] });
                } else {
                    this.update({ valueSelection: [value.length, value.length] });
                }
            });
        });
    }

    private async handleValueChange(value: string): Promise<void> {
        try {
            // Значение сменило само автодополнение — человек тут ни при чём.
            if (!this.isValueChangeFromUser()) return;
            if (
                !equalsIgnoreCase(value, this.constructFullUserPath()) &&
                (!this.isBadSubpath(value) || this.canTildaEscapeHatch(value))
            ) {
                this.update({ validationMessage: undefined });
                const typed = this.filePickBoxValue();
                let updated = UpdateResult.NotUpdated;
                if (!pathsEqual(this.currentFolder, typed)) {
                    updated = await this.tryUpdateItems(value, typed);
                }
                if (updated === UpdateResult.NotUpdated || updated === UpdateResult.UpdatedWithTrailing) {
                    this.setActiveItems(value);
                }
            } else {
                this.update({ activeItems: [] });
                this.userEnteredPathSegment = "";
            }
        } catch {
            // Набрать можно что угодно — ошибочный ввод ничего не ломает.
        }
    }

    private isBadSubpath(value: string): boolean {
        const bad = this.badPath;
        return bad !== undefined && value.length > bad.length && equalsIgnoreCase(value.substring(0, bad.length), bad);
    }

    private isValueChangeFromUser(): boolean {
        return !equalsIgnoreCase(
            this.value,
            pathAppend(this.currentFolder, this.userEnteredPathSegment + this.autoCompletePathSegment),
        );
    }

    private isSelectionChangeFromUser(item: IFileItem): boolean {
        return this.activeItem !== item;
    }

    private constructFullUserPath(): string {
        const currentFolderPath = this.currentFolder;
        if (
            equalsIgnoreCase(this.value.substring(0, this.userEnteredPathSegment.length), this.userEnteredPathSegment)
        ) {
            if (equalsIgnoreCase(this.value.substring(0, currentFolderPath.length), currentFolderPath)) {
                return currentFolderPath;
            }
            return this.userEnteredPathSegment;
        }
        return pathAppend(this.currentFolder, this.userEnteredPathSegment);
    }

    /** Путь, набранный в строке запроса (относительный — от текущего каталога). */
    private filePickBoxValue(): string {
        const typed = this.value.trimEnd();
        if (equalsIgnoreCase(typed, this.currentFolder)) return this.currentFolder;
        const resolved = path.isAbsolute(typed) ? typed : path.join(this.currentFolder, typed);
        const base = path.basename(typed);
        if (base === "." || base === "..") return withSeparator(path.normalize(resolved)) + base;
        return endsWithSeparator(typed) ? withSeparator(resolved) : resolved;
    }

    private async onDidAccept(): Promise<string | undefined> {
        this.busy = true;
        const active = this.state().activeItems;
        const item = active.at(0);
        if (this.updating === undefined && item !== undefined) {
            if (item.isFolder) {
                if (this.trailing !== undefined) {
                    await this.updateItems(item.path, true, this.trailing);
                } else {
                    // Вход в каталог — через строку запроса, тем же путём, что набор:
                    // подгрузку запустит обработчик смены значения.
                    this.setValue(item.path);
                }
                this.busy = false;
                return undefined;
            }
        } else if (this.updating === undefined) {
            // Набранное сменило каталог — принимать рано.
            if ((await this.tryUpdateItems(this.value, this.filePickBoxValue())) !== UpdateResult.NotUpdated) {
                this.busy = false;
                return undefined;
            }
        }

        let picked = item === undefined ? this.filePickBoxValue() : item.path;
        picked = this.addPostfix(picked);
        const ok = await this.validate(picked);
        this.busy = false;
        return ok ? picked : undefined;
    }

    private canTildaEscapeHatch(value: string): boolean {
        return value.endsWith("~") && this.isBadSubpath(value);
    }

    private tildaReplace(value: string): string {
        if (value.startsWith("~")) return path.join(this.environment.userHome, value.substring(1));
        return this.environment.userHome;
    }

    private async tryUpdateItems(value: string, valuePath: string, reset = false): Promise<UpdateResult> {
        if (value.startsWith("~") || this.canTildaEscapeHatch(value)) {
            const home = this.tildaReplace(value);
            return (await this.updateItems(home, true)) ? UpdateResult.UpdatedWithTrailing : UpdateResult.Updated;
        }
        const newFolderIsOldFolder = pathsEqual(this.currentFolder, valuePath);
        const newFolderIsSubFolder = pathsEqual(this.currentFolder, path.dirname(valuePath));
        const newFolderIsParent = isEqualOrParent(this.currentFolder, path.dirname(valuePath));
        const newFolderIsUnrelated = !newFolderIsParent && !newFolderIsSubFolder;
        if (
            (!newFolderIsOldFolder && (endsWithSeparator(value) || newFolderIsParent || newFolderIsUnrelated)) ||
            reset
        ) {
            const stat = await this.statOrUndefined(valuePath);
            // Пока шёл stat, человек допечатал: ответ про старое значение устарел, и
            // подгрузка по нему перебила бы более свежую (отступление от эталона —
            // там та же гонка не закрыта).
            if (this.value !== value) return UpdateResult.NotUpdated;
            if (stat?.isDirectory === true && path.basename(valuePath) !== "." && endsWithSeparator(value)) {
                return (await this.updateItems(withSeparator(valuePath)))
                    ? UpdateResult.UpdatedWithTrailing
                    : UpdateResult.Updated;
            } else if (endsWithSeparator(value)) {
                // Такого каталога нет. Запоминаем «плохой» префикс: человек, раз
                // набравший несуществующий путь, обычно продолжает его набирать, и
                // stat на каждую букву был бы дорог.
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
                        return (await this.updateItems(withSeparator(inputDirname), false, path.basename(valuePath)))
                            ? UpdateResult.UpdatedWithTrailing
                            : UpdateResult.Updated;
                    }
                }
            }
        }
        this.badPath = undefined;
        return UpdateResult.NotUpdated;
    }

    private tryUpdateTrailing(value: string): void {
        if (this.trailing !== undefined && path.extname(value) !== "") this.trailing = path.basename(value);
    }

    private setActiveItems(rawValue: string): void {
        const value = rawValue.startsWith("~") ? this.tildaReplace(rawValue) : rawValue;
        const inputBasename = endsWithSeparator(value) ? "" : path.basename(value);
        const userPath = this.constructFullUserPath();
        // Каталог, чьи строки показаны, обязан совпадать с путём в строке запроса.
        const samePath =
            equalsIgnoreCase(userPath, value.substring(0, userPath.length)) ||
            equalsIgnoreCase(value, userPath.substring(0, value.length));
        if (samePath) {
            let hasMatch = false;
            for (const item of this.state().items) {
                if (this.setAutoComplete(value, inputBasename, item)) {
                    hasMatch = true;
                    break;
                }
            }
            if (!hasMatch) {
                const userBasename =
                    inputBasename.length >= 2 ? userPath.substring(userPath.length - inputBasename.length + 2) : "";
                this.userEnteredPathSegment = userBasename === inputBasename ? inputBasename : "";
                this.autoCompletePathSegment = "";
                this.update({ activeItems: [] });
                this.tryUpdateTrailing(value);
            }
        } else {
            this.userEnteredPathSegment = inputBasename;
            this.autoCompletePathSegment = "";
            this.update({ activeItems: [] });
            this.tryUpdateTrailing(value);
        }
    }

    private setAutoComplete(startingValue: string, startingBasename: string, item: IFileItem, force = false): boolean {
        if (this.busy) {
            // Посреди другой работы автодополнение перепутало бы буквы.
            this.userEnteredPathSegment = startingBasename;
            this.autoCompletePathSegment = "";
            return false;
        }
        const itemBasename = item.label;
        if (itemBasename === "..") {
            // На «..» не дополняем никогда.
            this.userEnteredPathSegment = "";
            this.autoCompletePathSegment = "";
            this.activeItem = item;
            if (force) this.setValue(this.value);
            return false;
        }
        if (
            !force &&
            itemBasename.length >= startingBasename.length &&
            equalsIgnoreCase(itemBasename.substring(0, startingBasename.length), startingBasename)
        ) {
            this.userEnteredPathSegment = startingBasename;
            this.activeItem = item;
            this.autoCompletePathSegment = "";
            this.update({ activeItems: item.isFolder || this.trailing === undefined ? [item] : [] });
            return true;
        }
        if (
            force &&
            !equalsIgnoreCase(
                basenameWithSeparator(item.path),
                this.userEnteredPathSegment + this.autoCompletePathSegment,
            )
        ) {
            this.userEnteredPathSegment = "";
            this.autoCompletePathSegment = itemBasename;
            this.activeItem = item;
            const whole = pathAppend(this.currentFolder, this.autoCompletePathSegment);
            this.setValue(whole, [whole.length - this.autoCompletePathSegment.length, whole.length]);
            return true;
        }
        this.userEnteredPathSegment = startingBasename;
        this.autoCompletePathSegment = "";
        return false;
    }

    /** Сохранение с фильтрами: нет подходящего расширения — дописать первое. */
    private addPostfix(picked: string): string {
        const filters = this.options.filters;
        if (!this.requiresTrailing || filters === undefined || filters.length === 0 || endsWithSeparator(picked)) {
            return picked;
        }
        const current = path.extname(picked).substring(1);
        const hasExt = filters.some((filter) => filter.extensions.some((ext) => ext === "*" || ext === current));
        if (hasExt) return picked;
        const first = filters[0].extensions.at(0);
        return first === undefined ? picked : `${picked}.${first}`;
    }

    /** Вопрос «да/нет» вторым пикером — `yesNoPrompt` эталона: Enter — да, иначе нет. */
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
                        this.session.show();
                    }
                    this.hidden = false;
                    prompt.dispose();
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
                if (ok) await this.files.createFolder(Uri.file(path.dirname(picked)));
                return ok;
            } else if (!statDirname.isDirectory) {
                this.update({ validationMessage: "Please enter a path that exists." });
                return false;
            }
            return true;
        }
        if (stat === undefined) {
            // Только папки, родитель есть — предложить создать.
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
                if (!create) return false;
                try {
                    await this.files.createFolder(Uri.file(picked));
                    return true;
                } catch (error) {
                    this.update({ validationMessage: `Could not create folder: ${errorMessage(error)}` });
                    return false;
                }
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

    /** Подгрузить каталог; `true` — в конце пути был файл (он стал `trailing`). */
    private updateItems(newFolder: string, force = false, trailingIn?: string): Promise<boolean> {
        this.busy = true;
        this.autoCompletePathSegment = "";
        const wasDotDot = trailingIn === "..";
        let trailing = wasDotDot ? undefined : trailingIn;
        const isSave = trailing !== undefined;
        const generation = ++this.updateGeneration;

        const run = async (): Promise<boolean> => {
            let folder = newFolder;
            let result = false;
            let children: readonly { name: string; type: FileType }[] | undefined;
            try {
                const resolved = await this.files.resolve(fileUri(folder));
                if (resolved.isDirectory) {
                    children = resolved.children;
                } else {
                    trailing = path.basename(folder);
                    folder = path.dirname(folder);
                    result = true;
                }
            } catch {
                // Каталога нет — список останется пустым.
            }
            const newValue = trailing !== undefined ? pathAppend(folder, trailing) : withSeparator(folder);
            this.currentFolder = withSeparator(folder);
            this.userEnteredPathSegment = trailing ?? "";
            const items = await this.createItems(this.currentFolder, children);
            if (generation !== this.updateGeneration) return false;

            this.update({ itemActivation: "none", items });
            // Человек мог допечатать, пока шла подгрузка: строку трогаем, только
            // если она не совпадает с каталогом.
            if (!equalsIgnoreCase(this.value, newValue) && (force || wasDotDot)) this.setValue(newValue);
            const value = this.value;
            if (force && trailing !== undefined && isSave) {
                // Курсор — перед именем при сохранении.
                const at = value.length - trailing.length;
                this.update({ valueSelection: [at, at] });
            } else if (trailing === undefined) {
                this.update({ valueSelection: [value.length, value.length] });
            }
            this.busy = false;
            this.updating = undefined;
            return result;
        };
        const promise = run();
        this.updating = promise;
        return promise;
    }

    private async createItems(
        currentFolder: string,
        known: readonly { name: string; type: FileType }[] | undefined,
    ): Promise<IFileItem[]> {
        let children = known;
        if (children === undefined) {
            try {
                children = (await this.files.resolve(fileUri(currentFolder))).children;
            } catch {
                children = [];
            }
        }
        const items: IFileItem[] = [];
        for (const child of children) {
            const full = path.join(currentFolder, child.name);
            if ((child.type & FileType.Directory) !== 0) {
                items.push({ label: child.name, icon: FOLDER_ICON, path: withSeparator(full), isFolder: true });
            } else if (this.allowFileSelection && this.filterFile(full)) {
                items.push({ label: child.name, icon: FILE_ICON, path: full, isFolder: false });
            }
        }
        items.sort((a, b) => {
            if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
            return a.label.localeCompare(b.label);
        });
        const parent = path.dirname(stripTrailingSeparator(currentFolder));
        if (!pathsEqual(parent, currentFolder) && (await this.files.exists(fileUri(parent)))) {
            items.unshift({ label: "..", icon: FOLDER_ICON, path: withSeparator(parent), isFolder: true });
        }
        return items;
    }

    private filterFile(file: string): boolean {
        const filters = this.options.filters;
        if (filters === undefined) return true;
        return filters.some((filter) => filter.extensions.some((ext) => ext === "*" || file.endsWith(`.${ext}`)));
    }

    private async statOrUndefined(target: string): Promise<{ isDirectory: boolean } | undefined> {
        try {
            return await this.files.stat(fileUri(target));
        } catch {
            return undefined;
        }
    }
}

/** `Uri` пути без разделителя на конце: у каталога в строке запроса он есть. */
function fileUri(target: string): Uri {
    return Uri.file(stripTrailingSeparator(target));
}

function equalsIgnoreCase(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

function endsWithSeparator(value: string): boolean {
    return /[/\\]$/.test(value);
}

function withSeparator(value: string): string {
    return endsWithSeparator(value) ? value : value + path.sep;
}

function stripTrailingSeparator(value: string): string {
    return value.length > 1 && endsWithSeparator(value) ? value.substring(0, value.length - 1) : value;
}

/** Сравнение путей без учёта регистра и разделителя на конце (эталон: `extUriIgnorePathCase`). */
function pathsEqual(a: string, b: string): boolean {
    return equalsIgnoreCase(stripTrailingSeparator(path.normalize(a)), stripTrailingSeparator(path.normalize(b)));
}

/** `a` совпадает с `b` или лежит внутри него. */
function isEqualOrParent(a: string, b: string): boolean {
    const child = stripTrailingSeparator(path.normalize(a)).toLowerCase();
    const parent = stripTrailingSeparator(path.normalize(b)).toLowerCase();
    return child === parent || child.startsWith(withSeparator(parent));
}

function pathAppend(base: string, additional: string): string {
    if (additional === ".." || additional === ".") return withSeparator(base) + additional;
    return path.join(base, additional);
}

function basenameWithSeparator(full: string): string {
    const parent = withSeparator(path.dirname(stripTrailingSeparator(full)));
    return withSeparator(full).substring(parent.length);
}

/** Имя файла, которое ФС примет (`isValidBasename` эталона в упрощении). */
function isValidBasename(name: string): boolean {
    if (name === "" || name === "." || name === "..") return false;
    if (/[/\\]/.test(name)) return false;
    if (process.platform === "win32" && /[<>:"|?*]/.test(name)) return false;
    return name.length <= 255;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

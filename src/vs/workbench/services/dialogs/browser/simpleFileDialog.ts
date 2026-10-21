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
    NotUpdated,
    InvalidPath,
}

export interface ISimpleFileDialogEnvironment {
    readonly userHome: string;
    readonly defaultFolder: () => string;
}

const FOLDER_ICON = CODICON_GLYPHS.folder;
const FILE_ICON = CODICON_GLYPHS.file;

/**
 * Порт `SimpleFileDialog` эталона (его терминальный диалог, `files.simpleDialog.enable`).
 * Одноразовый: один показ — один экземпляр, поэтому состояние живёт в полях без сброса.
 *
 * Отступления: только локальная ФС, без кнопок «OK»/«Show Local»/«скрыть dot-файлы» и без
 * иконок по типу файла. Эталон отличает свою смену строки от набора человека по сегментам
 * `userEnteredPathSegment`/`autoCompletePathSegment`, потому что события его пикера приходят
 * позже; у нашего они синхронны, поэтому своя смена помечается флагом на время вызова, а
 * `onDidChangeActive` приходит только от человека. Видимое отличие одно: стёртое до самого
 * каталога первую строку не подсвечивает (сопоставлять пустое имя не с чем).
 */
export class SimpleFileDialog {
    // Выставляются в show*Dialog, до первого чтения.
    private title!: string | undefined;
    private filters!: readonly IFileDialogFilter[] | undefined;
    private defaultUri!: Uri | undefined;
    private allowFileSelection!: boolean;
    private allowFolderSelection!: boolean;
    /** Диалог сохранения: в конце пути — имя файла (`requiresTrailing` эталона). */
    private requiresTrailing = false;
    private trailing: string | undefined;
    // Выставляется в pickResource до показа пикера.
    private currentFolder!: string;
    private badPath: string | undefined;
    private hidden = false;
    /** Строку запроса меняет сам диалог — это не набор человека. */
    private settingValue = false;
    /** Текущая подгрузка каталога; более новая отменяет прежнюю номером. */
    private updating: Promise<void> | undefined;
    private updateGeneration = 0;
    /** Набор человека ещё обрабатывается (stat, подгрузка) — все начатые смены строки. */
    private valueChanges: Promise<unknown> = Promise.resolve();
    /** Пикер диалога; заводится в pickResource, до него никто не зовёт. */
    private session!: QuickPickSession<IFileItem>;

    public constructor(
        private readonly quickInput: QuickInputService,
        private readonly files: IFileService,
        private readonly environment: ISimpleFileDialogEnvironment,
    ) {}

    public async showOpenDialog(options: IOpenDialogOptions = {}): Promise<Uri[] | undefined> {
        this.takeCommonOptions(options);
        // Ни файлов, ни папок не просили — файлы (`_convertOpenOptions` эталона).
        this.allowFolderSelection = options.canSelectFolders === true;
        this.allowFileSelection = options.canSelectFiles === true || !this.allowFolderSelection;
        const picked = await this.pickResource();
        return picked === undefined ? undefined : [Uri.file(picked)];
    }

    public async showSaveDialog(options: ISaveDialogOptions = {}): Promise<Uri | undefined> {
        this.takeCommonOptions(options);
        // Каталоги и так видны всегда; выбор папки проверяется только в открытии.
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

    /** Значение строки запроса и выделение в ней; по умолчанию курсор в конце. */
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
        // `defaultUri` на файл (или на то, чего ещё нет) — его имя встаёт в строку.
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
                    // Подсветку сдвинул человек — строка запроса идёт за ней.
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
                // Имя без расширения выделено: «[report].txt». Без имени курсор и так
                // в конце — строку ставит подгрузка.
                // Stryker disable next-line ConditionalExpression,StringLiteral: без имени выделение пустое и стоит в конце строки — ровно там, где курсор оставила подгрузка
                if (this.requiresTrailing && name !== "") {
                    const ext = path.extname(name);
                    this.update({ valueSelection: [value.length - name.length, value.length - ext.length] });
                }
            });
        });
    }

    private async handleValueChange(value: string): Promise<void> {
        try {
            // Набор дальше по несуществующему пути: stat на каждую букву не гоняем
            // (подсветки там нет — путь не ведёт ни в одну строку).
            if (this.isBadSubpath(value) && !this.canTildaEscapeHatch(value)) return;
            this.update({ validationMessage: undefined });
            // Подсветка — по строке запроса как она есть сейчас: допечатанное за время
            // проверки пути учтётся и здесь, и в обработчике своей смены.
            if ((await this.tryUpdateItems(value, this.filePickBoxValue())) === UpdateResult.NotUpdated) {
                this.setActiveItems();
            }
        } catch {
            // Набрать можно что угодно — ошибочный ввод ничего не ломает.
        }
    }

    private isBadSubpath(value: string): boolean {
        // Сам плохой путь сюда не приходит: следующая смена строки уже другая.
        const bad = this.badPath;
        return bad !== undefined && startsWithIgnoreCase(value, bad);
    }

    /** Путь, набранный в строке запроса (относительный — от текущего каталога). */
    private filePickBoxValue(): string {
        const typed = this.value.trimEnd();
        const resolved = path.isAbsolute(typed) ? typed : path.join(this.currentFolder, typed);
        // «..» на конце остаётся сегментом: каталог над ним — тот, где его набрали.
        if (path.basename(typed) === "..") return withSeparator(path.normalize(resolved)) + "..";
        return endsWithSeparator(typed) ? withSeparator(resolved) : resolved;
    }

    private async onDidAccept(): Promise<string | undefined> {
        // Enter во время обработки набора или подгрузки каталога — после них:
        // строки и подсветка тогда про тот каталог, что в строке запроса, а не
        // набранный следом путь съедает Enter переходом в свой каталог.
        await this.valueChanges;
        await this.updating;
        const item = this.state().activeItems.at(0);
        if (item?.isFolder === true) {
            // Вход в каталог. При сохранении туда же переезжает набранное имя, и
            // курсор встаёт перед ним; без имени — в конец.
            await this.updateItems(item.path, { force: true, trailing: this.trailing });
            const at = this.value.length - (this.trailing ?? "").length;
            this.update({ valueSelection: [at, at] });
            return undefined;
        }
        // Набранное сменило каталог — принимать рано (подсвеченный файл каталог не
        // меняет: строка запроса тогда ведёт в него же).
        if ((await this.tryUpdateItems(this.value, this.filePickBoxValue())) !== UpdateResult.NotUpdated) {
            return undefined;
        }

        let picked = item === undefined ? this.filePickBoxValue() : item.path;
        // Stryker disable next-line ConditionalExpression: в открытии исход тот же — файл с расширением фильтра подсветился бы по началу набранного имени и принялся бы строкой
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
        // У эталона здесь «не тот же каталог И (разделитель ИЛИ родитель ИЛИ
        // посторонний)», но «родитель» у него включает равенство, а «посторонний» —
        // его отрицание: скобка всегда истинна.
        if (!pathsEqual(this.currentFolder, valuePath)) {
            const stat = await this.statOrUndefined(valuePath);
            // Пока шёл stat, человек допечатал: ответ про старое значение устарел, и
            // подгрузка по нему перебила бы более свежую (отступление от эталона —
            // там та же гонка не закрыта).
            if (this.value !== value) return UpdateResult.NotUpdated;
            if (stat?.isDirectory === true && endsWithSeparator(value)) {
                await this.updateItems(withSeparator(valuePath));
                return UpdateResult.Updated;
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
     * Подсветка по набранному: первая строка текущего каталога, чьё имя
     * начинается с набранного (без учёта регистра). При сохранении с именем файла
     * подсвечиваются только каталоги — набор имени не должен цеплять чужой файл;
     * набранное имя с расширением тогда становится этим именем.
     */
    private setActiveItems(): void {
        // Путь с разделителем на конце — каталог: его имя лежит уровнем выше.
        const typed = this.filePickBoxValue();
        const name = path.basename(typed);
        // Подгрузка ещё идёт — строки списка про прежний каталог.
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

    /** Строка, подсвеченная человеком: её имя дописывается выделенным; на «..» — нет. */
    private completeWith(item: IFileItem): void {
        if (item.label === "..") {
            // Дописанное прежней строкой уходит выделением — курсор в конец.
            this.setValue(this.value);
            return;
        }
        const whole = pathAppend(this.currentFolder, item.label);
        this.setValue(whole, [whole.length - item.label.length, whole.length]);
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
                        // Вернуть диалог — после нажатия, закрывшего вопрос: тот же
                        // Escape дошёл бы до общего виджета и закрыл бы и диалог.
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

    /** Не вышло — диалог возвращается (вопрос его уже закрыл) с причиной в строке сообщения. */
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

    /** Подгрузить каталог; путь на файл — его каталог, а имя встаёт в конец строки. */
    private updateItems(newFolder: string, options: { force?: boolean; trailing?: string } = {}): Promise<void> {
        const force = options.force === true;
        const wasDotDot = options.trailing === "..";
        let trailing = wasDotDot ? undefined : options.trailing;
        // Stryker disable next-line UpdateOperator: номер — только метка подгрузки, убывающий счётчик различает их так же
        const generation = ++this.updateGeneration;

        const run = async (): Promise<void> => {
            let folder = newFolder;
            // Каталога нет — список останется пустым.
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
                // Нечитаемый путь — пустой список, строка запроса остаётся.
            }
            const newValue = trailing !== undefined ? pathAppend(folder, trailing) : withSeparator(folder);
            this.currentFolder = withSeparator(folder);
            const items = await this.createItems(this.currentFolder, children);
            if (generation !== this.updateGeneration) return;

            this.update({ itemActivation: "none", items });
            // Человек мог допечатать, пока шла подгрузка: строку трогаем, только
            // если она не совпадает с каталогом.
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
                items.push({ label: child.name, icon: FOLDER_ICON, path: withSeparator(full), isFolder: true });
            } else if (this.allowFileSelection && matchesFilters(full, this.filters)) {
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

    private statOrUndefined(target: string): Promise<{ isDirectory: boolean } | undefined> {
        return this.files.stat(fileUri(target)).catch(() => undefined);
    }
}

/**
 * `Uri` пути: без разделителя на конце (у каталога в строке запроса он есть) и
 * с разрешёнными `.`/`..` — набранное «/ws/src/..» ФС видит как «/ws».
 */
function fileUri(target: string): Uri {
    return Uri.file(stripTrailingSeparator(path.normalize(target)));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

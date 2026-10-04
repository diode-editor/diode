import * as path from "node:path";

import { Emitter } from "../../../../../base/common/event.ts";
import { matchGlob } from "../../../../../base/common/glob.ts";
import { Disposable, DisposableMap, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { ITreeFileChange } from "../../../../../platform/files/common/iTreeFileWatcher.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionFileWatcher } from "../../../../api/common/iExtensionFileWatcher.ts";
import type { IWireWatcherCreate, IWireWatcherEvent } from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireReadFileResult,
    parseWireSchemes,
    parseWireTextContentResult,
    parseWireWatcherCreate,
    parseWireWatcherDispose,
} from "../hostWireParsers.ts";

/**
 * Файловая сторона API расширений: провайдеры ФС (`git:` у встроенного git),
 * провайдеры содержимого недисковых ресурсов (`jdt:` у redhat.java) и
 * watcher'ы (`workspace.createFileSystemWatcher`). События ядру и pull-API
 * живут столько же, сколько хост; watcher'ы и канал к провайдерам — один
 * спавн субпроцесса.
 */
export class FileSystemCustomer extends Disposable implements IExtensionHostCustomer {
    /**
     * Текущий спавн: канал к провайдерам и схемы его `TextDocumentContentProvider`'ов;
     * `null` — спавна нет. Схемы содержимого уходят вместе со спавном.
     */
    private live: { readonly rpc: HostRpc; textContentSchemes: readonly string[] } | null = null;
    private fileSystemSchemesValue: readonly string[] = [];
    private readonly onFileSystemProvidersChangedEmitter = this.register(new Emitter<void>());
    private readonly onDidChangeProvidedFileEmitter = this.register(new Emitter<readonly Uri[]>());
    private readonly onDidChangeTextContentEmitter = this.register(new Emitter<Uri>());

    /** Набор схем провайдеров ФС изменился (расширение зарегистрировало/сняло провайдера). */
    public readonly onFileSystemProvidersChanged = this.onFileSystemProvidersChangedEmitter.event;
    /** Содержимое ресурсов провайдера ФС изменилось снаружи. */
    public readonly onDidChangeProvidedFile = this.onDidChangeProvidedFileEmitter.event;
    /** Провайдер объявил, что содержимое недискового ресурса изменилось. */
    public readonly onDidChangeTextContent = this.onDidChangeTextContentEmitter.event;

    public constructor(private readonly fileWatcher: IExtensionFileWatcher) {
        super();
    }

    /** Схемы, для которых субпроцесс держит `FileSystemProvider`. */
    public getFileSystemSchemes(): readonly string[] {
        return this.fileSystemSchemesValue;
    }

    /**
     * Читает недисковый ресурс провайдером субпроцесса. Отклоняется, если host
     * не поднят или провайдер схемы не зарегистрирован — потребитель обязан
     * это пережить (для гуттера «git-расширения нет» — штатная ситуация).
     */
    public async readProvidedFile(uri: Uri): Promise<Uint8Array> {
        const rpc = this.live?.rpc;
        if (rpc === undefined) throw new Error("extension host is not running");
        return parseWireReadFileResult(await rpc.request("workspace.fs.readFile", { uri: uri.toString() }));
    }

    /**
     * Держит ли субпроцесс `TextDocumentContentProvider` для схемы. Ответ
     * меняется по ходу жизни окна: расширение активируется асинхронно и
     * регистрирует провайдера уже после того, как человек открыл первый файл, —
     * поэтому спрашивать надо в момент открытия ресурса, а не один раз.
     */
    public hasTextContentProvider(scheme: string): boolean {
        return this.live?.textContentSchemes.includes(scheme) === true;
    }

    /**
     * Содержимое недискового ресурса от провайдера субпроцесса. `null` —
     * провайдер отказался отдать ресурс. Отклоняется, если host не поднят,
     * схема не зарегистрирована или провайдер бросил: ядру нужна причина, чтобы
     * показать её человеку.
     */
    public async provideTextDocumentContent(uri: Uri): Promise<string | null> {
        const rpc = this.live?.rpc;
        if (rpc === undefined) throw new Error("extension host is not running");
        return parseWireTextContentResult(
            await rpc.request("workspace.provideTextDocumentContent", { uri: uri.toString() }),
        );
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        // Stryker disable next-line ArrayDeclaration: до первого объявления субпроцесса схем нет; мутант подставляет схему-заглушку, которую ни одно расширение не регистрирует
        const live = { rpc, textContentSchemes: [] as readonly string[] };
        this.live = live;
        const store = new DisposableStore();
        /** Живые watcher'ы субпроцесса по id; уходят вместе со спавном. */
        const watchers = store.add(new DisposableMap<number>());
        // Субпроцесс объявляет схемы, для которых расширения зарегистрировали
        // FileSystemProvider (у встроенного git — `git:`). Ядро по ним читает
        // недисковые ресурсы через IFileSystemProviderRegistry.
        store.add(
            rpc.handleNotification("workspace.fileSystemProvidersChanged", (params) => {
                this.fileSystemSchemesValue = parseWireSchemes(params);
                this.onFileSystemProvidersChangedEmitter.fire();
            }),
        );
        // То же для TextDocumentContentProvider'ов (`jdt:`/`class:` у redhat.java):
        // это отдельный реестр — провайдер отдаёт текст, а не байты, и только на
        // чтение. По ним ядро открывает read-only вкладки недисковых ресурсов.
        store.add(
            rpc.handleNotification("workspace.textDocumentContentProvidersChanged", (params) => {
                live.textContentSchemes = parseWireSchemes(params);
            }),
        );
        // Провайдер объявил, что содержимое ресурса изменилось — открытая вкладка
        // обязана перечитаться (`TextDocumentContentProvider.onDidChange`).
        store.add(
            rpc.handleNotification("workspace.textDocumentContentChanged", (params) => {
                const uri: unknown = params.uri;
                if (typeof uri !== "string") return;
                this.onDidChangeTextContentEmitter.fire(Uri.parse(uri));
            }),
        );
        // Провайдер расширения сообщил, что содержимое ресурсов изменилось
        // (для git: — сдвинулся HEAD/индекс): потребители сбрасывают кэш.
        store.add(
            rpc.handleNotification("workspace.fs.didChangeFile", (params) => {
                const p: { uris?: unknown } = params;
                const raw = Array.isArray(p.uris) ? p.uris.filter((u): u is string => typeof u === "string") : [];
                if (raw.length === 0) return;
                this.onDidChangeProvidedFileEmitter.fire(raw.map((u) => Uri.parse(u)));
            }),
        );
        // Файловые watcher'ы расширений (`workspace.createFileSystemWatcher`).
        // Слежение за деревом ведёт ядро (оно владеет excludes и бюджетом
        // inotify), а матчинг шаблона — здесь: субпроцессу уезжают только
        // подошедшие события, а не весь поток по воркспейсу.
        store.add(
            rpc.handleNotification("workspace.watcher.create", (params) => {
                const request = parseWireWatcherCreate(params);
                // Stryker disable next-line ConditionalExpression: без проверки null падает на поле до вызова watcher'а — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
                if (request === null) return;
                // Повторный id — пересоздание: `set` роняет старую подписку,
                // иначе она осталась бы висеть без владельца.
                watchers.set(
                    request.id,
                    this.fileWatcher.watch(request.base, isRecursiveWatchPattern(request.pattern), (changes) => {
                        const events = toWatcherEvents(request, changes);
                        if (events.length > 0) rpc.notify("workspace.watcher.events", { id: request.id, events });
                    }),
                );
            }),
        );
        store.add(
            rpc.handleNotification("workspace.watcher.dispose", (params) => {
                const id = parseWireWatcherDispose(params);
                // Stryker disable next-line ConditionalExpression: снятие по null-ключу — no-op, такого watcher'а нет
                if (id === null) return;
                watchers.deleteAndDispose(id);
            }),
        );
        // Объявленное субпроцессом умирает вместе с ним: провайдеры схем, которые
        // он держал, отвечать больше не будут. Схемы ФС снимаются с событием —
        // по нему адаптер убирает хост из реестра ядра (иначе `git:` указывал бы
        // на мёртвый субпроцесс до его оживления).
        store.add({
            dispose: () => {
                this.live = null;
                if (this.fileSystemSchemesValue.length === 0) return;
                this.fileSystemSchemesValue = [];
                this.onFileSystemProvidersChangedEmitter.fire();
            },
        });
        return store;
    }
}

/**
 * Рекурсивен ли watcher с таким шаблоном. Правило VS Code: `RelativePattern`
 * с простым `*` (или другим односегментным шаблоном) следит только за прямыми
 * детьми базы, а как только в шаблоне появляется `**` или разделитель — за
 * поддеревом. Именно на этом различии держится дешёвый watcher `.git`:
 * `new RelativePattern(dotGit, "*")` не тащит за собой `.git/objects`.
 */
export function isRecursiveWatchPattern(pattern: string): boolean {
    return pattern.includes("**") || pattern.includes("/");
}

/**
 * Фильтрует пачку изменений одного watcher'а и переводит её в wire-события:
 * отбрасывает то, что вне базы, не подошло шаблону или выключено флагами
 * `ignore*Events`. Путь матчится относительно базы в posix-форме — так шаблон
 * `RelativePattern` работает одинаково на всех платформах.
 */
export function toWatcherEvents(request: IWireWatcherCreate, changes: readonly ITreeFileChange[]): IWireWatcherEvent[] {
    const events: IWireWatcherEvent[] = [];
    for (const change of changes) {
        if (change.type === "created" && request.ignoreCreateEvents) continue;
        if (change.type === "changed" && request.ignoreChangeEvents) continue;
        if (change.type === "deleted" && request.ignoreDeleteEvents) continue;
        const relative = path.relative(request.base, change.path);
        // Вне базы (`..`) или сама база (пустой путь) — не наше событие.
        if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) continue;
        if (!matchGlob(request.pattern, relative.split(path.sep).join("/"))) continue;
        events.push({ type: change.type, uri: Uri.file(change.path).toString() });
    }
    return events;
}

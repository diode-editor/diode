import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type {
    IWireInputBoxRequest,
    IWireOpenDialogRequest,
    IWireQuickPickEvent,
    IWireQuickPickRequest,
    IWireQuickPickUpdate,
    IWireSaveDialogRequest,
    IWireShowMessageRequest,
    IWireStatusBarItem,
    IWireTerminalClosed,
    IWireTerminalCreate,
    IWireTerminalOpened,
    IWireTerminalRef,
    IWireValidationMessage,
    WireMarker,
    WireOutputLevel,
} from "./wireTypes.ts";

/** Полный набор маркеров ресурса: замена, не мерж. */
export type DiagnosticsSink = (owner: string, resource: string, markers: readonly WireMarker[]) => void;

/** `handle` уникален в рамках субпроцесса. */
export interface IProgressSink {
    start(handle: number, title: string): void;
    report(handle: number, message?: string, increment?: number): void;
    end(handle: number): void;
}

export interface IOutputSink {
    append(channel: string, label: string, level: WireOutputLevel, value: string): void;
    show(channel: string, label: string): void;
}

/** `clear` — субпроцесс умер, и его `remove` уже не придёт. */
export interface IStatusBarItemSink {
    update(item: IWireStatusBarItem): void;
    remove(handle: number): void;
    clear(): void;
}

/**
 * `cancel(handle)` ОБЯЗАН довести обещание расширения до `undefined`: иначе
 * команда расширения зависает навсегда, и этого ниоткуда не видно.
 */
export interface IQuickInputSink {
    showInputBox(request: IQuickInputBoxRequest): Promise<string | undefined>;
    showQuickPick(request: IWireQuickPickRequest): Promise<readonly number[] | undefined>;
    cancel(handle: number): void;
    /** Первый апдейт handle'а заводит пикер, следующие — диффом; действия идут в `emit` ПЕРВОГО апдейта. */
    updateQuickPick(update: IWireQuickPickUpdate, emit: (event: IWireQuickPickEvent) => void): void;
    disposeQuickPick(handle: number): void;
}

export interface IFileDialogSink {
    showOpenDialog(request: IWireOpenDialogRequest): Promise<readonly string[] | undefined>;
    showSaveDialog(request: IWireSaveDialogRequest): Promise<string | undefined>;
}

/**
 * Резолвится ИНДЕКСОМ кнопки в `request.items`. Без кнопок — СРАЗУ: иначе
 * `await showErrorMessage(...)` висел бы на жизни тоста, а error-тост сам не
 * гаснет. `cancel(handle)` — смерть субпроцесса: ответить уже некому.
 */
export interface INotificationSink {
    showMessage(request: INotificationRequest): Promise<number | undefined>;
    cancel(handle: number): void;
}

/** Адрес минтит хост: у `show*Message` нет токена, а гасить показ при смерти субпроцесса нужно хосту. */
export interface INotificationRequest extends IWireShowMessageRequest {
    readonly handle: number;
}

/** Валидация живёт в расширении: сток зовёт её через границу процессов; `undefined` — `validateInput` нет. */
export interface IQuickInputBoxRequest extends IWireInputBoxRequest {
    readonly validate?: (value: string) => Promise<IWireValidationMessage | null>;
}

/** `$acceptTerminal*` эталона. */
export interface IExtensionTerminalEvents {
    opened(terminal: IWireTerminalOpened): void;
    closed(terminal: IWireTerminalClosed): void;
    activeChanged(id: number | null): void;
    /** Эмулятор pty-терминала подключён — расширению пора звать `pty.open(dims)`. */
    ptyStart(id: number, cols: number, rows: number): void;
    /** Набор человека и `sendText` → `pty.handleInput`. */
    ptyInput(id: number, data: string): void;
    ptyResize(id: number, cols: number, rows: number): void;
}

/**
 * Пересказывает жизнь ВСЕХ терминалов, включая шеллы человека, как
 * `MainThreadTerminalService`. Свой терминал субпроцесс адресует `extHostId`,
 * пока не узнал хостовый `id`, — сток помнит обе метки. `reset()` — субпроцесс
 * умер: его шеллы живут дальше (как у эталона), pty-терминалы закрываются.
 */
export interface IExtensionTerminalSink {
    /** В порядке создания — семя нового субпроцесса. */
    snapshot(): { readonly terminals: readonly IWireTerminalOpened[]; readonly activeId: number | null };
    /** События до подписки — в {@link snapshot}. */
    subscribe(events: IExtensionTerminalEvents): IDisposable;
    create(request: IWireTerminalCreate): void;
    show(terminal: IWireTerminalRef, preserveFocus: boolean): void;
    hide(terminal: IWireTerminalRef): void;
    sendText(terminal: IWireTerminalRef, text: string, shouldExecute: boolean): void;
    dispose(terminal: IWireTerminalRef): void;
    ptyData(terminal: IWireTerminalRef, data: string): void;
    ptyExit(terminal: IWireTerminalRef, code: number | undefined): void;
    reset(): void;
}

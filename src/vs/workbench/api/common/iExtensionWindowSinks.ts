import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type {
    IWireInputBoxRequest,
    IWireQuickPickRequest,
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

// Стоки окна для расширений: порты, через которые хост расширений (слой node)
// показывает то, что расширение держит на экране, а адаптеры (api/browser)
// их реализуют поверх сервисов ядра.

/**
 * Сток диагностик расширений (`diagnostics.publish`): владелец (коллекция),
 * ресурс как `uri.toString()` и его полный набор маркеров (замена, не мерж).
 * Подключается в module/харнессе к `MarkerService.changeOne`.
 */
export type DiagnosticsSink = (owner: string, resource: string, markers: readonly WireMarker[]) => void;

/**
 * Сток прогресса расширений (`window.withProgress` → `window.progress.*`):
 * потребитель (module/харнесс) рисует запись статус-бара на `start`, обновляет
 * на `report` и снимает на `end`. `handle` уникален в рамках subprocess'а.
 */
export interface IProgressSink {
    start(handle: number, title: string): void;
    report(handle: number, message?: string, increment?: number): void;
    end(handle: number): void;
}

/**
 * Сток output-каналов расширений (`window.createOutputChannel` →
 * `output.append`/`output.show`): потребитель (module/харнесс) регистрирует
 * канал в реестре Output лениво по label и пишет строку логгером уровня `level`.
 */
export interface IOutputSink {
    append(channel: string, label: string, level: WireOutputLevel, value: string): void;
    show(channel: string, label: string): void;
}

/**
 * Сток пунктов статус-бара расширений (`window.createStatusBarItem` →
 * `window.statusBarItem.*`): потребитель (module/харнесс) держит запись полосы
 * на каждый живой пункт. `update` — upsert полного состояния, `remove` —
 * `hide()`/`dispose()` со стороны расширения, `clear` — субпроцесс умер и его
 * `remove` уже не придёт.
 */
export interface IStatusBarItemSink {
    update(item: IWireStatusBarItem): void;
    remove(handle: number): void;
    clear(): void;
}

/**
 * Сток ввода от расширений (`window.showInputBox` / `window.showQuickPick`):
 * потребитель (module/харнесс) поднимает QuickInput-оверлей приложения и
 * резолвится тем, что человек ввёл/выбрал, либо `undefined` на отмене.
 *
 * `cancel(handle)` закрывает показ извне — токеном отмены расширения или
 * смертью его процесса. Закрытие ОБЯЗАНО довести обещание расширения до
 * `undefined`: иначе команда расширения зависает навсегда и этого ниоткуда
 * не видно.
 */
export interface IQuickInputSink {
    showInputBox(request: IQuickInputBoxRequest): Promise<string | undefined>;
    showQuickPick(request: IWireQuickPickRequest): Promise<readonly number[] | undefined>;
    cancel(handle: number): void;
}

/**
 * Сток сообщений расширений (`window.show{Information,Warning,Error}Message`):
 * потребитель (module/харнесс) показывает их человеку — тостом над статус-баром
 * или, у модального сообщения, диалогом — и резолвится ИНДЕКСОМ нажатой кнопки
 * в `request.items` либо `undefined`, если человек закрыл сообщение не выбрав.
 *
 * Сообщение без кнопок сток обязан резолвить СРАЗУ (выбирать нечего): иначе
 * расширение, сделавшее `await showErrorMessage(...)`, повисло бы на времени
 * жизни тоста, а error-тост сам не гаснет.
 *
 * `cancel(handle)` снимает показ извне — смертью субпроцесса расширений: ответить
 * на сообщение стало некому, а на экране оно осталось бы навсегда.
 */
export interface INotificationSink {
    showMessage(request: INotificationRequest): Promise<number | undefined>;
    cancel(handle: number): void;
}

/**
 * Просьба показать сообщение плюс адрес показа. Адрес минтит ХОСТ, а не
 * расширение: отменять показ своими силами расширение не умеет (у `show*Message`
 * нет токена), а «погасить при смерти субпроцесса» нужно именно хосту.
 */
export interface INotificationRequest extends IWireShowMessageRequest {
    readonly handle: number;
}

/**
 * Просьба показать поле ввода плюс канал валидации: сама валидация живёт в
 * расширении, поэтому сток зовёт её через границу процессов на каждое изменение
 * значения. `undefined` вместо колбэка — у расширения `validateInput` нет.
 */
export interface IQuickInputBoxRequest extends IWireInputBoxRequest {
    readonly validate?: (value: string) => Promise<IWireValidationMessage | null>;
}

/**
 * События встроенного терминала, которые хост пересказывает субпроцессу
 * (`$acceptTerminal*` эталона): заведён инстанс, снят инстанс, сменился активный.
 */
export interface IExtensionTerminalEvents {
    opened(terminal: IWireTerminalOpened): void;
    closed(terminal: IWireTerminalClosed): void;
    activeChanged(id: number | null): void;
    /** Эмулятор pty-терминала подключён — расширению пора звать `pty.open(dims)`. */
    ptyStart(id: number, cols: number, rows: number): void;
    /** Набор человека (и `sendText`) в pty-терминале → `pty.handleInput`. */
    ptyInput(id: number, data: string): void;
    /** Виджет pty-терминала изменил размер → `pty.setDimensions`. */
    ptyResize(id: number, cols: number, rows: number): void;
}

/**
 * Сток терминалов расширений (`window.createTerminal` → `terminal.*`):
 * потребитель (module/харнесс) заводит и водит инстансы встроенного терминала
 * и пересказывает их жизнь — ВСЕХ, включая шеллы, открытые человеком, как
 * `MainThreadTerminalService` эталона. Свой терминал субпроцесс адресует
 * `extHostId`, пока не узнал хостовый `id`, поэтому сток помнит обе метки.
 *
 * `reset()` — субпроцесс умер: его `extHostId` больше ничего не значат.
 * Шеллы, заведённые расширением, при этом живут дальше (у эталона тоже):
 * новый субпроцесс увидит их в {@link snapshot} как чужие. Pty-терминалы умершего
 * субпроцесса закрываются — их процесс (объект расширения) умер вместе с ним.
 */
export interface IExtensionTerminalSink {
    /** Живые инстансы в порядке создания и активный — семя нового субпроцесса. */
    snapshot(): { readonly terminals: readonly IWireTerminalOpened[]; readonly activeId: number | null };
    /** Подписка на жизнь инстансов; события до неё — в {@link snapshot}. */
    subscribe(events: IExtensionTerminalEvents): IDisposable;
    create(request: IWireTerminalCreate): void;
    show(terminal: IWireTerminalRef, preserveFocus: boolean): void;
    hide(terminal: IWireTerminalRef): void;
    sendText(terminal: IWireTerminalRef, text: string, shouldExecute: boolean): void;
    dispose(terminal: IWireTerminalRef): void;
    /** Вывод pty расширения → эмулятор терминала. */
    ptyData(terminal: IWireTerminalRef, data: string): void;
    /** Pty расширения закрылся сам → инстанс закрывается с его кодом. */
    ptyExit(terminal: IWireTerminalRef, code: number | undefined): void;
    reset(): void;
}

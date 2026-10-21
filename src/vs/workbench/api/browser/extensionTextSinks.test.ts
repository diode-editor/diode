import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { CODICON_GLYPHS } from "../../../base/common/codicons.generated.ts";
import { commandPaletteLabel, CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import type { ILogService, ILogSink } from "../../../platform/log/common/iLogService.ts";
import { LogService } from "../../../platform/log/common/logService.ts";
import { RingBufferSink } from "../../../platform/log/common/ringBufferSink.ts";
import { NULL_STATE_SERVICE } from "../../../platform/state/common/nullStateService.ts";
import { QuickInputComponent } from "../../browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputService } from "../../browser/parts/quickinput/quickInputService.ts";
import { ExtensionHost } from "../../services/extensions/node/extensionHost.ts";
import { NotificationService } from "../../services/notification/browser/notificationService.ts";
import { OutputChannelRegistry } from "../../services/output/common/outputChannelRegistry.ts";
import { OutputService } from "../../services/output/common/outputService.ts";
import { StatusBarService } from "../../services/statusbar/common/statusBarService.ts";
import type { ICommandService } from "../common/iCommandService.ts";
import type { IEditorOptionsService } from "../common/iEditorOptionsService.ts";
import type {
    IWireInputBoxRequest,
    IWireMessageItem,
    IWireOutputAppend,
    IWireOutputShow,
    IWireProgressReport,
    IWireProgressStart,
    IWireQuickPickItem,
    IWireQuickPickRequest,
    IWireQuickPickSessionItem,
    IWireQuickPickUpdate,
    IWireShowMessageRequest,
    IWireStatusBarItem,
    IWireValidationMessage,
} from "../common/wireTypes.ts";

import { CommandServiceAdapter } from "./commandServiceAdapter.ts";
import { ExtensionOutputAdapter } from "./extensionOutputAdapter.ts";
import { ExtensionStatusBarAdapter } from "./extensionStatusBarAdapter.ts";
import { NotificationExtensionAdapter } from "./notificationExtensionAdapter.ts";
import { ProgressStatusBarAdapter } from "./progressStatusBarAdapter.ts";
import { QuickInputExtensionAdapter } from "./quickInputExtensionAdapter.ts";

// Перечень раковин «текст расширения → интерфейс», у него два гейта:
//  1. Типов: таблицы — `Record<TextFields<IWire…>, …>`; новое строковое поле wire-типа без
//     строки в таблице — красный typecheck.
//  2. Поведения: на каждое поле `icons`/`verbatim` обязан быть кейс в {@link CASES}, гоняющий
//     текст через настоящую раковину; сверяет тест «перечень покрыт целиком».
// Подмена значков живёт в раковине, а не на входе RPC: содержимое Output и тела диагностик —
// текст, где `$(…)` бывает шелл-подстановкой, `InputBox.value` уезжает обратно расширению,
// а `renderCodicons` выбрасывает неизвестные имена.
// Раковин пока нет: `window.setStatusBarMessage`, `languages.createLanguageStatusItem`,
// заголовки view и `contributes.menus`, SCM (нет API), `QuickPickItem.detail` (нет на проводе),
// `MarkdownString.supportThemeIcons`.

/**
 * `icons` — ярлык, значки подменяем; `verbatim` — дословно (свободный текст или значение,
 * едущее обратно расширению); `internal` — человеку не показывается.
 */
type Policy = "icons" | "verbatim" | "internal";

/** Литеральные объединения (`severity`, `level`) — перечисления, а не текст. */
type TextFields<T> = {
    [K in keyof T]-?: string extends T[K] ? K : never;
}[keyof T];

interface IFieldPolicy {
    readonly policy: Policy;
    readonly why: string;
}

const QUICK_PICK_REQUEST: Readonly<Record<TextFields<IWireQuickPickRequest>, IFieldPolicy>> = {
    title: {
        policy: "icons",
        why: "заголовок, врезанный в рамку оверлея. Эталон кладёт его в textContent (значки не разворачивает) — осознанное отклонение: в терминале это обычные клетки текста, и литерал `$(folder)` в них не значит ничего",
    },
    placeHolder: {
        policy: "icons",
        why: "призрачный текст строки запроса. У эталона это HTML-атрибут `placeholder`, который разметку носить физически не может; у нас — текст, см. title",
    },
};

const QUICK_PICK_ITEM: Readonly<Record<TextFields<IWireQuickPickItem>, IFieldPolicy>> = {
    label: {
        policy: "icons",
        why: "`QuickPickItem.label` — поддержка значков обещана в `vscode.d.ts` дословно; так пишут метки почти все расширения",
    },
    description: { policy: "icons", why: "`QuickPickItem.description` — та же строка d.ts" },
};

const QUICK_PICK_UPDATE: Readonly<Record<TextFields<IWireQuickPickUpdate>, IFieldPolicy>> = {
    title: { policy: "icons", why: "см. `window.showQuickPick.title` — объектный пикер на том же виджете" },
    placeholder: { policy: "icons", why: "см. `window.showQuickPick.placeHolder`" },
    prompt: { policy: "icons", why: "см. `window.showInputBox.prompt` — та же строка под полем" },
    value: {
        policy: "verbatim",
        why: "НЕ ярлык: текст запроса, который человек правит и который уезжает обратно расширению (`onDidChangeValue`)",
    },
};

const QUICK_PICK_SESSION_ITEM: Readonly<Record<TextFields<IWireQuickPickSessionItem>, IFieldPolicy>> = {
    label: { policy: "icons", why: "см. `window.showQuickPick.item.label`" },
    description: { policy: "icons", why: "см. `window.showQuickPick.item.description`" },
    detail: {
        policy: "icons",
        why: "`QuickPickItem.detail` — значки обещаны в d.ts; наш однострочный ряд показывает его на месте описания, когда описания нет",
    },
};

const INPUT_BOX_REQUEST: Readonly<Record<TextFields<IWireInputBoxRequest>, IFieldPolicy>> = {
    title: { policy: "icons", why: "см. `window.showQuickPick.title` — тот же виджет" },
    prompt: {
        policy: "icons",
        why: "подсказка под полем. У эталона она идёт через `renderQuickInputDescription` → `renderLabelWithIcons`, то есть значки там живые",
    },
    placeHolder: { policy: "icons", why: "см. `window.showQuickPick.placeHolder`" },
    value: {
        policy: "verbatim",
        why: "НЕ ярлык: начальное значение поля, которое человек правит и которое уезжает обратно расширению. Подмена испортила бы данные",
    },
};

const VALIDATION_MESSAGE: Readonly<Record<TextFields<IWireValidationMessage>, IFieldPolicy>> = {
    message: {
        policy: "icons",
        why: "у эталона сообщение валидации рисует тот же `renderQuickInputDescription`, что и prompt",
    },
};

const STATUS_BAR_ITEM: Readonly<Record<TextFields<IWireStatusBarItem>, IFieldPolicy>> = {
    id: { policy: "internal", why: "ключ записи полосы (к нему хост добавляет свой префикс)" },
    text: {
        policy: "icons",
        why: "`StatusBarItem.text` — d.ts прямо показывает `My text $(icon-name)`. Подмена идёт ДО обрезки по 24 символам, иначе разметка съела бы смысл",
    },
    name: {
        policy: "icons",
        why: "подпись пункта в меню видимости полосы — ярлык. d.ts про значки здесь молчит, но меню у нас обычный список подписей",
    },
    command: { policy: "internal", why: "идентификатор команды по клику" },
};

const PROGRESS_START: Readonly<Record<TextFields<IWireProgressStart>, IFieldPolicy>> = {
    title: {
        policy: "icons",
        why: "`withProgress` у нас всегда едет в полосу = `ProgressLocation.Window`, а d.ts обещает значки именно в его подписи",
    },
};

const PROGRESS_REPORT: Readonly<Record<TextFields<IWireProgressReport>, IFieldPolicy>> = {
    message: { policy: "icons", why: "вторая половина той же подписи полосы" },
};

const OUTPUT_APPEND: Readonly<Record<TextFields<IWireOutputAppend>, IFieldPolicy>> = {
    channel: { policy: "internal", why: "ключ канала в реестре и логгере" },
    label: {
        policy: "icons",
        why: "имя канала уезжает заголовком команды `Output: Show <имя>` и подписью пункта селектора — то есть в метку quick pick'а (так же устроен и эталон)",
    },
    value: {
        policy: "verbatim",
        why: "СОДЕРЖИМОЕ лога. `$(…)` здесь бывает настоящей шелл-подстановкой, а подмена неизвестного имени её бы стёрла",
    },
};

const OUTPUT_SHOW: Readonly<Record<TextFields<IWireOutputShow>, IFieldPolicy>> = {
    channel: { policy: "internal", why: "см. `output.append.channel`" },
    label: { policy: "icons", why: "см. `output.append.label`: `show` регистрирует канал, если строк ещё не было" },
};

const SHOW_MESSAGE_REQUEST: Readonly<Record<TextFields<IWireShowMessageRequest>, IFieldPolicy>> = {
    message: {
        policy: "verbatim",
        why: "эталон значки в сообщениях не разворачивает (`notificationsViewer` рисует текст и ссылки; d.ts у `ProgressLocation.Notification` прямо пишет «does not support rendering of icons»). Это свободная проза, в которой `$(…)` бывает цитатой шелла",
    },
    detail: { policy: "verbatim", why: "приглушённая вторая строка того же сообщения" },
};

const MESSAGE_ITEM: Readonly<Record<TextFields<IWireMessageItem>, IFieldPolicy>> = {
    title: { policy: "verbatim", why: "подпись кнопки сообщения; у эталона кнопки тоста значков не разворачивают" },
};

/** Вклады манифеста — вторая воронка, у неё нет wire-типа. */
const MANIFEST_FIELDS: Readonly<Record<string, IFieldPolicy>> = {
    title: {
        policy: "icons",
        why: "`contributes.commands.title` становится подписью пункта палитры, а подпись палитры у эталона — метка quick pick'а со живыми значками (ровно так их пишет redhat.java)",
    },
    category: { policy: "icons", why: "та же подпись: категория идёт её префиксом («Java: Clean Workspace»)" },
};

const SINKS: Readonly<Record<string, IFieldPolicy>> = Object.fromEntries(
    (
        [
            ["window.showQuickPick", QUICK_PICK_REQUEST],
            ["window.showQuickPick.item", QUICK_PICK_ITEM],
            ["window.quickPick.update", QUICK_PICK_UPDATE],
            ["window.quickPick.update.item", QUICK_PICK_SESSION_ITEM],
            ["window.showInputBox", INPUT_BOX_REQUEST],
            ["window.inputBox.validate", VALIDATION_MESSAGE],
            ["window.statusBarItem.update", STATUS_BAR_ITEM],
            ["window.progress.start", PROGRESS_START],
            ["window.progress.report", PROGRESS_REPORT],
            ["output.append", OUTPUT_APPEND],
            ["output.show", OUTPUT_SHOW],
            ["window.showMessage", SHOW_MESSAGE_REQUEST],
            ["window.showMessage.item", MESSAGE_ITEM],
            ["contributes.commands", MANIFEST_FIELDS],
        ] as readonly (readonly [string, Readonly<Record<string, IFieldPolicy>>])[]
    ).flatMap(([message, table]) =>
        Object.entries(table).map(([field, policy]) => [`${message}.${field}`, policy] as const),
    ),
);

const CHECK = CODICON_GLYPHS.check ?? "";
const ZAP = CODICON_GLYPHS.zap ?? "";

const FEED = "$(check) Готово";
const RENDERED = `${CHECK} Готово`;

const FEED_2 = "$(zap) Живо";
const RENDERED_2 = `${ZAP} Живо`;

interface ISinkCase {
    readonly sink: string;
    readonly feed: string;
    readonly shown: () => Promise<string> | string;
}

function statusBarSetup(): { bar: StatusBarService; adapter: ExtensionStatusBarAdapter } {
    const bar = new StatusBarService(NULL_STATE_SERVICE);
    const commands: ICommandService = {
        execute: () => undefined,
        registerProxy: () => ({ dispose: () => undefined }),
    };
    return { bar, adapter: new ExtensionStatusBarAdapter(bar, commands) };
}

function outputSetup(): {
    adapter: ExtensionOutputAdapter;
    registry: OutputChannelRegistry;
    history: RingBufferSink;
} {
    const logService = new LogService();
    const history = new RingBufferSink();
    logService.addSink(history as ILogSink);
    const registry = new OutputChannelRegistry();
    const outputService = new OutputService(history, logService as ILogService, registry, new ContextKeyService());
    const adapter = new ExtensionOutputAdapter(registry, logService as ILogService, outputService, () => undefined);
    return { adapter, registry, history };
}

function quickInputSetup(): {
    adapter: QuickInputExtensionAdapter;
    component: QuickInputComponent;
    testApp: TestApp;
} {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { adapter: new QuickInputExtensionAdapter(service), component, testApp };
}

function showObjectPick(patch: Partial<IWireQuickPickUpdate>): QuickInputComponent {
    const { adapter, component } = quickInputSetup();
    adapter.updateQuickPick({ handle: 1, visible: true, ...patch }, () => undefined);
    return component;
}

function pickRequest(patch: Partial<IWireQuickPickRequest> = {}): IWireQuickPickRequest {
    return { handle: 1, canPickMany: false, items: [{ label: "alpha" }], picked: [], ...patch };
}

function channelLabel(registry: OutputChannelRegistry, id: string): string {
    const found = registry.getChannels().find((c) => c.id === id);
    if (found === undefined) throw new Error(`канал "${id}" не зарегистрирован`);
    return found.label;
}

const NOOP_EDITOR_OPTIONS = {
    getActiveEditorOptions: () => null,
    setActiveEditorOptions: () => undefined,
    getActiveEditorFilePath: () => null,
    getActiveEditorMeta: () => ({ uri: null, languageId: null, isDirty: false }),
    onActiveEditorChanged: () => ({ dispose: () => undefined }),
    onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
    setActiveEditorSelections: () => undefined,
    applyActiveEditorEdits: () => true,
} as unknown as IEditorOptionsService;

/** Как собирает провайдер палитры; заголовок приезжает с заглушки-активатора `onCommand:`. */
function paletteLabel(title: string, category: string): string {
    const registry = new CommandRegistry();
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, new CommandServiceAdapter(registry), {});
    try {
        host.registerExtension({
            id: "demo.sinks",
            manifest: { name: "sinks", publisher: "demo", version: "0.0.1" },
            source: "exports.activate = () => undefined;",
            filename: "/demo/sinks/extension.cjs",
            activationEvents: ["onCommand:demo.run"],
            commandTitles: { "demo.run": title },
            commandCategories: { "demo.run": category },
        });
        const command = registry.listCommands().find((c) => c.id === "demo.run");
        if (command === undefined) throw new Error("команда расширения не попала в реестр");
        return commandPaletteLabel(command);
    } finally {
        host.dispose();
    }
}

const CASES: readonly ISinkCase[] = [
    {
        sink: "window.statusBarItem.update.text",
        feed: FEED,
        shown: () => {
            const { bar, adapter } = statusBarSetup();
            adapter.update({ handle: 1, id: "demo", alignment: "right", text: FEED });
            return bar.entries()[0].text;
        },
    },
    {
        sink: "window.statusBarItem.update.name",
        feed: FEED,
        shown: () => {
            const { bar, adapter } = statusBarSetup();
            adapter.update({ handle: 1, id: "demo", alignment: "right", text: "x", name: FEED });
            return bar.allEntries()[0].name ?? "";
        },
    },
    {
        sink: "window.progress.start.title",
        feed: FEED,
        shown: () => {
            const bar = new StatusBarService(NULL_STATE_SERVICE);
            const adapter = new ProgressStatusBarAdapter(bar);
            try {
                adapter.start(1, FEED);
                // Спиннер — наш, не расширения: сравниваем хвост записи.
                return bar.entries()[0].text.split(" ").slice(1).join(" ");
            } finally {
                adapter.dispose();
            }
        },
    },
    {
        sink: "window.progress.report.message",
        feed: FEED,
        shown: () => {
            const bar = new StatusBarService(NULL_STATE_SERVICE);
            const adapter = new ProgressStatusBarAdapter(bar);
            try {
                adapter.start(1, "Build");
                adapter.report(1, FEED);
                const [, tail] = bar.entries()[0].text.split(" Build · ");
                return tail;
            } finally {
                adapter.dispose();
            }
        },
    },
    {
        sink: "output.append.label",
        feed: FEED,
        shown: () => {
            const { adapter, registry } = outputSetup();
            adapter.append("extensions.demo", FEED, "info", "строка");
            return channelLabel(registry, "extensions.demo");
        },
    },
    {
        sink: "output.show.label",
        feed: FEED,
        shown: () => {
            const { adapter, registry } = outputSetup();
            adapter.show("extensions.demo", FEED);
            return channelLabel(registry, "extensions.demo");
        },
    },
    {
        sink: "output.append.value",
        feed: FEED,
        shown: () => {
            const { adapter, history } = outputSetup();
            adapter.append("extensions.demo", "Demo", "info", FEED);
            return history.getEntries("extensions.demo")[0].message;
        },
    },
    {
        sink: "window.showQuickPick.title",
        feed: FEED,
        shown: async () => {
            const { adapter, component, testApp } = quickInputSetup();
            const pending = adapter.showQuickPick(pickRequest({ title: FEED }));
            const shown = component.view.title ?? "";
            testApp.sendKey("Escape");
            await pending;
            return shown;
        },
    },
    {
        sink: "window.showQuickPick.placeHolder",
        feed: FEED,
        shown: async () => {
            const { adapter, component, testApp } = quickInputSetup();
            const pending = adapter.showQuickPick(pickRequest({ placeHolder: FEED }));
            const shown = component.view.placeholder;
            testApp.sendKey("Escape");
            await pending;
            return shown;
        },
    },
    {
        sink: "window.showQuickPick.item.label",
        feed: FEED,
        shown: async () => {
            const { adapter, component, testApp } = quickInputSetup();
            const pending = adapter.showQuickPick(pickRequest({ items: [{ label: FEED }] }));
            const shown = component.view.items[0].label;
            testApp.sendKey("Escape");
            await pending;
            return shown;
        },
    },
    {
        sink: "window.showQuickPick.item.description",
        feed: FEED,
        shown: async () => {
            const { adapter, component, testApp } = quickInputSetup();
            const pending = adapter.showQuickPick(pickRequest({ items: [{ label: "a", description: FEED }] }));
            const shown = component.view.items[0].description ?? "";
            testApp.sendKey("Escape");
            await pending;
            return shown;
        },
    },
    {
        sink: "window.quickPick.update.title",
        feed: FEED,
        shown: () => showObjectPick({ title: FEED }).view.title ?? "",
    },
    {
        sink: "window.quickPick.update.placeholder",
        feed: FEED,
        shown: () => showObjectPick({ placeholder: FEED }).view.placeholder,
    },
    {
        sink: "window.quickPick.update.prompt",
        feed: FEED,
        shown: () => showObjectPick({ prompt: FEED }).view.prompt ?? "",
    },
    {
        sink: "window.quickPick.update.value",
        feed: FEED,
        shown: () => showObjectPick({ value: FEED }).view.getQuery(),
    },
    {
        sink: "window.quickPick.update.item.label",
        feed: FEED,
        shown: () => showObjectPick({ items: [{ handle: 0, label: FEED }] }).view.items[0].label,
    },
    {
        sink: "window.quickPick.update.item.description",
        feed: FEED,
        shown: () =>
            showObjectPick({ items: [{ handle: 0, label: "a", description: FEED }] }).view.items[0].description ?? "",
    },
    {
        sink: "window.quickPick.update.item.detail",
        feed: FEED,
        shown: () =>
            showObjectPick({ items: [{ handle: 0, label: "a", detail: FEED }] }).view.items[0].description ?? "",
    },
    {
        sink: "window.showInputBox.title",
        feed: FEED,
        shown: async () => {
            const { adapter, component, testApp } = quickInputSetup();
            const pending = adapter.showInputBox({ handle: 1, password: false, validates: false, title: FEED });
            const shown = component.view.title ?? "";
            testApp.sendKey("Escape");
            await pending;
            return shown;
        },
    },
    {
        sink: "window.showInputBox.prompt",
        feed: FEED,
        shown: async () => {
            const { adapter, component, testApp } = quickInputSetup();
            const pending = adapter.showInputBox({ handle: 1, password: false, validates: false, prompt: FEED });
            const shown = component.view.prompt ?? "";
            testApp.sendKey("Escape");
            await pending;
            return shown;
        },
    },
    {
        sink: "window.showInputBox.placeHolder",
        feed: FEED,
        shown: async () => {
            const { adapter, component, testApp } = quickInputSetup();
            const pending = adapter.showInputBox({ handle: 1, password: false, validates: false, placeHolder: FEED });
            const shown = component.view.placeholder;
            testApp.sendKey("Escape");
            await pending;
            return shown;
        },
    },
    {
        sink: "window.showInputBox.value",
        feed: FEED,
        shown: async () => {
            const { adapter, component, testApp } = quickInputSetup();
            const pending = adapter.showInputBox({ handle: 1, password: false, validates: false, value: FEED });
            const shown = String(component.view.inspectState().query);
            testApp.sendKey("Escape");
            await pending;
            return shown;
        },
    },
    {
        sink: "window.inputBox.validate.message",
        feed: FEED,
        shown: async () => {
            const { adapter, component, testApp } = quickInputSetup();
            const pending = adapter.showInputBox({
                handle: 1,
                password: false,
                validates: true,
                validate: () => Promise.resolve({ message: FEED, severity: "error" as const }),
            });
            testApp.sendKey("a");
            await Promise.resolve();
            await Promise.resolve();
            const shown = component.view.validationMessage ?? "";
            testApp.sendKey("Escape");
            await pending;
            return shown;
        },
    },
    {
        sink: "window.showMessage.message",
        feed: FEED,
        shown: async () => {
            const notifications = new NotificationService();
            const adapter = new NotificationExtensionAdapter(notifications);
            const request: IWireShowMessageRequest & { handle: number } = {
                handle: 1,
                severity: "info",
                message: FEED,
                modal: false,
                items: [{ title: "Ok", isCloseAffordance: false }],
            };
            const pending = adapter.showMessage(request);
            const shown = notifications.current()?.message ?? "";
            notifications.clearAll();
            await pending;
            return shown;
        },
    },
    {
        sink: "window.showMessage.detail",
        feed: FEED,
        shown: async () => {
            const notifications = new NotificationService();
            const adapter = new NotificationExtensionAdapter(notifications);
            const pending = adapter.showMessage({
                handle: 1,
                severity: "info",
                message: "Готово",
                detail: FEED,
                modal: true,
                items: [{ title: "Ok", isCloseAffordance: false }],
            });
            const shown = notifications.current()?.detail ?? "";
            notifications.clearAll();
            await pending;
            return shown;
        },
    },
    {
        sink: "window.showMessage.item.title",
        feed: FEED,
        shown: async () => {
            const notifications = new NotificationService();
            const adapter = new NotificationExtensionAdapter(notifications);
            const pending = adapter.showMessage({
                handle: 1,
                severity: "info",
                message: "Готово",
                modal: false,
                items: [{ title: FEED, isCloseAffordance: false }],
            });
            const shown = notifications.current()?.items[0] ?? "";
            notifications.clearAll();
            await pending;
            return shown;
        },
    },
    {
        sink: "contributes.commands.title",
        feed: FEED,
        shown: () => paletteLabel(FEED, "Demo").slice("Demo: ".length),
    },
    {
        sink: "contributes.commands.category",
        feed: FEED_2,
        shown: () => paletteLabel("Готово", FEED_2).split(": ")[0],
    },
];

describe("перечень раковин значков $(name)", () => {
    it("покрыт кейсами целиком — ни одного классифицированного поля без проверки", () => {
        const needCase = Object.entries(SINKS)
            .filter(([, { policy }]) => policy !== "internal")
            .map(([sink]) => sink);
        expect([...CASES.map((c) => c.sink)].sort()).toEqual([...needCase].sort());
    });

    it("у каждого кейса есть запись в перечне", () => {
        for (const { sink } of CASES) expect(SINKS[sink], sink).toBeDefined();
    });

    it("обоснование есть у каждого поля", () => {
        for (const [sink, { why }] of Object.entries(SINKS)) expect(why.length, sink).toBeGreaterThan(20);
    });
});

for (const kase of CASES) {
    const { policy, why } = SINKS[kase.sink];
    const expected = policy === "verbatim" ? kase.feed : kase.feed === FEED_2 ? RENDERED_2 : RENDERED;
    it(`${kase.sink} (${policy}): ${why.slice(0, 60)}…`, async () => {
        expect(await kase.shown()).toBe(expected);
    });
}

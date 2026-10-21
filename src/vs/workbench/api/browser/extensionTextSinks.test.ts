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

// Inventory of "extension text → UI" sinks, guarded by two gates:
//  1. Types: the tables are `Record<TextFields<IWire…>, …>`; a new string field of a wire type
//     without a table row is a red typecheck.
//  2. Behavior: every `icons`/`verbatim` field must have a case in {@link CASES} that runs the
//     text through the real sink; the "inventory fully covered" test checks this.
// Icon substitution lives in the sink, not at the RPC entry: Output content and diagnostic bodies
// are text where `$(…)` may be shell substitution, `InputBox.value` goes back to the extension,
// and `renderCodicons` drops unknown names.
// No sinks yet: `window.setStatusBarMessage`, `languages.createLanguageStatusItem`,
// view titles and `contributes.menus`, SCM (no API), `QuickPickItem.detail` (not on the wire),
// `MarkdownString.supportThemeIcons`.

/**
 * `icons`: a label, icons are substituted; `verbatim`: as is (free text or a value going back
 * to the extension); `internal`: never shown to the user.
 */
type Policy = "icons" | "verbatim" | "internal";

/** Literal unions (`severity`, `level`) are enums, not text. */
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
        why: "title inset into the overlay border. Upstream puts it in textContent (no icon expansion); a deliberate deviation: in a terminal these are plain text cells, and a literal `$(folder)` there means nothing",
    },
    placeHolder: {
        policy: "icons",
        why: "ghost text of the query line. Upstream uses the HTML `placeholder` attribute, which physically cannot carry markup; ours is text, see title",
    },
};

const QUICK_PICK_ITEM: Readonly<Record<TextFields<IWireQuickPickItem>, IFieldPolicy>> = {
    label: {
        policy: "icons",
        why: "`QuickPickItem.label`: icon support is promised verbatim in `vscode.d.ts`; almost every extension writes labels this way",
    },
    description: { policy: "icons", why: "`QuickPickItem.description`: the same d.ts line" },
};

const QUICK_PICK_UPDATE: Readonly<Record<TextFields<IWireQuickPickUpdate>, IFieldPolicy>> = {
    title: { policy: "icons", why: "see `window.showQuickPick.title`: the object picker uses the same widget" },
    placeholder: { policy: "icons", why: "see `window.showQuickPick.placeHolder`" },
    prompt: { policy: "icons", why: "see `window.showInputBox.prompt`: the same line under the input" },
    value: {
        policy: "verbatim",
        why: "NOT a label: query text the user edits and that goes back to the extension (`onDidChangeValue`)",
    },
};

const QUICK_PICK_SESSION_ITEM: Readonly<Record<TextFields<IWireQuickPickSessionItem>, IFieldPolicy>> = {
    label: { policy: "icons", why: "see `window.showQuickPick.item.label`" },
    description: { policy: "icons", why: "see `window.showQuickPick.item.description`" },
    detail: {
        policy: "icons",
        why: "`QuickPickItem.detail`: icons are promised in d.ts; our single-line row shows it in place of the description when there is none",
    },
};

const INPUT_BOX_REQUEST: Readonly<Record<TextFields<IWireInputBoxRequest>, IFieldPolicy>> = {
    title: { policy: "icons", why: "see `window.showQuickPick.title`: the same widget" },
    prompt: {
        policy: "icons",
        why: "hint under the input. Upstream renders it via `renderQuickInputDescription` → `renderLabelWithIcons`, so icons are live there",
    },
    placeHolder: { policy: "icons", why: "see `window.showQuickPick.placeHolder`" },
    value: {
        policy: "verbatim",
        why: "NOT a label: the initial input value the user edits and that goes back to the extension. Substitution would corrupt data",
    },
};

const VALIDATION_MESSAGE: Readonly<Record<TextFields<IWireValidationMessage>, IFieldPolicy>> = {
    message: {
        policy: "icons",
        why: "upstream renders the validation message with the same `renderQuickInputDescription` as prompt",
    },
};

const STATUS_BAR_ITEM: Readonly<Record<TextFields<IWireStatusBarItem>, IFieldPolicy>> = {
    id: { policy: "internal", why: "status bar entry key (the host adds its own prefix to it)" },
    text: {
        policy: "icons",
        why: "`StatusBarItem.text`: d.ts literally shows `My text $(icon-name)`. Substitution happens BEFORE the 24-char truncation, otherwise markup would eat the meaning",
    },
    name: {
        policy: "icons",
        why: "item caption in the status bar visibility menu is a label. d.ts says nothing about icons here, but our menu is a plain list of captions",
    },
    command: { policy: "internal", why: "command id run on click" },
};

const PROGRESS_START: Readonly<Record<TextFields<IWireProgressStart>, IFieldPolicy>> = {
    title: {
        policy: "icons",
        why: "our `withProgress` always goes to the status bar = `ProgressLocation.Window`, and d.ts promises icons exactly in its caption",
    },
};

const PROGRESS_REPORT: Readonly<Record<TextFields<IWireProgressReport>, IFieldPolicy>> = {
    message: { policy: "icons", why: "second half of the same status bar caption" },
};

const OUTPUT_APPEND: Readonly<Record<TextFields<IWireOutputAppend>, IFieldPolicy>> = {
    channel: { policy: "internal", why: "channel key in the registry and logger" },
    label: {
        policy: "icons",
        why: "the channel name becomes the `Output: Show <name>` command title and the selector item caption, i.e. a quick pick label (upstream works the same way)",
    },
    value: {
        policy: "verbatim",
        why: "log CONTENT. `$(…)` here can be a real shell substitution, and replacing an unknown name would erase it",
    },
};

const OUTPUT_SHOW: Readonly<Record<TextFields<IWireOutputShow>, IFieldPolicy>> = {
    channel: { policy: "internal", why: "see `output.append.channel`" },
    label: { policy: "icons", why: "see `output.append.label`: `show` registers the channel if no lines came yet" },
};

const SHOW_MESSAGE_REQUEST: Readonly<Record<TextFields<IWireShowMessageRequest>, IFieldPolicy>> = {
    message: {
        policy: "verbatim",
        why: "upstream does not expand icons in messages (`notificationsViewer` renders text and links; d.ts for `ProgressLocation.Notification` says 'does not support rendering of icons'). This is free prose where `$(…)` can be a shell quote",
    },
    detail: { policy: "verbatim", why: "dimmed second line of the same message" },
};

const MESSAGE_ITEM: Readonly<Record<TextFields<IWireMessageItem>, IFieldPolicy>> = {
    title: { policy: "verbatim", why: "message button caption; upstream toast buttons do not expand icons" },
};

/** Manifest contributions are the second funnel; they have no wire type. */
const MANIFEST_FIELDS: Readonly<Record<string, IFieldPolicy>> = {
    title: {
        policy: "icons",
        why: "`contributes.commands.title` becomes the command palette item caption, and upstream renders it as a quick pick label with live icons (exactly how redhat.java writes them)",
    },
    category: { policy: "icons", why: "the same caption: the category is its prefix ('Java: Clean Workspace')" },
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

const FEED = "$(check) Done";
const RENDERED = `${CHECK} Done`;

const FEED_2 = "$(zap) Live";
const RENDERED_2 = `${ZAP} Live`;

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
    if (found === undefined) throw new Error(`channel "${id}" is not registered`);
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

/** As the palette provider builds it; the title comes from the `onCommand:` activator stub. */
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
        if (command === undefined) throw new Error("extension command did not reach the registry");
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
                // The spinner is ours, not the extension's: compare the tail of the entry.
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
            adapter.append("extensions.demo", FEED, "info", "line");
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
                message: "Done",
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
                message: "Done",
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
        shown: () => paletteLabel("Done", FEED_2).split(": ")[0],
    },
];

describe("$(name) icon sink inventory", () => {
    it("is fully covered by cases: no classified field goes unchecked", () => {
        const needCase = Object.entries(SINKS)
            .filter(([, { policy }]) => policy !== "internal")
            .map(([sink]) => sink);
        expect([...CASES.map((c) => c.sink)].sort()).toEqual([...needCase].sort());
    });

    it("every case has an inventory entry", () => {
        for (const { sink } of CASES) expect(SINKS[sink], sink).toBeDefined();
    });

    it("every field has a rationale", () => {
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

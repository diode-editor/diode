import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { getMachineId } from "../../../../../base/node/id.ts";
import { getSystemShell } from "../../../../../base/node/shell.ts";
import type { IClipboard } from "../../../../../platform/clipboard/common/iClipboard.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IWireClipboardText } from "../../../../api/common/wireTypes.ts";
import type { IExternalOpener } from "../../../externalOpener/common/iExternalOpener.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";

/**
 * Константы окружения, которые знает только хост (`initData` эталона):
 * идентификатор машины и шелл терминала по умолчанию.
 */
export interface IExtensionHostEnvironment {
    /** `env.machineId` — стабилен между запусками (кэш в application-состоянии). */
    readonly machineId: () => string;
    /** `env.shell` — шелл, которым запустился бы терминал без `shellPath`. */
    readonly defaultShell: () => string;
}

/**
 * Окружение без проводки (тесты, хост без DI): id машины считается один раз на
 * хост и между запусками не переживает, шелл — системный.
 */
export function fallbackExtensionHostEnvironment(): IExtensionHostEnvironment {
    let machineId: string | undefined;
    return {
        machineId: () => (machineId ??= getMachineId()),
        defaultShell: () => getSystemShell(),
    };
}

/**
 * `vscode.env`: буфер обмена, внешние ссылки и константы окружения. Без буфера
 * чтение отдаёт пустую строку, а запись молча пропускается; без открывателя
 * ссылка не открывается.
 */
export class EnvCustomer implements IExtensionHostCustomer {
    /** Канал текущего спавна; `null` — спавна нет. */
    private rpc: HostRpc | null = null;

    public constructor(
        private readonly clipboard: IClipboard | undefined,
        private readonly externalOpener: IExternalOpener | undefined,
        private readonly environment: IExtensionHostEnvironment,
    ) {}

    /**
     * Семя `env.initialize` — до первой активации: `env.machineId` и
     * `env.shell` синхронные, расширение читает их прямо в `activate()`.
     * Смены шелла нет (профилей терминала у нас нет), поэтому
     * `onDidChangeShell` в субпроцессе не стреляет, и повторных семян не бывает.
     */
    public pushInitialState(): void {
        this.rpc?.notify("env.initialize", {
            machineId: this.environment.machineId(),
            shell: this.environment.defaultShell(),
        });
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        this.rpc = rpc;
        const store = new DisposableStore();
        store.add(
            rpc.handleRequest("env.clipboard.readText", async (): Promise<IWireClipboardText> => {
                return { text: (await this.clipboard?.readText()) ?? "" };
            }),
        );
        store.add(
            rpc.handleRequest("env.clipboard.writeText", async (params): Promise<null> => {
                const { text }: { text?: unknown } = params;
                // Не-строку в буфер не кладём: расширение прислало не то, что обещает
                // тип, и затирать этим настоящее содержимое буфера нельзя.
                if (typeof text === "string") await this.clipboard?.writeText(text);
                return null;
            }),
        );
        store.add(
            rpc.handleRequest("env.openExternal", async (params): Promise<{ opened: boolean }> => {
                const { uri }: { uri?: unknown } = params;
                if (typeof uri !== "string" || uri === "") return { opened: false };
                return { opened: (await this.externalOpener?.open(uri)) ?? false };
            }),
        );
        return store;
    }
}

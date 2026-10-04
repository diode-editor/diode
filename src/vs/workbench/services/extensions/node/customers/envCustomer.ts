import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { IClipboard } from "../../../../../platform/clipboard/common/iClipboard.ts";
import type { IWireClipboardText } from "../../../../api/common/wireTypes.ts";
import type { IExternalOpener } from "../../../externalOpener/common/iExternalOpener.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";

/**
 * `vscode.env`: буфер обмена и внешние ссылки. Без буфера чтение отдаёт пустую
 * строку, а запись молча пропускается; без открывателя ссылка не открывается.
 */
export class EnvCustomer implements IExtensionHostCustomer {
    public constructor(
        private readonly clipboard: IClipboard | undefined,
        private readonly externalOpener: IExternalOpener | undefined,
    ) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
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

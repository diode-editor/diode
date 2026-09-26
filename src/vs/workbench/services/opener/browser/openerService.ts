import type { IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IExternalOpener } from "../../../../platform/opener/common/iExternalOpener.ts";
import { ExternalOpenerDIToken } from "../../../../platform/opener/common/iExternalOpener.ts";
import { ClipboardDIToken } from "../../../common/coreTokens.ts";
import type { NotificationService } from "../../notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../../notification/browser/notificationService.ts";

export const OpenerServiceDIToken = token<OpenerService>("OpenerService");

/** Подпись единственной кнопки сообщения запасного пути. */
export const COPY_LINK_ITEM = "Copy Link";

/**
 * Открыватель ссылок приложения (`env.openExternal` расширений, наши ссылки):
 * сначала системный открыватель, а где его нет — ссылка человеку.
 *
 * Запасной путь — не утешительный приз. Главный режим работы терминального
 * редактора ровно такой: ssh или контейнер без графической сессии, где браузер
 * открылся бы не у того человека либо не открылся бы вовсе. Поэтому ссылка
 * показывается тостом с кнопкой «Copy Link», и нажатие кладёт её в буфер обмена
 * приложения — тот же, из которого человек вставляет в свой терминал (в проде
 * OSC 52 доносит её до системного буфера, то есть до машины пользователя).
 *
 * Обе ветки — успех (`true`): для расширения «ссылка у человека» значит то же,
 * что «браузер открылся», и `false` заставил бы его ругаться на отказ, которого
 * не было. Показать ссылку мы умеем всегда, поэтому `false` из этого сервиса не
 * выходит; отказ остаётся внутренним делом системного открывателя.
 */
export class OpenerService implements IExternalOpener {
    public static dependencies = [ExternalOpenerDIToken, NotificationServiceDIToken, ClipboardDIToken] as const;

    public constructor(
        private readonly systemOpener: IExternalOpener,
        private readonly notificationService: NotificationService,
        private readonly clipboard: IClipboard,
    ) {}

    public async openExternal(target: string): Promise<boolean> {
        if (await this.systemOpener.openExternal(target)) return true;
        // Ответ ЖДЁМ: кнопку нажимают позже показа, а расширению важен факт
        // «ссылка у человека», а не «тост создан».
        const picked = await this.notificationService.notify({
            severity: "info",
            // Сам адрес — в тексте сообщения: без него оно бесполезно даже с
            // кнопкой, а с ним ссылку можно забрать и глазами.
            message: `Open this link in your browser: ${target}`,
            items: [COPY_LINK_ITEM],
        });
        if (picked !== undefined) await this.clipboard.writeText(target);
        return true;
    }
}

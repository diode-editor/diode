import { describe, expect, it } from "vitest";

import { Uri } from "../../base/common/uri.ts";
import { NotificationService } from "../services/notification/browser/notificationService.ts";

import { OpenFailureNotificationContribution } from "./openFailureNotificationContribution.ts";

/** Срез `EditorService`, которого хватает проводке: один хук. */
function makeEditors(): { onOpenFailed?: (uri: Uri, reason: string) => void } {
    return {};
}

describe("OpenFailureNotificationContribution", () => {
    it("неудача открытия становится тостом с ресурсом и причиной", () => {
        const editors = makeEditors();
        const notifications = new NotificationService();
        const contribution = new OpenFailureNotificationContribution(
            editors as never,
            notifications as unknown as NotificationService,
        );

        editors.onOpenFailed?.(Uri.parse("jdt:///Foo.java"), 'no content provider is registered for the "jdt:" scheme');

        const shown = notifications.passive();
        expect(shown).toHaveLength(1);
        expect(shown[0].severity).toBe("error");
        expect(shown[0].message).toBe(
            `Unable to open 'jdt:/Foo.java': no content provider is registered for the "jdt:" scheme`,
        );
        // Без кнопок и не модальное: выбирать человеку нечего, тост уедет сам.
        expect(shown[0].items).toEqual([]);
        expect(shown[0].modal).toBe(false);

        contribution.dispose();
        notifications.dispose();
    });

    it("dispose снимает хук — мёртвая проводка сообщений больше не поднимает", () => {
        const editors = makeEditors();
        const notifications = new NotificationService();
        const contribution = new OpenFailureNotificationContribution(
            editors as never,
            notifications as unknown as NotificationService,
        );

        contribution.dispose();

        expect(editors.onOpenFailed).toBeUndefined();
        notifications.dispose();
    });
});

import { describe, expect, it } from "vitest";

import { Emitter } from "../../base/common/event.ts";
import { Uri } from "../../base/common/uri.ts";
import { NotificationService } from "../services/notification/browser/notificationService.ts";

import { OpenFailureNotificationContribution } from "./openFailureNotificationContribution.ts";

/** Срез `EditorService`, которого хватает проводке: одно событие. */
function makeEditors(): {
    failures: Emitter<{ uri: Uri; reason: string }>;
    onDidFailOpen: Emitter<{ uri: Uri; reason: string }>["event"];
} {
    const failures = new Emitter<{ uri: Uri; reason: string }>();
    return { failures, onDidFailOpen: failures.event };
}

describe("OpenFailureNotificationContribution", () => {
    it("неудача открытия становится тостом с ресурсом и причиной", () => {
        const editors = makeEditors();
        const notifications = new NotificationService();
        const contribution = new OpenFailureNotificationContribution(
            editors as never,
            notifications as unknown as NotificationService,
        );

        editors.failures.fire({
            uri: Uri.parse("jdt:///Foo.java"),
            reason: 'no content provider is registered for the "jdt:" scheme',
        });

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

    it("dispose снимает подписку — мёртвая проводка сообщений больше не поднимает", () => {
        const editors = makeEditors();
        const notifications = new NotificationService();
        const contribution = new OpenFailureNotificationContribution(
            editors as never,
            notifications as unknown as NotificationService,
        );

        contribution.dispose();

        expect(editors.failures.hasListeners()).toBe(false);
        editors.failures.fire({ uri: Uri.parse("jdt:///Foo.java"), reason: "x" });
        expect(notifications.passive()).toHaveLength(0);
        notifications.dispose();
    });
});

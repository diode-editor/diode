import { describe, expect, it } from "vitest";

import { startHeadlessApp } from "./appSession.ts";

// Транспорт сессии против настоящего бинаря: запрос в мёртвый сокет обязан
// отказать сразу. Раньше он висел вечно (`ws` молча выбрасывает отправку в
// закрытый сокет), и пост-мортем упавшего теста съедал весь `hookTimeout`.

describe("HeadlessSession — запрос после dispose", () => {
    it("отклоняется сразу, а не висит без ответа", { timeout: 60_000 }, async () => {
        const app = await startHeadlessApp({ open: [] });
        await app.session.waitForNode("BodyElement");
        await app.dispose();

        const outcome = await Promise.race([
            app.session.captureFrame().then(
                () => "resolved",
                (error: unknown) => (error instanceof Error ? error.message : String(error)),
            ),
            new Promise<string>((resolve) => {
                setTimeout(() => {
                    resolve("hung");
                }, 5000);
            }),
        ]);
        expect(outcome).toMatch(/^inspector request TUIDom\.captureFrame not sent: /u);
    });
});

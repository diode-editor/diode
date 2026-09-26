import { describe, expect, it } from "vitest";

import { severityColorId, severityTitle } from "./notification.ts";

// Заголовок и цвет рамки — то, по чему человек на кадре отличает ошибку от
// сообщения. Проверяем каждую строгость поимённо: подмена любого из шести
// ответов местами (или пустой строкой) — это тост, который врёт про свой уровень.

describe("severityTitle", () => {
    it("слово строгости — по одному на уровень", () => {
        expect(severityTitle("info")).toBe("Information");
        expect(severityTitle("warning")).toBe("Warning");
        expect(severityTitle("error")).toBe("Error");
    });
});

describe("severityColorId", () => {
    it("токен темы — по одному на уровень", () => {
        expect(severityColorId("info")).toBe("notificationsInfoIcon.foreground");
        expect(severityColorId("warning")).toBe("notificationsWarningIcon.foreground");
        expect(severityColorId("error")).toBe("notificationsErrorIcon.foreground");
    });

    it("уровни не делят один токен — иначе строгость не читалась бы по цвету", () => {
        const ids = [severityColorId("info"), severityColorId("warning"), severityColorId("error")];
        expect(new Set(ids).size).toBe(3);
    });
});

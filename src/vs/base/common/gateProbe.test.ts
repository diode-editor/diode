import { describe, expect, it } from "vitest";

import { clamp } from "./gateProbe.ts";

describe("clamp", () => {
    // Намеренно слабый тест: исполняет все три ветки (покрытие 100% по всем
    // четырём метрикам), но не проверяет ни одного значения. Мутанты выживают —
    // именно это и должно уронить job `mutation`.
    it("возвращает число", () => {
        expect(typeof clamp(-5, 0, 10)).toBe("number");
        expect(typeof clamp(50, 0, 10)).toBe("number");
        expect(typeof clamp(5, 0, 10)).toBe("number");
    });
});

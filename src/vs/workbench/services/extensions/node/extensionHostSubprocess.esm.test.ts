import { describe, expect, it } from "vitest";

import { isEsmEntry } from "./extensionHostSubprocess.ts";

// Правило выбора loader'а. Функция чистая, поэтому проверяется здесь (генерация
// виртуального ESM-модуля `"vscode"` — в `api/common/extensionApiFactory.esm.test.ts`); что ESM-расширение реально
// активируется, закрывает `extensionHost.esmExtension.test.ts` (он поднимает
// субпроцесс БЕЗ tsx — иначе `import … from "vscode"` уходит в CJS-резолвер
// tsx и маскирует отсутствие хука).

describe("isEsmEntry — правило эталона", () => {
    it(".mjs — всегда ESM, независимо от манифеста", () => {
        expect(isEsmEntry("/x/extension.mjs", undefined)).toBe(true);
        expect(isEsmEntry("/x/extension.mjs", "commonjs")).toBe(true);
    });

    it(".cjs — всегда CJS, даже у пакета с type=module", () => {
        expect(isEsmEntry("/x/extension.cjs", "module")).toBe(false);
    });

    it(".js решает `type` пакета", () => {
        expect(isEsmEntry("/x/extension.js", "module")).toBe(true);
        expect(isEsmEntry("/x/extension.js", "commonjs")).toBe(false);
        expect(isEsmEntry("/x/extension.js", undefined)).toBe(false);
    });
});

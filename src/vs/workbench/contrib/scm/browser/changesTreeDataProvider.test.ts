import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";

import type { IScmChange } from "./changesService.ts";
import { ChangesTreeDataProvider } from "./changesTreeDataProvider.ts";

function change(
    fsPath: string,
    status: string,
    relPath: string,
    colorId = "gitDecoration.modifiedResourceForeground",
): IScmChange {
    return { uri: Uri.file(fsPath), status, colorId, path: relPath };
}

describe("ChangesTreeDataProvider", () => {
    it("плоский список: дети только у корня, отсортированы по пути", () => {
        const provider = new ChangesTreeDataProvider();
        provider.setChanges([change("/repo/src/b.ts", "M", "src/b.ts"), change("/repo/a.ts", "A", "a.ts")]);

        const nodes = provider.getChildren();
        expect(nodes.map((n) => n.uri.fsPath)).toEqual(["/repo/a.ts", "/repo/src/b.ts"]);
        expect(provider.getChildren(nodes[0])).toEqual([]);
    });

    it("метка — путь от git (относительно корня репозитория)", () => {
        const provider = new ChangesTreeDataProvider();
        provider.setChanges([change("/repo/src/deep/mod.ts", "M", "src/deep/mod.ts")]);

        expect(provider.getTreeItem(provider.getChildren()[0]).label).toBe("src/deep/mod.ts");
    });

    it("без пути от git — basename из URI", () => {
        const provider = new ChangesTreeDataProvider();
        provider.setChanges([change("/repo/src/a.ts", "M", "")]);

        expect(provider.getTreeItem(provider.getChildren()[0]).label).toBe("a.ts");
    });

    it("буква-статус и цвет из карты colorId → RGB", () => {
        const provider = new ChangesTreeDataProvider();
        provider.statusColors = { "gitDecoration.untrackedResourceForeground": 0x33bb77 };
        provider.setChanges([change("/repo/a.ts", "U", "a.ts", "gitDecoration.untrackedResourceForeground")]);

        const item = provider.getTreeItem(provider.getChildren()[0]);
        expect(item.badge).toBe("U");
        expect(item.labelColor).toBe(0x33bb77);
        expect(item.collapsible).toBe(false);
    });

    it("неизвестный colorId → цвет не задан (fallback на fg темы у виджета)", () => {
        const provider = new ChangesTreeDataProvider();
        provider.setChanges([change("/repo/a.ts", "M", "a.ts", "gitDecoration.unknown")]);

        expect(provider.getTreeItem(provider.getChildren()[0]).labelColor).toBeUndefined();
    });

    it("ключ узла — строка URI", () => {
        const provider = new ChangesTreeDataProvider();
        provider.setChanges([change("/repo/a.ts", "M", "a.ts")]);

        expect(provider.getKey(provider.getChildren()[0])).toBe(Uri.file("/repo/a.ts").toString());
    });
});

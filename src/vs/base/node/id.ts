import { createHash, randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";

export type NetworkInterfaces = () => NodeJS.Dict<readonly { readonly mac: string }[]>;

/** Заглушки вместо адреса: нулевой, широковещательный и общий адрес Touch Bar у Mac (`macAddress.ts` эталона). */
const INVALID_MAC_ADDRESSES = new Set(["00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "ac:de:48:00:11:22"]);

export function getMac(interfaces: NetworkInterfaces = networkInterfaces): string | undefined {
    for (const entries of Object.values(interfaces())) {
        for (const { mac } of entries ?? []) {
            if (!INVALID_MAC_ADDRESSES.has(mac.replace(/-/g, ":").toLowerCase())) return mac;
        }
    }
    return undefined;
}

/** Стабильность между запусками даёт вызывающий: без MAC значение случайно, его кладут в состояние. */
export function getMachineId(interfaces: NetworkInterfaces = networkInterfaces): string {
    const mac = getMac(interfaces);
    // Stryker disable next-line StringLiteral: эквивалентный — пустая кодировка у `Hash.update` и есть utf8 по умолчанию
    return mac === undefined ? randomUUID() : createHash("sha256").update(mac, "utf8").digest("hex");
}

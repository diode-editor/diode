import { createHash, randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";

export type NetworkInterfaces = () => NodeJS.Dict<readonly { readonly mac: string }[]>;

/** Placeholder addresses: zero, broadcast and the shared Mac Touch Bar address (upstream's `macAddress.ts`). */
const INVALID_MAC_ADDRESSES = new Set(["00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "ac:de:48:00:11:22"]);

export function getMac(interfaces: NetworkInterfaces = networkInterfaces): string | undefined {
    for (const entries of Object.values(interfaces())) {
        for (const { mac } of entries ?? []) {
            if (!INVALID_MAC_ADDRESSES.has(mac.replace(/-/g, ":").toLowerCase())) return mac;
        }
    }
    return undefined;
}

/** Stability across runs is up to the caller: without a MAC the value is random, and the caller persists it in state. */
export function getMachineId(interfaces: NetworkInterfaces = networkInterfaces): string {
    const mac = getMac(interfaces);
    // Stryker disable next-line StringLiteral: equivalent, an empty encoding in `Hash.update` is the default utf8
    return mac === undefined ? randomUUID() : createHash("sha256").update(mac, "utf8").digest("hex");
}

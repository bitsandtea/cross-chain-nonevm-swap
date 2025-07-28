import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { getWhitelistConfig } from "../../config/whitelist";
import { IntentDB } from "./types";

const adapter = new JSONFile<IntentDB>("db/intents.json");
export const db = new Low(adapter, {
  intents: [],
  whitelist: [],
  nonces: {},
});

export async function initializeDatabase() {
  await db.read();

  // Initialize with default data if empty
  if (!db.data) {
    db.data = {
      intents: [],
      whitelist: [],
      nonces: {},
    };
  }

  await db.write();
}

export function isTokenWhitelisted(
  tokenAddress: string,
  chainId: number
): boolean {
  const chainName = chainId === 1 ? "ethereum" : "aptos";
  const whitelist = getWhitelistConfig();
  const tokens = (whitelist.tokens as any)[chainName] || [];
  return tokens.includes(tokenAddress);
}

export function getUserNonce(userAddress: string): number {
  return db.data!.nonces[userAddress.toLowerCase()] || 0;
}

export function incrementUserNonce(userAddress: string): void {
  const current = getUserNonce(userAddress);
  db.data!.nonces[userAddress.toLowerCase()] = current + 1;
}

export async function saveDatabase() {
  await db.write();
}

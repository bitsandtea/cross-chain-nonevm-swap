import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { getWhitelistConfig } from "../../config/whitelist";
import { IntentDB } from "./types";

const adapter = new JSONFile<IntentDB>("db/intents.json");
export const db = new Low(adapter, {
  intents: [],
  whitelist: [],
  nonces: {},
  secrets: [],
});

export async function initializeDatabase() {
  try {
    await db.read();

    // Log successful database load with nonce count
    const nonceCount = db.data?.nonces ? Object.keys(db.data.nonces).length : 0;
    const intentCount = db.data?.intents?.length || 0;
    console.log(
      `📊 Database loaded: ${intentCount} intents, ${nonceCount} user nonces`
    );
  } catch (error) {
    // Handle empty or corrupted database file
    console.warn(
      "Database read failed during initialization, creating new database:",
      error
    );
    db.data = {
      intents: [],
      whitelist: [],
      nonces: {},
      secrets: [],
    };
    await db.write();
    console.log("📊 New database created");
    return;
  }

  // Initialize with default data if empty
  if (!db.data) {
    db.data = {
      intents: [],
      whitelist: [],
      nonces: {},
      secrets: [],
    };
    await db.write();
    console.log("📊 Database initialized with default data");
  }

  // Ensure secrets array exists for existing databases
  if (!db.data.secrets) {
    db.data.secrets = [];
    await db.write();
  }
}

export function isTokenWhitelisted(
  tokenAddress: string,
  chainId: number
): boolean {
  const chainName = chainId === 1 ? "ethereum" : "aptos";
  const whitelist = getWhitelistConfig();
  const tokens =
    (whitelist.tokens as Record<string, string[]>)[chainName] || [];
  return tokens.includes(tokenAddress);
}

export function isResolverWhitelisted(resolverAddress: string): boolean {
  const whitelist = getWhitelistConfig();
  return whitelist.resolvers.includes(resolverAddress.toLowerCase());
}

export function getUserNonce(userAddress: string): number {
  if (!db.data?.nonces) {
    console.warn("⚠️ Database not initialized, returning nonce 0");
    return 0;
  }
  const nonce = db.data.nonces[userAddress.toLowerCase()] || 0;
  console.log(
    `🔢 User ${userAddress.slice(0, 6)}...${userAddress.slice(
      -4
    )} current nonce: ${nonce}`
  );
  return nonce;
}

export function incrementUserNonce(userAddress: string): void {
  if (!db.data?.nonces) {
    console.error("❌ Cannot increment nonce: database not initialized");
    return;
  }
  const current = getUserNonce(userAddress);
  const newNonce = current + 1;
  db.data.nonces[userAddress.toLowerCase()] = newNonce;
  console.log(
    `🔢 User ${userAddress.slice(0, 6)}...${userAddress.slice(
      -4
    )} nonce incremented to: ${newNonce}`
  );
}

export async function saveDatabase() {
  await db.write();
}

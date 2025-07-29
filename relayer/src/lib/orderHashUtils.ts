import { Serializer } from "@aptos-labs/ts-sdk";
import { createHash } from "crypto";

export interface OrderParams {
  maker: string;
  taker: string;
  tokenType: string;
  amount: bigint;
  hashlock: Uint8Array;
  timelocks: bigint[];
  isSrc: boolean;
}

/**
 * Computes order hash using the same BCS layout as the Move implementation
 * This must match the order_hash computation in aptos/sources/escrow.move
 */
export function computeOrderHash(params: OrderParams): Uint8Array {
  const serializer = new Serializer();

  // Serialize each field in the exact order used in Move using BCS encoding
  serializer.serializeBytes(hexToUint8Array(params.maker)); // maker address as BCS bytes
  serializer.serializeBytes(hexToUint8Array(params.taker)); // taker address as BCS bytes

  // Token type needs to be serialized as TypeInfo struct - for now use string but this needs proper TypeInfo encoding
  serializer.serializeBytes(new TextEncoder().encode(params.tokenType)); // token_type as bytes

  serializer.serializeU64(params.amount); // amount

  serializer.serializeBytes(params.hashlock); // hashlock as bytes

  // Serialize timelocks vector using proper BCS vector encoding
  serializer.serializeU32AsUleb128(params.timelocks.length);
  for (const timelock of params.timelocks) {
    serializer.serializeU64(timelock);
  }

  serializer.serializeBool(params.isSrc); // is_src

  // Get the serialized bytes
  const orderHashData = serializer.toUint8Array();

  // Use SHA3-256 to match Move's hash::sha3_256
  return new Uint8Array(createHash("sha3-256").update(orderHashData).digest());
}

/**
 * Computes deterministic vault address from order hash
 * This should match the resource account creation in Move
 */
export function computeVaultAddress(
  creator: string,
  orderHash: Uint8Array
): string {
  // This is a simplified version - actual implementation would need to match
  // Aptos's create_resource_account logic exactly
  const combined = new Uint8Array(creator.length + orderHash.length);
  combined.set(new TextEncoder().encode(creator), 0);
  combined.set(orderHash, creator.length);

  const hash = createHash("sha256").update(combined).digest();
  return "0x" + hash.toString("hex").slice(0, 64);
}

/**
 * Helper to convert hex string to Uint8Array for hashlock
 */
export function hexToUint8Array(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Helper to convert Uint8Array to hex string
 */
export function uint8ArrayToHex(bytes: Uint8Array): string {
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Comprehensive error decoder for 1inch Limit Order Protocol and other contract errors
 */

import { ethers } from "ethers";
import { FACTORY_ABI, LOP_ABI, RESOLVER_ABI } from "../abis";

interface DecodedError {
  contractType: string;
  errorName: string;
  args: any[];
  signature: string;
  rawData: string;
  description?: string;
}

/**
 * Known error descriptions for better debugging
 */
const ERROR_DESCRIPTIONS: Record<string, string> = {
  // LOP errors
  TransferFromMakerToTakerFailed:
    "Token transfer from maker to taker failed - check maker balance and allowances",
  TransferFromTakerToMakerFailed:
    "Token transfer from taker to maker failed - check taker balance and allowances",
  BadSignature:
    "Invalid EIP-712 signature - check signature generation and chain ID",
  TakingAmountExceeded:
    "Taking amount exceeds order limit - reduce fill amount",
  MakingAmountTooLow:
    "Making amount below minimum threshold - increase fill amount",
  PrivateOrder: "Order is private and taker address doesn't match",
  OrderExpired: "Order has expired - check deadline timestamp",
  InvalidatedOrder: "Order has been invalidated/cancelled",
  OrderIsNotSuitableForMassInvalidation:
    "Order cannot be mass invalidated - use individual cancellation",
  PartialFillNotAllowed:
    "Order doesn't allow partial fills - must fill entire amount",
  SwapWithZeroAmount: "Cannot swap with zero amount",
  TakingAmountTooHigh: "Taking amount exceeds maximum allowed",
  WrongSeriesNonce: "Nonce series mismatch - check order nonce",
  PredicateIsNotTrue: "Order predicate condition not met",
  ReentrancyDetected: "Reentrancy attack detected",
  MismatchArraysLengths: "Array length mismatch in function parameters",
  InvalidPermit2Transfer: "Permit2 transfer validation failed",
  EpochManagerAndBitInvalidatorsAreIncompatible:
    "Cannot use both epoch manager and bit invalidators",
  BitInvalidatedOrder: "Order invalidated via bit invalidator",
  RemainingInvalidatedOrder: "Order has no remaining amount to fill",

  // Resolver errors
  OwnableUnauthorizedAccount: "Caller is not the contract owner",
  NativeTokenSendingFailure:
    "Failed to send native ETH - check recipient and amount",
  LengthMismatch: "Array length mismatch in function parameters",
  InvalidLength: "Invalid parameter length",

  // Generic errors
  InsufficientBalance: "Insufficient token balance",
  SafeTransferFailed: "Safe transfer failed - token transfer rejected",
  SafeTransferFromFailed: "Safe transferFrom failed - check allowances",
  ETHTransferFailed: "Native ETH transfer failed",
  ZeroAddress: "Cannot use zero address",
  InvalidMsgValue: "Incorrect ETH value sent with transaction",
};

/**
 * Contract interface registry for error decoding
 */
const CONTRACT_INTERFACES = {
  LOP: new ethers.Interface(LOP_ABI),
  RESOLVER: new ethers.Interface(RESOLVER_ABI),
  FACTORY: new ethers.Interface(FACTORY_ABI),
};

/**
 * Decodes error data from transaction revert
 * @param errorData - Raw error data from transaction revert
 * @param contractHint - Optional hint about which contract type to try first
 * @returns Decoded error information or null if cannot decode
 */
export function decodeError(
  errorData: string,
  contractHint?: string
): DecodedError | null {
  if (!errorData || errorData === "0x") {
    return null;
  }

  // Try to decode with each contract interface
  const interfacesToTry = contractHint
    ? [
        contractHint.toUpperCase(),
        ...Object.keys(CONTRACT_INTERFACES).filter(
          (k) => k !== contractHint.toUpperCase()
        ),
      ]
    : Object.keys(CONTRACT_INTERFACES);

  for (const contractType of interfacesToTry) {
    const iface =
      CONTRACT_INTERFACES[contractType as keyof typeof CONTRACT_INTERFACES];
    if (!iface) continue;

    try {
      const decoded = iface.parseError(errorData);
      if (decoded) {
        return {
          contractType,
          errorName: decoded.name,
          args: decoded.args,
          signature: decoded.signature,
          rawData: errorData,
          description: ERROR_DESCRIPTIONS[decoded.name],
        };
      }
    } catch (error) {
      // Continue to next interface if this one fails
      continue;
    }
  }

  // If no interface could decode it, try to extract selector and provide basic info
  if (errorData.length >= 10) {
    const selector = errorData.slice(0, 10);
    return {
      contractType: "UNKNOWN",
      errorName: "UnknownError",
      args: [],
      signature: "UnknownError()",
      rawData: errorData,
      description: `Unknown error with selector ${selector}`,
    };
  }

  return null;
}

/**
 * Formats decoded error for logging
 * @param decoded - Decoded error information
 * @returns Formatted error string
 */
export function formatError(decoded: DecodedError): string {
  let result = `🚨 ${decoded.contractType} Error: ${decoded.errorName}`;

  if (decoded.args && decoded.args.length > 0) {
    result += `\n   Args: ${decoded.args
      .map((arg, i) => `[${i}] ${arg}`)
      .join(", ")}`;
  }

  if (decoded.description) {
    result += `\n   💡 ${decoded.description}`;
  }

  result += `\n   Signature: ${decoded.signature}`;
  result += `\n   Raw Data: ${decoded.rawData}`;

  return result;
}

/**
 * Comprehensive error analysis for common LOP issues
 * @param decoded - Decoded error information
 * @returns Detailed analysis and suggested fixes
 */
export function analyzeError(decoded: DecodedError): string[] {
  const suggestions: string[] = [];

  switch (decoded.errorName) {
    case "TransferFromMakerToTakerFailed":
      suggestions.push(
        "• Check maker has sufficient token balance",
        "• Verify maker approved LOP contract for the token",
        "• Ensure token contract exists and is not paused",
        "• Check if token has transfer restrictions"
      );
      break;

    case "BadSignature":
      suggestions.push(
        "• Verify EIP-712 signature was generated correctly",
        "• Check chainId matches the network you're on",
        "• Ensure order data hasn't been modified after signing",
        "• Verify signer address matches order maker"
      );
      break;

    case "TakingAmountExceeded":
      suggestions.push(
        "• Reduce the fill amount",
        "• Check order's takingAmount limit",
        "• Verify order hasn't been partially filled already"
      );
      break;

    case "PrivateOrder":
      suggestions.push(
        "• Check if order.receiver matches the taker address",
        "• Verify taker address in immutables matches computed escrow address",
        "• Ensure order allows public filling if intended"
      );
      break;

    case "OrderExpired":
      suggestions.push(
        "• Check order deadline timestamp",
        "• Verify current block.timestamp hasn't exceeded deadline",
        "• Generate a new order with future deadline"
      );
      break;

    case "OwnableUnauthorizedAccount":
      if (decoded.args && decoded.args[0]) {
        suggestions.push(
          `• Current caller: ${decoded.args[0]}`,
          "• Check if caller is the contract owner",
          "• Transfer ownership if needed or use correct signer"
        );
      } else {
        suggestions.push(
          "• Check if caller is the contract owner",
          "• Verify you're using the correct wallet/signer"
        );
      }
      break;

    case "NativeTokenSendingFailure":
      suggestions.push(
        "• Check recipient address can receive ETH",
        "• Verify sufficient ETH balance for transfer",
        "• Ensure recipient is not a contract that rejects ETH"
      );
      break;

    default:
      if (decoded.description) {
        suggestions.push(`• ${decoded.description}`);
      }
      break;
  }

  return suggestions;
}

/**
 * Main error handling function that provides comprehensive error information
 * @param error - Error object from transaction
 * @param contractHint - Optional hint about which contract type
 * @returns Formatted error analysis
 */
export function handleTransactionError(
  error: any,
  contractHint?: string
): string {
  let errorData: string | null = null;

  // Extract error data from various error formats
  if (error.data) {
    errorData = typeof error.data === "string" ? error.data : error.data.data;
  } else if (error.reason && error.reason.includes("0x")) {
    // Sometimes error data is embedded in reason string
    const match = error.reason.match(/0x[0-9a-fA-F]+/);
    if (match) errorData = match[0];
  }

  if (!errorData) {
    return `❌ Transaction failed: ${
      error.message || error.reason || "Unknown error"
    }`;
  }

  const decoded = decodeError(errorData, contractHint);
  if (!decoded) {
    return `❌ Transaction failed with unknown error: ${errorData}`;
  }

  let result = formatError(decoded);

  const suggestions = analyzeError(decoded);
  if (suggestions.length > 0) {
    result += "\n\n🔧 Suggested fixes:";
    suggestions.forEach((suggestion) => {
      result += `\n${suggestion}`;
    });
  }

  return result;
}

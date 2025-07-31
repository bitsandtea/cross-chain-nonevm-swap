import { db, initializeDatabase, saveDatabase } from "@/lib/database";
import { FusionPlusIntent, FusionPlusIntentRequest } from "@/lib/types";
import {
  validateAptosBalance,
  validateEVMBalance,
  validateFusionPlusOrder,
  validateNonce,
  verifyFusionOrderSignature,
} from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  APTOS_RPC_URL,
  CHAIN_ID,
  ETH_FACTORY_ADDRESS,
} from "../../../../config/env";

// Initialize database
initializeDatabase();

// Handle new CrossChainOrder format
async function handleCrossChainOrder(body: {
  order: any;
  extension: any;
  signature: string;
  hash: string;
}) {
  try {
    // For new format, we only accept hash (not secret)
    // The hash should be the secretHash that was used in the order
    if (
      !body.hash ||
      body.hash ===
        "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      return NextResponse.json(
        { error: "Hash is required for cross-chain orders" },
        { status: 400 }
      );
    }

    // Calculate orderHash from the order (using EIP-712 hash or salt)
    const orderHash = body.order.salt || `0x${Date.now()}`; // Use salt or generate one

    // Create intent from CrossChainOrder (store as separate format)
    const intent: FusionPlusIntent = {
      id: uuidv4(),
      orderHash: orderHash,
      // Don't convert to FusionPlusOrder - store CrossChainOrder separately
      fusionOrder: {
        // Minimal FusionPlusOrder for compatibility - only required fields
        maker: body.order.maker,
        makerAsset: body.order.makerAsset,
        takerAsset: body.order.takerAsset,
        makingAmount: body.order.makingAmount,
        takingAmount: body.order.takingAmount,
        // Required FusionPlusOrder fields with defaults
        srcChain: 1, // Default to Ethereum
        dstChain: 56, // Default to Ethereum (LOP supported)
        auctionStartTime: Math.floor(Date.now() / 1000),
        auctionDuration: 3600,
        startRate: "0",
        endRate: "0",
        secretHash: body.hash,
        srcEscrowTarget: body.order.maker,
        dstEscrowTarget: body.order.receiver || body.order.maker,
        srcSafetyDeposit: "100000000000000000",
        dstSafetyDeposit: "100000000000000000",
        srcTimelock: 3600,
        dstTimelock: 1800,
        finalityLock: 300,
        fillThresholds: [25, 50, 75, 100],
        salt: body.order.salt || `0x${Date.now()}`,
        expiration: Math.floor(Date.now() / 1000) + 86400,
      },
      signature: body.signature,
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resolverClaims: [],
      nonce: Date.now(),
      hash: body.hash,
      sdkOrder: body.order, // Store the full SDK order
      extension: body.extension, // Store the extension
    };

    // Store in database
    if (!db.data) {
      db.data = {
        intents: [],
        whitelist: [],
        secrets: [],
        nonces: {},
      };
    }

    db.data.intents.push(intent);
    await saveDatabase();

    return NextResponse.json({
      success: true,
      intentId: intent.id,
      orderHash: orderHash,
    });
  } catch (error) {
    console.error("Error handling CrossChainOrder:", error);
    return NextResponse.json(
      { error: "Failed to process CrossChainOrder" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Check if this is the new CrossChainOrder format or legacy FusionPlus format
    const isNewFormat =
      body.order && body.extension && body.signature && body.hash;
    const isLegacyFormat =
      body.fusionOrder &&
      body.signature &&
      body.nonce !== undefined &&
      body.secret;

    if (!isNewFormat && !isLegacyFormat) {
      return NextResponse.json(
        {
          error:
            "Invalid payload format. Expected either new format (order, extension, signature, hash) or legacy format (fusionOrder, signature, nonce, secret)",
        },
        { status: 400 }
      );
    }

    // Handle new CrossChainOrder format
    if (isNewFormat) {
      return await handleCrossChainOrder(body);
    }

    // Handle legacy FusionPlus format (for backward compatibility)
    const legacyBody: FusionPlusIntentRequest = body;

    // Validate request structure for legacy format
    if (
      !legacyBody.fusionOrder ||
      !legacyBody.signature ||
      legacyBody.nonce === undefined ||
      !legacyBody.secret
    ) {
      return NextResponse.json(
        { error: "Missing fusionOrder, signature, nonce, or secret" },
        { status: 400 }
      );
    }

    // Validate Fusion+ order
    const validation = validateFusionPlusOrder(legacyBody.fusionOrder);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Validate that secret matches secretHash
    const { HashLock } = require("@1inch/cross-chain-sdk");
    const computedHash = HashLock.hashSecret(legacyBody.secret);
    console.log(
      `🔐 Secret validation: provided hash=${legacyBody.fusionOrder.secretHash}, computed hash=${computedHash}`
    );
    if (computedHash !== legacyBody.fusionOrder.secretHash) {
      return NextResponse.json(
        { error: "Secret does not match secretHash" },
        { status: 400 }
      );
    }

    // Verify signature and get user address
    const chainId = parseInt(CHAIN_ID);
    console.log("Using chainId for signature verification:", chainId);
    const userAddress = await verifyFusionOrderSignature(
      legacyBody.fusionOrder,
      legacyBody.nonce,
      legacyBody.signature,
      chainId
    );

    // Verify maker address matches signature
    if (
      userAddress.toLowerCase() !== legacyBody.fusionOrder.maker.toLowerCase()
    ) {
      return NextResponse.json(
        { error: "Signature does not match maker address" },
        { status: 400 }
      );
    }

    // Validate nonce - accept any valid nonce from frontend
    if (!validateNonce(userAddress, legacyBody.nonce)) {
      return NextResponse.json(
        {
          error: "Invalid nonce - must be a positive number",
        },
        { status: 400 }
      );
    }

    // Validate balance and allowance
    let balanceValid = false;
    if (legacyBody.fusionOrder.srcChain === 1) {
      // Ethereum
      balanceValid = await validateEVMBalance(
        userAddress,
        legacyBody.fusionOrder.makerAsset,
        legacyBody.fusionOrder.makingAmount,
        ETH_FACTORY_ADDRESS
      );
    } else {
      // Aptos
      balanceValid = await validateAptosBalance(
        userAddress,
        legacyBody.fusionOrder.makerAsset,
        legacyBody.fusionOrder.makingAmount,
        APTOS_RPC_URL
      );
    }

    if (!balanceValid) {
      return NextResponse.json(
        { error: "Insufficient balance or allowance" },
        { status: 400 }
      );
    }

    // Calculate orderHash for the legacy order
    const orderHash = legacyBody.fusionOrder.salt || `0x${Date.now()}`;

    // Create Fusion+ intent
    const intent: FusionPlusIntent = {
      id: uuidv4(),
      orderHash: orderHash,
      fusionOrder: legacyBody.fusionOrder,
      signature: legacyBody.signature,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      resolverClaims: [],
      nonce: legacyBody.nonce,
      // Per spec G-2: Store only hash, NOT the secret
      secretHash: legacyBody.fusionOrder.secretHash,
      // Note: secret is validated but NOT stored for security
    };

    // Save to database
    db.data!.intents.push(intent);
    await saveDatabase();

    // Dutch auction is handled on-chain by LOP contract after deploySrc
    if (intent.fusionOrder.startRate !== "0") {
      console.log(
        `🎯 Dutch auction Fusion+ order ${intent.id} created - auction will start on-chain after deploySrc`
      );
    }

    return NextResponse.json({
      success: true,
      orderHash: intent.orderHash, // Return orderHash for consistency
      intentId: intent.id, // Keep intentId for backward compatibility
    });
  } catch (error) {
    console.error("Fusion+ order creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const chainIn = searchParams.get("chainIn");
    const chainOut = searchParams.get("chainOut");
    const user = searchParams.get("user");

    try {
      await db.read();
    } catch (error) {
      // Handle empty or corrupted database file
      console.warn("Database read failed, initializing with defaults:", error);
      db.data = {
        intents: [],
        whitelist: [],
        secrets: [],
        nonces: {},
      };
      await db.write();
    }

    let intents = db.data!.intents;

    // Apply filters
    if (status) {
      intents = intents.filter((intent) => intent.status === status);
    }

    if (chainIn) {
      const chainInNum = parseInt(chainIn);
      intents = intents.filter(
        (intent) => intent.fusionOrder.srcChain === chainInNum
      );
    }

    if (chainOut) {
      const chainOutNum = parseInt(chainOut);
      intents = intents.filter(
        (intent) => intent.fusionOrder.dstChain === chainOutNum
      );
    }

    if (user) {
      intents = intents.filter(
        (intent) =>
          intent.fusionOrder.maker.toLowerCase() === user.toLowerCase()
      );
    }

    // Sort by creation time (newest first)
    intents.sort((a, b) => {
      const aTime =
        typeof a.createdAt === "string"
          ? new Date(a.createdAt).getTime()
          : a.createdAt;
      const bTime =
        typeof b.createdAt === "string"
          ? new Date(b.createdAt).getTime()
          : b.createdAt;
      return bTime - aTime;
    });

    return NextResponse.json({
      intents,
      meta: {
        total: intents.length,
        format: "fusion-plus",
      },
    });
  } catch (error) {
    console.error("Intent retrieval error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

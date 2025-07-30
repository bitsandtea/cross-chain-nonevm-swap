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

// Initialize database
initializeDatabase();

export async function POST(req: NextRequest) {
  try {
    const body: FusionPlusIntentRequest = await req.json();

    // Validate request structure
    if (
      !body.fusionOrder ||
      !body.signature ||
      body.nonce === undefined ||
      !body.secret
    ) {
      return NextResponse.json(
        { error: "Missing fusionOrder, signature, nonce, or secret" },
        { status: 400 }
      );
    }

    // Validate Fusion+ order
    const validation = validateFusionPlusOrder(body.fusionOrder);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Validate that secret matches secretHash
    const { HashLock } = require("@1inch/cross-chain-sdk");
    const computedHash = HashLock.hashSecret(body.secret);
    console.log(
      `🔐 Secret validation: provided hash=${body.fusionOrder.secretHash}, computed hash=${computedHash}`
    );
    if (computedHash !== body.fusionOrder.secretHash) {
      return NextResponse.json(
        { error: "Secret does not match secretHash" },
        { status: 400 }
      );
    }

    // Verify signature and get user address
    const chainId = parseInt(process.env.CHAIN_ID || "31337");
    console.log("Using chainId for signature verification:", chainId);
    const userAddress = await verifyFusionOrderSignature(
      body.fusionOrder,
      body.nonce,
      body.signature,
      chainId
    );

    // Verify maker address matches signature
    if (userAddress.toLowerCase() !== body.fusionOrder.maker.toLowerCase()) {
      return NextResponse.json(
        { error: "Signature does not match maker address" },
        { status: 400 }
      );
    }

    // Validate nonce - accept any valid nonce from frontend
    if (!validateNonce(userAddress, body.nonce)) {
      return NextResponse.json(
        {
          error: "Invalid nonce - must be a positive number",
        },
        { status: 400 }
      );
    }

    // Validate balance and allowance
    let balanceValid = false;
    if (body.fusionOrder.srcChain === 1) {
      // Ethereum
      balanceValid = await validateEVMBalance(
        userAddress,
        body.fusionOrder.makerAsset,
        body.fusionOrder.makingAmount,
        process.env.NEXT_PUBLIC_ETH_FACTORY_ADDRESS || ""
      );
    } else {
      // Aptos
      balanceValid = await validateAptosBalance(
        userAddress,
        body.fusionOrder.makerAsset,
        body.fusionOrder.makingAmount
      );
    }

    if (!balanceValid) {
      return NextResponse.json(
        { error: "Insufficient balance or allowance" },
        { status: 400 }
      );
    }

    // Create Fusion+ intent
    const intent: FusionPlusIntent = {
      id: uuidv4(),
      fusionOrder: body.fusionOrder,
      signature: body.signature,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      resolverClaims: [],
      nonce: body.nonce,
      // Store secret securely - it will be revealed when both escrows are ready
      secret: body.secret,
      secretHash: body.fusionOrder.secretHash,
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
      intentId: intent.id,
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
    intents.sort((a, b) => b.createdAt - a.createdAt);

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

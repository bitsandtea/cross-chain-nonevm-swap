import {
  db,
  incrementUserNonce,
  initializeDatabase,
  saveDatabase,
} from "@/lib/database";
import { Intent, IntentRequest } from "@/lib/types";
import {
  validateAptosBalance,
  validateEVMBalance,
  validateIntentData,
  validateNonce,
  verifyIntentSignature,
} from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

// Initialize database
initializeDatabase();

export async function POST(req: NextRequest) {
  try {
    const body: IntentRequest = await req.json();

    // Validate request structure
    if (!body.intent || !body.signature) {
      return NextResponse.json(
        { error: "Missing intent or signature" },
        { status: 400 }
      );
    }

    // Validate intent data
    const validation = validateIntentData(body.intent);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Verify signature and get user address
    const chainId = parseInt(process.env.CHAIN_ID || "31337"); // Default to hardhat localhost
    console.log("Using chainId for signature verification:", chainId);
    const userAddress = await verifyIntentSignature(
      body.intent,
      body.signature,
      chainId
    );

    // Validate nonce
    if (!validateNonce(userAddress, body.intent.nonce)) {
      return NextResponse.json({ error: "Invalid nonce" }, { status: 400 });
    }

    // Validate balance and allowance
    let balanceValid = false;
    if (body.intent.chainIn === 1) {
      // Ethereum
      balanceValid = await validateEVMBalance(
        userAddress,
        body.intent.sellToken,
        body.intent.amountIn,
        process.env.NEXT_PUBLIC_ETH_FACTORY_ADDRESS || ""
      );
    } else {
      // Aptos
      balanceValid = await validateAptosBalance(
        userAddress,
        body.intent.sellToken,
        body.intent.amountIn
      );
    }

    if (!balanceValid) {
      return NextResponse.json(
        { error: "Insufficient balance or allowance" },
        { status: 400 }
      );
    }

    // Create intent
    const intent: Intent = {
      id: uuidv4(),
      userAddress,
      ...body.intent,
      signature: body.signature,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Save to database
    db.data!.intents.push(intent);
    incrementUserNonce(userAddress);
    await saveDatabase();

    return NextResponse.json({ success: true, intentId: intent.id });
  } catch (error) {
    console.error("Intent creation error:", error);
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

    await db.read();
    let intents = db.data!.intents;

    // Apply filters
    if (status) {
      intents = intents.filter((intent) => intent.status === status);
    }

    if (chainIn) {
      intents = intents.filter(
        (intent) => intent.chainIn === parseInt(chainIn)
      );
    }

    if (chainOut) {
      intents = intents.filter(
        (intent) => intent.chainOut === parseInt(chainOut)
      );
    }

    if (user) {
      intents = intents.filter(
        (intent) => intent.userAddress.toLowerCase() === user.toLowerCase()
      );
    }

    // Sort by creation time (newest first)
    intents.sort((a, b) => b.createdAt - a.createdAt);

    return NextResponse.json({ intents });
  } catch (error) {
    console.error("Intent retrieval error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { db, initializeDatabase, saveDatabase } from "@/lib/database";
import { FusionPlusIntent } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

// Initialize database
initializeDatabase();

/*
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
  */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    /*
      order: {
    maker: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    makerAsset: '0xf0014cbe67b3ab638bdaa2e2cb1b531935829e50',
    takerAsset: '0xda0000d4000015a526378bb6fafc650cea5966f8',
    makerTraits: '33471150795161712739625987854704219449736943044941433056043525232457238446080',
    salt: '323889556686748963939587308947877716729674401837101',
    makingAmount: '1000000',
    takingAmount: '1000000',
    receiver: '0x0000000000000000000000000000000000000000'
  },
  extension: {
    makerAssetSuffix: '0x',
    takerAssetSuffix: '0x',
    makingAmountData: '0xdb88cfc18875e3ed6797de31dfaae31f942231f200000000000000688d203e00012c000000',
    takingAmountData: '0xdb88cfc18875e3ed6797de31dfaae31f942231f200000000000000688d203e00012c000000',
    predicate: '0x',
    makerPermit: '0x',
    preInteraction: '0x',
    postInteraction: '0xdb88cfc18875e3ed6797de31dfaae31f942231f20000000035b0a1a7be3bdab98e000000087443942c2e21ce558562a6f3a8826d1570f5b6fb403669af7664e8d27eeb2fab000000000000000000000000000000000000000000000000000000000000003800000000000000000000000000000000000000000000000000000000000000000000000000000000002386f26fc100000000000000000000002386f26fc100000000000000000065000000640000000a0000007a00000079000000780000000a',
    customData: '0x'
  },
  signature: '0x88af0e2244f4d3fb69734edbbb9aaf04e8c36337df20f821d9fb428caf946b506a2ab07b70cedf9f88e9f3cd6567ad9a5e8270a7de5a691fc4e273c9559a00a91b',
  hash: '0xec536170adc9a43efde6c13e4ad0f274eeae745ce508c0d8beb76a3017f5b770'
}
  */
    console.log("Post hit with body: ", body);
    if (!body.order || !body.signature || !body.hash) {
      return NextResponse.json(
        { error: "Missing order, signature, nonce, or hash" },
        { status: 400 }
      );
    }

    // Extract additional escrow fields from request body
    const auctionStartTime =
      body.auctionStartTime || Math.floor(Date.now() / 1000);
    const auctionDuration = body.auctionDuration || 3600;
    const startRate = body.startRate || "1.0";
    const endRate = body.endRate || "1.0";
    const finalityLock = body.finalityLock || 300;
    const fillThresholds = body.fillThresholds || [25, 50, 75, 100];
    const expiration = body.expiration || Math.floor(Date.now() / 1000) + 86400;

    // Extract chain IDs from request body or use defaults
    const srcChain = body.srcChain || 1; // Default to Ethereum
    const dstChain = body.dstChain || 1000; // Default to Aptos

    // Extract timelock data from request body or use defaults
    const srcTimelock = body.srcTimelock || 120;
    const dstTimelock = body.dstTimelock || 100;
    const srcWithdrawal = body.srcWithdrawal || 10;
    const srcPublicWithdrawal = body.srcPublicWithdrawal || 120;
    const srcCancellation = body.srcCancellation || 121;
    const srcPublicCancellation = body.srcPublicCancellation || 122;
    const dstWithdrawal = body.dstWithdrawal || 10;
    const dstPublicWithdrawal = body.dstPublicWithdrawal || 100;
    const dstCancellation = body.dstCancellation || 101;
    const srcSafetyDeposit = body.srcSafetyDeposit || "10000000000000000"; // 0.01 ETH default
    const dstSafetyDeposit = body.dstSafetyDeposit || "10000000000000000"; // 0.01 ETH default

    // Extract escrow targets from request body or use defaults
    const srcEscrowTarget = body.srcEscrowTarget || body.order.maker;
    const dstEscrowTarget = body.dstEscrowTarget || body.order.maker;

    // Verify signature and get user address
    // const userAddress = await verifyFusionOrderSignature(
    //   body.order,
    //   body.signature
    // );

    // // Verify maker address matches signature
    // if (userAddress.toLowerCase() !== body.order.maker.toLowerCase()) {
    //   return NextResponse.json(
    //     { error: "Signature does not match maker address" },
    //     { status: 400 }
    //   );
    // }

    /*
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
*/
    // Create Fusion+ intent
    const intent: FusionPlusIntent = {
      id: uuidv4(),
      orderHash: body.hash,
      order: body.order,
      signature: body.signature,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      resolverClaims: [],
      secretHash: body.hash,
      // Add chain IDs
      srcChain,
      dstChain,
      // Add escrow fields to intent
      auctionStartTime,
      auctionDuration,
      startRate,
      endRate,
      finalityLock,
      fillThresholds,
      expiration,
      // Add timelock fields
      srcTimelock,
      dstTimelock,
      srcWithdrawal,
      srcPublicWithdrawal,
      srcCancellation,
      srcPublicCancellation,
      dstWithdrawal,
      dstPublicWithdrawal,
      dstCancellation,
      srcSafetyDeposit,
      dstSafetyDeposit,
      // Add escrow targets
      srcEscrowTarget,
      dstEscrowTarget,
    };

    // Save to database
    db.data!.intents.push(intent);
    await saveDatabase();

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
        (intent) => intent.order.srcChain === chainInNum
      );
    }

    if (chainOut) {
      const chainOutNum = parseInt(chainOut);
      intents = intents.filter(
        (intent) => intent.order.dstChain === chainOutNum
      );
    }

    if (user) {
      intents = intents.filter(
        (intent) => intent.order.maker.toLowerCase() === user.toLowerCase()
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

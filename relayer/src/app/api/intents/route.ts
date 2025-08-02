import { db, initializeDatabase, saveDatabase } from "@/lib/database";
import { FusionPlusIntent } from "@/lib/types";
import { validateFusionPlusOrder } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

// Initialize database
initializeDatabase();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

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

    // Extract chain IDs from request body - don't use hardcoded defaults
    const srcChain = body.srcChain; // Use actual source chain from request
    const rawDstChain = body.dstChain || 1000; // Default to Aptos
    const dstChain = rawDstChain === 1000 ? 56 : rawDstChain; // Use 56 for Aptos as SDK doesn't support it
    const signedChainId = body.signedChainId || srcChain; // Store the chain ID used for signing

    // Validate that we have the source chain
    if (!srcChain) {
      return NextResponse.json(
        { error: "Source chain ID is required" },
        { status: 400 }
      );
    }

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

    // Get the original salt from sdkOrderEncoded (not the padded one from order)
    let originalSalt = body.order.salt;
    if (body.sdkOrderEncoded) {
      try {
        const encodedOrder = JSON.parse(body.sdkOrderEncoded);
        originalSalt = encodedOrder.orderInfo.salt;
      } catch (error) {
        console.warn("Failed to parse sdkOrderEncoded for salt:", error);
      }
    }

    // Validate the reconstructed FusionPlusOrder
    const fusionOrderToValidate = {
      makerAsset: body.order.makerAsset,
      takerAsset: body.order.takerAsset,
      makingAmount: body.order.makingAmount,
      takingAmount: body.order.takingAmount,
      maker: body.order.maker,
      srcChain: srcChain,
      dstChain: dstChain,
      auctionStartTime: auctionStartTime,
      auctionDuration: auctionDuration,
      startRate: startRate,
      endRate: endRate,
      secretHash: body.hash,
      srcEscrowTarget: srcEscrowTarget,
      dstEscrowTarget: dstEscrowTarget,
      srcTimelock: srcTimelock,
      dstTimelock: dstTimelock,
      finalityLock: finalityLock,
      srcSafetyDeposit: srcSafetyDeposit,
      dstSafetyDeposit: dstSafetyDeposit,
      fillThresholds: fillThresholds,
      salt: originalSalt, // Use the original salt, not the padded one
      expiration: expiration,
    };

    const validation = validateFusionPlusOrder(fusionOrderToValidate);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

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
      signedChainId, // Store the chain ID used for signing
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
      // Store extension data
      extension: body.extension,
      // Store encoded SDK order as single source-of-truth (PassTheOrder.md strategy)
      sdkOrderEncoded: body.sdkOrderEncoded,
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
      intents = intents.filter((intent) => intent.srcChain === chainInNum);
    }

    if (chainOut) {
      const chainOutNum = parseInt(chainOut);
      intents = intents.filter((intent) => intent.dstChain === chainOutNum);
    }

    if (user) {
      intents = intents.filter((intent) => {
        // Try to get maker from encoded order data if available
        if (intent.sdkOrderEncoded) {
          try {
            const orderData = JSON.parse(intent.sdkOrderEncoded);
            return (
              orderData.orderInfo.maker.toLowerCase() === user.toLowerCase()
            );
          } catch (error) {
            console.warn(
              "Failed to parse sdkOrderEncoded for user filter:",
              error
            );
            return false;
          }
        }
        return false; // No maker info available
      });
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
      intents, // Includes sdkOrderEncoded field for each intent
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

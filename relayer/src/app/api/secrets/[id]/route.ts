import { db } from "@/lib/database";
import { verifyResolverAuthentication } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: intentId } = await params;

    // Authenticate resolver
    const authResult = verifyResolverAuthentication(req);
    if (!authResult.valid) {
      console.warn(
        `❌ Unauthorized secret request for ${intentId}:`,
        authResult.error
      );
      return NextResponse.json(
        {
          error: "Unauthorized",
          details: authResult.error,
        },
        { status: 401 }
      );
    }

    console.log(
      `🔐 Authenticated resolver ${authResult.resolverName} requesting secret for intent ${intentId}`
    );

    try {
      await db.read();
    } catch (error) {
      console.warn("Database read failed, initializing with defaults:", error);
      db.data = {
        intents: [],
        whitelist: [],
        nonces: {},
      };
      await db.write();
    }

    // Find the intent
    const intent = db.data!.intents.find((i) => i.id === intentId);
    if (!intent) {
      return NextResponse.json({ error: "Intent not found" }, { status: 404 });
    }

    // Check if secret has been revealed
    if (intent.status !== "secret_revealed") {
      return NextResponse.json(
        {
          error: "Secret not yet revealed",
          status: intent.status,
          message:
            "Secret will be revealed after both escrows are created and finality lock expires",
        },
        { status: 400 }
      );
    }

    // Validate that the intent has the actual secret
    if (!intent.secret) {
      return NextResponse.json(
        {
          error: "Secret not available",
          message: "Secret was not properly stored with this intent",
        },
        { status: 500 }
      );
    }

    console.log(
      `🔓 Revealing secret for intent ${intent.id} to resolver ${authResult.resolverName}`
    );

    // Return secret information
    return NextResponse.json({
      intentId: intent.id,
      secret: intent.secret, // The actual secret for unlocking escrows
      secretHash: intent.fusionOrder.secretHash,
      status: intent.status,
      revealedAt: intent.secretRevealedAt || intent.updatedAt,
      message: "Secret revealed - use this to unlock escrows",
      fusionOrder: {
        srcChain: intent.fusionOrder.srcChain,
        dstChain: intent.fusionOrder.dstChain,
        srcEscrowTarget: intent.fusionOrder.srcEscrowTarget,
        dstEscrowTarget: intent.fusionOrder.dstEscrowTarget,
        makingAmount: intent.fusionOrder.makingAmount,
        takingAmount: intent.fusionOrder.takingAmount,
        makerAsset: intent.fusionOrder.makerAsset,
        takerAsset: intent.fusionOrder.takerAsset,
      },
    });
  } catch (error) {
    console.error("Secret retrieval error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { db, saveDatabase } from "@/lib/database";
import { CancelRequest } from "@/lib/types";
import {
  verifyCancelSignature,
  verifyResolverAuthentication,
} from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: intentId } = await params;

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

    // Find the intent
    const intent = db.data!.intents.find((i) => i.id === intentId);
    if (!intent) {
      return NextResponse.json({ error: "Intent not found" }, { status: 404 });
    }

    return NextResponse.json({
      intent,
      meta: {
        format: "fusion-plus",
        resolverClaimsCount: intent.resolverClaims.length,
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: intentId } = await params;
    const body: CancelRequest = await req.json();

    if (!body.signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

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

    // Find the intent
    const intent = db.data!.intents.find((i) => i.id === intentId);
    if (!intent) {
      return NextResponse.json({ error: "Intent not found" }, { status: 404 });
    }

    // Check if already cancelled or filled
    if (intent.status !== "pending") {
      return NextResponse.json(
        { error: "Intent cannot be cancelled" },
        { status: 400 }
      );
    }

    // Verify cancellation signature
    const userAddress = await verifyCancelSignature(
      intentId,
      body.signature
    );

    // Check if the signer is the intent maker
    if (userAddress.toLowerCase() !== intent.fusionOrder.maker.toLowerCase()) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Update intent status
    intent.status = "cancelled";
    intent.updatedAt = Date.now();

    await saveDatabase();

    // Dutch auction cancellation handled on-chain
    if (intent.fusionOrder.startRate !== "0") {
      console.log(
        `🗑️ Cancelled Dutch auction ${intentId} - on-chain auction will stop when escrow is cancelled`
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Intent cancellation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: intentId } = await params;

    // Check if request has content
    const contentType = req.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      return NextResponse.json(
        { error: "Content-Type must be application/json" },
        { status: 400 }
      );
    }

    // Get request body with better error handling
    let body;
    try {
      const text = await req.text();
      if (!text || text.trim() === "") {
        return NextResponse.json(
          { error: "Request body is empty" },
          { status: 400 }
        );
      }
      body = JSON.parse(text);
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    if (!body.status) {
      return NextResponse.json({ error: "Missing status" }, { status: 400 });
    }

    // Authenticate resolver before allowing intent updates
    const authResult = verifyResolverAuthentication(req);
    if (!authResult.valid) {
      console.warn(
        `❌ Unauthorized intent update attempt for ${intentId}:`,
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
      `🔐 Authenticated resolver ${authResult.resolverName} (${authResult.resolverAddress}) updating intent ${intentId}`
    );

    // Validate status according to Fusion+ protocol
    const validStatuses = [
      "pending",
      "processing",
      "escrow_src_created",
      "escrow_dst_created",
      "secret_revealed",
      "completed",
      "filled",
      "failed",
      "cancelled",
      "expired",
    ];

    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        {
          error: "Invalid status",
          validStatuses,
        },
        { status: 400 }
      );
    }

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

    // Find the intent
    const intent = db.data!.intents.find((i) => i.id === intentId);
    if (!intent) {
      return NextResponse.json({ error: "Intent not found" }, { status: 404 });
    }

    // Validate status transitions according to Fusion+ protocol
    const currentStatus = intent.status;
    const newStatus = body.status;

    // Define valid transitions
    const validTransitions: Record<string, string[]> = {
      pending: ["processing", "cancelled", "expired"],
      processing: ["escrow_src_created", "failed", "cancelled"],
      escrow_src_created: ["escrow_dst_created", "failed", "cancelled"],
      escrow_dst_created: ["secret_revealed", "failed", "cancelled"],
      secret_revealed: ["completed", "filled", "failed"],
      completed: [], // Terminal state
      filled: [], // Terminal state (legacy)
      failed: [], // Terminal state
      cancelled: [], // Terminal state
      expired: ["cancelled"], // Can only be cancelled after expiry
    };

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      return NextResponse.json(
        {
          error: "Invalid status transition",
          currentStatus,
          newStatus,
          validTransitions: validTransitions[currentStatus] || [],
        },
        { status: 400 }
      );
    }

    // Update intent with new status and Fusion+ protocol metadata
    intent.status = body.status as any;
    intent.updatedAt = Date.now();

    // Set protocol phase based on status
    const phaseMap: Record<string, 1 | 2 | 3 | 4> = {
      pending: 1,
      processing: 2,
      escrow_src_created: 2,
      escrow_dst_created: 2,
      secret_revealed: 3,
      completed: 3,
      filled: 3,
      failed: (intent.phase || 1) as 1 | 2 | 3 | 4, // Keep current phase on failure
      cancelled: (intent.phase || 1) as 1 | 2 | 3 | 4, // Keep current phase on cancellation
      expired: 4,
    };
    intent.phase = phaseMap[body.status];

    // Handle protocol-specific metadata
    if (body.escrowSrcTxHash) {
      intent.escrowSrcTxHash = body.escrowSrcTxHash;
    }
    if (body.escrowDstTxHash) {
      intent.escrowDstTxHash = body.escrowDstTxHash;
    }
    if (body.secretHash) {
      intent.secretHash = body.secretHash;
    }
    if (body.withdrawalTxHash) {
      intent.withdrawalTxHash = body.withdrawalTxHash;
    }
    if (body.reason) {
      intent.failureReason = body.reason;
    }

    // Apply any additional metadata
    if (body.metadata && typeof body.metadata === "object") {
      intent.metadata = { ...intent.metadata, ...body.metadata };
    }

    await saveDatabase();

    console.log(
      `✅ Intent ${intentId} updated: ${currentStatus} → ${newStatus} (Phase ${intent.phase})`
    );

    return NextResponse.json({
      success: true,
      previousStatus: currentStatus,
      newStatus,
      phase: intent.phase,
    });
  } catch (error) {
    console.error("Intent update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

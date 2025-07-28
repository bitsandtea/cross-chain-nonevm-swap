import { db, initializeDatabase, saveDatabase } from "@/lib/database";
import { CancelRequest } from "@/lib/types";
import { verifyCancelSignature } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";

// Initialize database
initializeDatabase();

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: intentId } = await params;
    const body: CancelRequest = await req.json();

    if (!body.signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    await db.read();

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
    const chainId = parseInt(process.env.CHAIN_ID || "31337"); // Default to hardhat localhost
    console.log("Using chainId for cancel signature verification:", chainId);
    const userAddress = await verifyCancelSignature(
      intentId,
      intent.nonce,
      body.signature,
      chainId
    );

    // Check if the signer is the intent creator
    if (userAddress.toLowerCase() !== intent.userAddress.toLowerCase()) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Update intent status
    intent.status = "cancelled";
    intent.updatedAt = Date.now();

    await saveDatabase();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Intent cancellation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

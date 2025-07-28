import { getUserNonce } from "@/lib/database";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    if (!address) {
      return NextResponse.json(
        { error: "Address parameter is required" },
        { status: 400 }
      );
    }

    const currentNonce = getUserNonce(address);

    return NextResponse.json({
      nonce: currentNonce,
      nextNonce: currentNonce + 1,
    });
  } catch (error) {
    console.error("Nonce retrieval error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

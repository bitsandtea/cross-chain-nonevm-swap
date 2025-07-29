import { getTokenPrices } from "@/lib/priceService";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tokensParam = searchParams.get("tokens");

    if (!tokensParam) {
      return NextResponse.json(
        { error: "Missing tokens parameter" },
        { status: 400 }
      );
    }

    const tokens = tokensParam
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      return NextResponse.json({ prices: {} }, { status: 200 });
    }

    // Get prices using the price service
    const prices = await getTokenPrices(tokens);

    return NextResponse.json({ prices }, { status: 200 });
  } catch (error) {
    console.error("Error in /api/prices:", error);
    return NextResponse.json(
      { error: "Failed to fetch token prices" },
      { status: 500 }
    );
  }
}

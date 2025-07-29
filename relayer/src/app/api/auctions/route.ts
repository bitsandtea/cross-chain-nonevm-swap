import { getPriceDecayService } from "@/lib/priceDecayService";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const intentId = searchParams.get("intentId");
    const priceDecayService = getPriceDecayService();

    if (intentId) {
      // Get price for specific intent
      const price = priceDecayService.getCurrentPrice(intentId);

      if (!price) {
        return NextResponse.json(
          { error: "Intent not found or not a Dutch auction" },
          { status: 404 }
        );
      }

      return NextResponse.json({ price });
    } else {
      // Get all auction prices
      const prices = priceDecayService.getAllCurrentPrices();
      const stats = priceDecayService.getAuctionStats();

      return NextResponse.json({
        prices,
        stats,
        count: prices.length,
      });
    }
  } catch (error) {
    console.error("Auction prices error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

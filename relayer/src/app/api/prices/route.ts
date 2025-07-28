import {
  calculateUSDValue,
  getPriceRatio,
  getSwapQuote,
  getTokenPrice,
  getTokenPrices,
} from "@/lib/priceService";
import { NextRequest, NextResponse } from "next/server";

// Helper function to filter valid Ethereum addresses
function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// GET /api/prices?tokens=address1,address2&action=prices
// GET /api/prices?token=address&action=single
// GET /api/prices?src=address1&dst=address2&amount=1000000000000000000&action=quote
// GET /api/prices?token=address&amount=1000000000000000000&action=usd
// GET /api/prices?token1=address1&token2=address2&action=ratio
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "prices";

    switch (action) {
      case "prices": {
        // Get multiple token prices
        const tokensParam = searchParams.get("tokens");
        if (!tokensParam) {
          return NextResponse.json(
            { error: "Missing tokens parameter" },
            { status: 400 }
          );
        }

        const tokens = tokensParam.split(",").map((t) => t.trim());

        // Filter out invalid Ethereum addresses and Aptos addresses
        const validTokens = tokens.filter((token) => {
          // Allow Ethereum addresses
          if (isValidEthereumAddress(token)) {
            return true;
          }
          // Skip Aptos addresses for now (they're not supported by 1inch)
          if (token.includes("::")) {
            return false;
          }
          return false;
        });

        if (validTokens.length === 0) {
          // Return empty prices if no valid tokens
          return NextResponse.json({ prices: {} });
        }

        const prices = await getTokenPrices(validTokens);

        // Also include the original invalid tokens with 0 price for consistency
        const allPrices: Record<string, string> = {};
        tokens.forEach((token) => {
          if (validTokens.includes(token)) {
            allPrices[token] = prices[token] || "0";
          } else {
            // Set Aptos tokens or invalid tokens to 0
            allPrices[token] = "0";
          }
        });

        return NextResponse.json({ prices: allPrices });
      }

      case "single": {
        // Get single token price
        const token = searchParams.get("token");
        if (!token) {
          return NextResponse.json(
            { error: "Missing token parameter" },
            { status: 400 }
          );
        }

        // Skip non-Ethereum tokens
        if (!isValidEthereumAddress(token)) {
          return NextResponse.json({ token, price: "0" });
        }

        const price = await getTokenPrice(token);
        return NextResponse.json({ token, price });
      }

      case "quote": {
        // Get swap quote
        const src = searchParams.get("src");
        const dst = searchParams.get("dst");
        const amount = searchParams.get("amount");

        if (!src || !dst || !amount) {
          return NextResponse.json(
            { error: "Missing required parameters: src, dst, amount" },
            { status: 400 }
          );
        }

        // Skip non-Ethereum tokens
        if (!isValidEthereumAddress(src) || !isValidEthereumAddress(dst)) {
          return NextResponse.json(
            { error: "Quotes only available for Ethereum tokens" },
            { status: 400 }
          );
        }

        const quote = await getSwapQuote({
          srcToken: src,
          dstToken: dst,
          amount: amount,
        });

        return NextResponse.json({ quote });
      }

      case "usd": {
        // Calculate USD value
        const token = searchParams.get("token");
        const amount = searchParams.get("amount");

        if (!token || !amount) {
          return NextResponse.json(
            { error: "Missing required parameters: token, amount" },
            { status: 400 }
          );
        }

        // Skip non-Ethereum tokens
        if (!isValidEthereumAddress(token)) {
          return NextResponse.json({ token, amount, usdValue: 0 });
        }

        const usdValue = await calculateUSDValue(token, amount);
        return NextResponse.json({ token, amount, usdValue });
      }

      case "ratio": {
        // Get price ratio between two tokens
        const token1 = searchParams.get("token1");
        const token2 = searchParams.get("token2");

        if (!token1 || !token2) {
          return NextResponse.json(
            { error: "Missing required parameters: token1, token2" },
            { status: 400 }
          );
        }

        // Skip non-Ethereum tokens
        if (
          !isValidEthereumAddress(token1) ||
          !isValidEthereumAddress(token2)
        ) {
          return NextResponse.json({ token1, token2, ratio: 0 });
        }

        const ratio = await getPriceRatio(token1, token2);
        return NextResponse.json({ token1, token2, ratio });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Price API error:", error);

    // Return empty/default data instead of error for better UX
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "prices";

    if (action === "prices") {
      return NextResponse.json({ prices: {} });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

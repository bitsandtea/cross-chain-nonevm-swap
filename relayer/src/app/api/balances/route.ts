import { ethers } from "ethers";
import { NextRequest, NextResponse } from "next/server";

// Helper function to format ETH amounts
function formatEthAmount(amount: string, decimals: number = 18): string {
  try {
    const wei = BigInt(amount);
    const eth = Number(wei) / Math.pow(10, decimals);
    return eth.toString();
  } catch {
    return "0";
  }
}

// Helper function to parse ETH amounts
function parseEthAmount(amount: string): bigint {
  try {
    return ethers.parseEther(amount);
  } catch {
    return BigInt(0);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address");
    const token = searchParams.get("token");

    if (!address || !token) {
      return NextResponse.json(
        { error: "Missing address or token parameter" },
        { status: 400 }
      );
    }

    // Initialize provider (using localhost for development)
    const provider = new ethers.JsonRpcProvider(
      process.env.NEXT_PUBLIC_RPC_URL
    );

    let balance: string;

    // Check if it's native ETH (zero address)
    if (token === ethers.ZeroAddress) {
      const ethBalance = await provider.getBalance(address);
      balance = ethBalance.toString();
    } else {
      // ERC-20 token
      const tokenContract = new ethers.Contract(
        token,
        ["function balanceOf(address owner) view returns (uint256)"],
        provider
      );

      const tokenBalance = await tokenContract.balanceOf(address);
      balance = tokenBalance.toString();
    }

    return NextResponse.json({
      balance,
      formattedBalance: formatEthAmount(balance),
      address,
      token,
    });
  } catch (error) {
    console.error("Balance fetch error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch balance",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

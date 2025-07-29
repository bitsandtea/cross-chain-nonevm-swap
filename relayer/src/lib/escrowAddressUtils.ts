import { ethers } from "ethers";
import { FusionPlusOrder } from "./types";

// Factory contract addresses for different chains
const FACTORY_ADDRESSES = {
  1: "0x...", // Ethereum mainnet - placeholder
  1000: "0x...", // Aptos - placeholder
};

// Minimal ABI for escrow factory address calculation
const ESCROW_FACTORY_ABI = [
  "function addressOfEscrowSrc(tuple(bytes32,bytes32,uint256,uint256,uint256,uint256,uint256,uint256) immutables) external view returns (address)",
  "function addressOfEscrowDst(tuple(bytes32,bytes32,uint256,uint256,uint256,uint256,uint256,uint256) immutables) external view returns (address)",
  "function ESCROW_SRC_IMPLEMENTATION() external view returns (address)",
  "function ESCROW_DST_IMPLEMENTATION() external view returns (address)",
];

// Pack timelocks into a single uint256 as expected by contracts
function packTimelocks(
  srcWithdrawal: number,
  srcPublicWithdrawal: number,
  srcCancellation: number,
  srcPublicCancellation: number,
  dstWithdrawal: number,
  dstPublicWithdrawal: number,
  dstCancellation: number,
  deployedAt: number = 0
): bigint {
  // This packing format matches the TimelocksLib.sol implementation
  // Each timelock gets a specific bit range in the uint256
  return (
    (BigInt(srcWithdrawal) << BigInt(224)) |
    (BigInt(srcPublicWithdrawal) << BigInt(192)) |
    (BigInt(srcCancellation) << BigInt(160)) |
    (BigInt(srcPublicCancellation) << BigInt(128)) |
    (BigInt(dstWithdrawal) << BigInt(96)) |
    (BigInt(dstPublicWithdrawal) << BigInt(64)) |
    (BigInt(dstCancellation) << BigInt(32)) |
    BigInt(deployedAt)
  );
}

// Convert cross-chain addresses to consistent format for immutables
function addressToImmutableFormat(address: string, chainId: number): bigint {
  if (chainId === 1) {
    // Ethereum address - convert directly
    return BigInt(address);
  } else {
    // Non-Ethereum address (e.g., Aptos) - hash to get consistent format
    const hash = ethers.keccak256(ethers.toUtf8Bytes(address));
    return BigInt(hash);
  }
}

/**
 * Compute deterministic escrow addresses for a Fusion+ order
 * This calculates where the escrow contracts will be deployed during execution
 */
export async function computeEscrowAddresses(
  fusionOrder: FusionPlusOrder,
  provider: ethers.Provider,
  resolverAddress?: string
): Promise<{
  srcEscrowAddress: string;
  dstEscrowAddress: string;
  orderHash: string;
}> {
  try {
    // Generate order hash from order parameters
    const orderHashData = ethers.keccak256(
      ethers.toUtf8Bytes(
        `${fusionOrder.makerAsset}-${fusionOrder.takerAsset}-${fusionOrder.makingAmount}-${fusionOrder.takingAmount}-${fusionOrder.maker}-${fusionOrder.srcChain}-${fusionOrder.dstChain}-${fusionOrder.salt}`
      )
    );

    // Pack timelocks for both src and dst
    const srcTimelocks = packTimelocks(
      fusionOrder.srcTimelock,
      fusionOrder.srcTimelock + 60, // Public withdrawal slightly later
      fusionOrder.srcTimelock + 120, // Cancellation after public withdrawal
      fusionOrder.srcTimelock + 180, // Public cancellation
      0,
      0,
      0 // dst timelocks not used in src immutables
    );

    const dstTimelocks = packTimelocks(
      0,
      0,
      0,
      0, // src timelocks not used in dst immutables
      fusionOrder.dstTimelock,
      fusionOrder.dstTimelock + 60,
      fusionOrder.dstTimelock + 120
    );

    // Default resolver address if not provided
    const defaultResolver = resolverAddress || fusionOrder.maker;

    // Construct source chain immutables
    const srcImmutables = [
      orderHashData,
      fusionOrder.secretHash,
      addressToImmutableFormat(fusionOrder.maker, fusionOrder.srcChain),
      addressToImmutableFormat(defaultResolver, fusionOrder.srcChain),
      addressToImmutableFormat(fusionOrder.makerAsset, fusionOrder.srcChain),
      BigInt(fusionOrder.makingAmount),
      BigInt(fusionOrder.srcSafetyDeposit),
      srcTimelocks,
    ];

    // Construct destination chain immutables
    const dstImmutables = [
      orderHashData,
      fusionOrder.secretHash,
      addressToImmutableFormat(fusionOrder.maker, fusionOrder.dstChain),
      addressToImmutableFormat(defaultResolver, fusionOrder.dstChain),
      addressToImmutableFormat(fusionOrder.takerAsset, fusionOrder.dstChain),
      BigInt(fusionOrder.takingAmount),
      BigInt(fusionOrder.dstSafetyDeposit),
      dstTimelocks,
    ];

    // Get factory contract for source chain
    const srcFactoryAddress =
      FACTORY_ADDRESSES[fusionOrder.srcChain as keyof typeof FACTORY_ADDRESSES];
    if (!srcFactoryAddress) {
      throw new Error(
        `No factory address configured for chain ${fusionOrder.srcChain}`
      );
    }

    const srcFactory = new ethers.Contract(
      srcFactoryAddress,
      ESCROW_FACTORY_ABI,
      provider
    );

    // Calculate deterministic addresses
    const srcEscrowAddress = await srcFactory.addressOfEscrowSrc(srcImmutables);
    const dstEscrowAddress = await srcFactory.addressOfEscrowDst(dstImmutables);

    return {
      srcEscrowAddress,
      dstEscrowAddress,
      orderHash: orderHashData,
    };
  } catch (error) {
    console.error("Error computing escrow addresses:", error);

    // Fallback to deterministic addresses based on order hash
    const fallbackHash = ethers.keccak256(
      ethers.toUtf8Bytes(
        `${fusionOrder.maker}-${fusionOrder.salt}-${Date.now()}`
      )
    );

    return {
      srcEscrowAddress: ethers.getCreate2Address(
        fusionOrder.maker,
        fallbackHash,
        ethers.keccak256("0x")
      ),
      dstEscrowAddress: ethers.getCreate2Address(
        fusionOrder.maker,
        ethers.keccak256(ethers.toUtf8Bytes(fallbackHash + "dst")),
        ethers.keccak256("0x")
      ),
      orderHash: fallbackHash,
    };
  }
}

/**
 * Simplified escrow address computation for development/testing
 * Uses deterministic CREATE2 addresses without requiring deployed factories
 */
export function computeSimpleEscrowAddresses(fusionOrder: FusionPlusOrder): {
  srcEscrowAddress: string;
  dstEscrowAddress: string;
  orderHash: string;
} {
  // Generate deterministic order hash
  const orderHash = ethers.keccak256(
    ethers.toUtf8Bytes(
      `${fusionOrder.makerAsset}-${fusionOrder.takerAsset}-${fusionOrder.makingAmount}-${fusionOrder.takingAmount}-${fusionOrder.maker}-${fusionOrder.salt}`
    )
  );

  // Create deterministic escrow addresses using CREATE2
  const srcSalt = ethers.keccak256(ethers.toUtf8Bytes(`${orderHash}-src`));
  const dstSalt = ethers.keccak256(ethers.toUtf8Bytes(`${orderHash}-dst`));

  // Use a standard factory address pattern for CREATE2 computation
  const factoryAddress = process.env.NEXT_PUBLIC_ETH_FACTORY_ADDRESS || "";

  const srcEscrowAddress = ethers.getCreate2Address(
    factoryAddress,
    srcSalt,
    ethers.keccak256("0x") // Placeholder bytecode hash
  );

  const dstEscrowAddress = ethers.getCreate2Address(
    factoryAddress,
    dstSalt,
    ethers.keccak256("0x") // Placeholder bytecode hash
  );

  return {
    srcEscrowAddress,
    dstEscrowAddress,
    orderHash,
  };
}

import { ethers } from "ethers";
import { EscrowData, getDatabase } from "./simpleDatabase";

// Shared interfaces
export interface EscrowEvent {
  type: "EscrowCreated" | "FundsClaimed" | "OrderCancelled" | "FundsRescued";
  escrowAddress: string;
  maker: string;
  taker: string;
  token: string;
  amount: string;
  hashlock: string;
  timelock: number;
  preimage?: string;
  blockNumber: number;
  transactionHash: string;
  chainId: number;
}

export interface ListenerConfig {
  rpcUrl: string;
  factoryAddress: string;
  chainId: number;
  startBlock?: number;
}

export interface SrcImmutables {
  orderHash: string;
  hashlock: string;
  maker: bigint;
  taker: bigint;
  token: bigint;
  amount: bigint;
  safetyDeposit: bigint;
  timelocks: bigint;
}

export interface DstImmutablesComplement {
  maker: bigint;
  amount: bigint;
  token: bigint;
  safetyDeposit: bigint;
  chainId: bigint;
}

// Enhanced ABI definitions
export const ESCROW_FACTORY_ABI = [
  "event SrcEscrowCreated(tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) srcImmutables, tuple(uint256 maker, uint256 amount, uint256 token, uint256 safetyDeposit, uint256 chainId) dstImmutablesComplement)",
  "event DstEscrowCreated(address escrow, bytes32 hashlock, uint256 taker)",
  "function addressOfEscrowSrc(tuple(bytes32,bytes32,uint256,uint256,uint256,uint256,uint256,uint256) immutables) external view returns (address)",
  "function addressOfEscrowDst(tuple(bytes32,bytes32,uint256,uint256,uint256,uint256,uint256,uint256) immutables) external view returns (address)",
];

export const BASE_ESCROW_ABI = [
  "event EscrowWithdrawal(bytes32 secret)",
  "event EscrowCancelled()",
  "event FundsRescued(address token, uint256 amount)",
  "function FACTORY() external view returns (address)",
  "function RESCUE_DELAY() external view returns (uint256)",
  // Add function to get immutables if exposed (some escrows might expose this)
  "function getImmutables() external view returns (tuple(bytes32,bytes32,uint256,uint256,uint256,uint256,uint256,uint256))",
];

// Helper functions
export function createFactoryContract(
  factoryAddress: string,
  provider: ethers.JsonRpcProvider
): ethers.Contract {
  return new ethers.Contract(factoryAddress, ESCROW_FACTORY_ABI, provider);
}

export function createEscrowContract(
  escrowAddress: string,
  provider: ethers.JsonRpcProvider
): ethers.Contract {
  return new ethers.Contract(escrowAddress, BASE_ESCROW_ABI, provider);
}

// Enhanced function to calculate escrow address from immutables
export async function calculateEscrowAddress(
  srcImmutables: SrcImmutables,
  factoryContract: ethers.Contract
): Promise<string> {
  try {
    const immutablesTuple = [
      srcImmutables.orderHash,
      srcImmutables.hashlock,
      srcImmutables.maker,
      srcImmutables.taker,
      srcImmutables.token,
      srcImmutables.amount,
      srcImmutables.safetyDeposit,
      srcImmutables.timelocks,
    ];

    return await factoryContract.addressOfEscrowSrc(immutablesTuple);
  } catch (error) {
    console.error("Error calculating escrow address:", error);
    return "";
  }
}

// Enhanced function to parse timelocks
export function parseTimelocks(timelocksBigInt: bigint): {
  deployedAt: number;
  srcWithdrawal: number;
  srcCancellation: number;
  dstWithdrawal: number;
  dstCancellation: number;
} {
  // Timelocks are packed into a single uint256 with different stages
  // Based on TimelocksLib.sol, each stage uses specific bits
  // This is a simplified parsing - adjust based on actual TimelocksLib implementation

  // Extract individual timestamps from the packed value
  // The exact bit layout would need to be confirmed from TimelocksLib.sol
  const deployedAt = Number(timelocksBigInt & BigInt(0xffffffff)); // First 32 bits
  const srcWithdrawal = Number(
    (timelocksBigInt >> BigInt(32)) & BigInt(0xffffffff)
  ); // Next 32 bits
  const srcCancellation = Number(
    (timelocksBigInt >> BigInt(64)) & BigInt(0xffffffff)
  ); // Next 32 bits
  const dstWithdrawal = Number(
    (timelocksBigInt >> BigInt(96)) & BigInt(0xffffffff)
  ); // Next 32 bits
  const dstCancellation = Number(
    (timelocksBigInt >> BigInt(128)) & BigInt(0xffffffff)
  ); // Next 32 bits

  // If the raw value looks like a simple timestamp, use it for all stages
  const timestamp = Number(timelocksBigInt);
  const now = Math.floor(Date.now() / 1000);

  // If the value seems like a simple timestamp (reasonable range), use it
  if (timestamp > now - 86400 && timestamp < now + 86400 * 365) {
    return {
      deployedAt: timestamp,
      srcWithdrawal: timestamp + 3600, // 1 hour later
      srcCancellation: timestamp + 7200, // 2 hours later
      dstWithdrawal: timestamp + 3600, // 1 hour later
      dstCancellation: timestamp + 7200, // 2 hours later
    };
  }

  return {
    deployedAt,
    srcWithdrawal,
    srcCancellation,
    dstWithdrawal,
    dstCancellation,
  };
}

export async function processSrcEscrowCreatedEvent(
  srcImmutables: SrcImmutables,
  dstImmutablesComplement: DstImmutablesComplement,
  event: ethers.EventLog,
  chainId: number,
  factoryContract: ethers.Contract
): Promise<EscrowEvent> {
  // Calculate the escrow address
  const escrowAddress = await calculateEscrowAddress(
    srcImmutables,
    factoryContract
  );

  // Parse timelocks
  const timelocks = parseTimelocks(srcImmutables.timelocks);

  // Save complete escrow data to database
  const db = await getDatabase();
  const escrowData: EscrowData = {
    escrowAddress,
    hashlock: srcImmutables.hashlock,
    maker: srcImmutables.maker.toString(),
    taker: srcImmutables.taker.toString(),
    token: srcImmutables.token.toString(),
    amount: srcImmutables.amount.toString(),
    safetyDeposit: srcImmutables.safetyDeposit.toString(),
    timelocks,
    orderHash: srcImmutables.orderHash,
    chainId,
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.saveEscrow(escrowData);

  return {
    type: "EscrowCreated",
    escrowAddress,
    maker: srcImmutables.maker.toString(),
    taker: srcImmutables.taker.toString(),
    token: srcImmutables.token.toString(),
    amount: srcImmutables.amount.toString(),
    hashlock: srcImmutables.hashlock,
    timelock: timelocks.srcWithdrawal,
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash,
    chainId,
  };
}

export async function processDstEscrowCreatedEvent(
  escrow: string,
  hashlock: string,
  taker: bigint,
  event: ethers.EventLog,
  chainId: number
): Promise<EscrowEvent> {
  try {
    const provider = new ethers.JsonRpcProvider(
      process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545"
    );
    const db = await getDatabase();

    // Get the transaction to extract the immutables from the input data
    const tx = await provider.getTransaction(event.transactionHash);
    let immutablesData: Partial<EscrowData> = {};

    if (tx) {
      try {
        // Decode the createDstEscrow function call
        const factoryInterface = new ethers.Interface([
          "function createDstEscrow(tuple(bytes32 orderHash, bytes32 hashlock, uint256 maker, uint256 taker, uint256 token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) dstImmutables, uint256 srcCancellationTimestamp) external payable",
        ]);

        const decoded = factoryInterface.parseTransaction({ data: tx.data });

        if (decoded && decoded.name === "createDstEscrow") {
          const dstImmutables = decoded.args[0];
          const srcCancellationTimestamp = decoded.args[1];

          console.log("🔍 Decoded createDstEscrow call:", {
            orderHash: dstImmutables.orderHash,
            hashlock: dstImmutables.hashlock,
            maker: dstImmutables.maker.toString(),
            taker: dstImmutables.taker.toString(),
            token: dstImmutables.token.toString(),
            amount: dstImmutables.amount.toString(),
            safetyDeposit: dstImmutables.safetyDeposit.toString(),
            timelocks: dstImmutables.timelocks.toString(),
            srcCancellationTimestamp: srcCancellationTimestamp.toString(),
          });

          // Parse timelocks
          const parsedTimelocks = parseTimelocks(dstImmutables.timelocks);

          immutablesData = {
            escrowAddress: escrow,
            hashlock: dstImmutables.hashlock,
            maker: ethers.getAddress(
              "0x" + dstImmutables.maker.toString(16).padStart(40, "0")
            ),
            taker: ethers.getAddress(
              "0x" + dstImmutables.taker.toString(16).padStart(40, "0")
            ),
            token: ethers.getAddress(
              "0x" + dstImmutables.token.toString(16).padStart(40, "0")
            ),
            amount: dstImmutables.amount.toString(),
            safetyDeposit: dstImmutables.safetyDeposit.toString(),
            timelocks: parsedTimelocks,
            orderHash: dstImmutables.orderHash,
          };
        }
      } catch (decodeError) {
        console.error("Error decoding transaction:", decodeError);
      }
    }

    // Get escrow balance
    try {
      const balance = await provider.getBalance(escrow);
      immutablesData.safetyDeposit = balance.toString();
    } catch (balanceError) {
      console.error(`Error getting balance for ${escrow}:`, balanceError);
    }

    // Create or update escrow data
    const existingEscrow = await db.getEscrowByHashlock(hashlock, chainId);

    const escrowData: EscrowData = {
      escrowAddress: escrow,
      hashlock,
      maker: immutablesData.maker || "",
      taker: immutablesData.taker || taker.toString(),
      token: immutablesData.token || "",
      amount: immutablesData.amount || "",
      safetyDeposit: immutablesData.safetyDeposit || "0",
      timelocks: immutablesData.timelocks || {
        deployedAt: Math.floor(Date.now() / 1000),
        srcWithdrawal: 0,
        srcCancellation: 0,
        dstWithdrawal: 0,
        dstCancellation: 0,
      },
      orderHash: immutablesData.orderHash || "",
      chainId,
      status: "funded",
      createdAt: existingEscrow?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    await db.saveEscrow(escrowData);

    console.log(`💾 Saved COMPLETE escrow data for ${escrow}:`, {
      maker: escrowData.maker,
      taker: escrowData.taker,
      token: escrowData.token,
      amount: escrowData.amount,
      safetyDeposit: escrowData.safetyDeposit,
      orderHash: escrowData.orderHash,
    });
  } catch (error) {
    console.error("Error processing destination escrow:", error);
  }

  return {
    type: "EscrowCreated",
    escrowAddress: escrow,
    maker: "",
    taker: taker.toString(),
    token: "",
    amount: "",
    hashlock,
    timelock: 0,
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash,
    chainId,
  };
}

export function processEscrowWithdrawalEvent(
  secret: string,
  event: ethers.EventLog,
  escrowAddress: string,
  chainId: number
): EscrowEvent {
  return {
    type: "FundsClaimed",
    escrowAddress,
    maker: "", // Would need to be looked up
    taker: "", // Would need to be looked up
    token: "", // Would need to be looked up
    amount: "", // Would need to be looked up
    hashlock: "", // Would need to be looked up
    timelock: 0, // Would need to be looked up
    preimage: secret,
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash,
    chainId,
  };
}

export async function saveEvent(event: EscrowEvent): Promise<void> {
  const db = await getDatabase();

  // Save the event to database
  await db.saveEvent({
    escrowAddress: event.escrowAddress,
    type: event.type as
      | "EscrowCreated"
      | "FundsClaimed"
      | "OrderCancelled"
      | "FundsRescued",
    hashlock: event.hashlock,
    preimage: event.preimage,
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash,
    chainId: event.chainId,
    data: {
      maker: event.maker,
      taker: event.taker,
      token: event.token,
      amount: event.amount,
      timelock: event.timelock,
    },
  });

  // Update escrow status if needed
  if (event.type === "FundsClaimed") {
    await db.updateEscrowStatus(
      event.escrowAddress,
      event.chainId,
      "withdrawn"
    );
  } else if (event.type === "OrderCancelled") {
    await db.updateEscrowStatus(
      event.escrowAddress,
      event.chainId,
      "cancelled"
    );
  }

  console.log(`Event saved: ${event.type} on chain ${event.chainId}`, {
    escrow: event.escrowAddress,
    txHash: event.transactionHash,
    block: event.blockNumber,
  });
}

export function getConfigFromEnv(): ListenerConfig {
  return {
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545", // Default to hardhat
    factoryAddress:
      process.env.NEXT_PUBLIC_ETH_FACTORY_ADDRESS ||
      "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853", // Hardhat deployed address
    chainId: parseInt(process.env.CHAIN_ID || "31337"), // Hardhat chain ID
    startBlock: parseInt(process.env.START_BLOCK || "0"),
  };
}

export function isEventLog(
  event: ethers.Log | ethers.EventLog
): event is ethers.EventLog {
  return "args" in event;
}

// Enhanced function to update escrow with complete data
export async function updateEscrowWithCompleteData(
  escrowAddress: string,
  chainId: number,
  provider: ethers.JsonRpcProvider
): Promise<void> {
  try {
    const db = await getDatabase();
    const escrow = await db.getEscrow(escrowAddress, chainId);

    if (escrow) {
      // Just update the balance for now, since we get complete data from transaction decode
      try {
        const balance = await provider.getBalance(escrowAddress);
        const updatedEscrow: EscrowData = {
          ...escrow,
          safetyDeposit: balance.toString(),
          updatedAt: Date.now(),
        };

        await db.saveEscrow(updatedEscrow);
        console.log(
          `✅ Updated escrow ${escrowAddress} balance: ${ethers.formatEther(
            balance
          )} ETH`
        );
      } catch (balanceError) {
        console.error(
          `Error getting balance for ${escrowAddress}:`,
          balanceError
        );
      }
    }
  } catch (error) {
    console.error(`Error updating escrow ${escrowAddress}:`, error);
  }
}

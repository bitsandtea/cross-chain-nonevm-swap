import { randomBytes } from "crypto";
import "dotenv/config";
import { ethers, JsonRpcProvider, Wallet } from "ethers";

import {
  Address,
  AuctionDetails,
  EvmAddress,
  EvmCrossChainOrder,
  Extension,
  HashLock,
  randBigInt,
  SupportedChains,
  TimeLocks,
  TRUE_ERC20,
} from "@1inch/cross-chain-sdk";

import { loadResolverConfig } from "../src/config";
import { EvmEscrowService } from "../src/services/EvmEscrowService";

const UINT_40_MAX = (1n << 40n) - 1n;

const safeBigInt = (val: string, fallback = 0n): bigint => {
  try {
    return val ? BigInt(val) : fallback;
  } catch {
    return fallback;
  }
};

interface Config {
  evmPrivateKey: string;
  aptosPrivateKey: string;
  evmRpcUrl: string;
  escrowFactoryAddress: string;
  resolverAddress: string;
  lopAddress: string;
  sourceChainId: number;
  destinationChainId: number;
  tokenA: string;
}

function initConfig(): Config {
  const config = {
    evmPrivateKey: process.env.OWNER_PKEY!,
    aptosPrivateKey: process.env.RESOLVER_APTOS_PRIVATE_KEY!,
    evmRpcUrl: process.env.EVM_RPC_URL!,
    escrowFactoryAddress: process.env.NEXT_PUBLIC_ETH_FACTORY_ADDRESS!,
    resolverAddress: process.env.NEXT_PUBLIC_RESOLVER_ADDRESS!,
    lopAddress: process.env.NEXT_PUBLIC_LOP_ADDRESS!,
    sourceChainId: 84532, // Base Sepolia
    destinationChainId: 1000, // Aptos
    tokenA: "0x64a522C31854f28C4Ee67DC24c5344b16bf17bbf", // Use token from intent usdc
  };

  // Add chain support to SDK
  const chainsToAdd = [config.sourceChainId, config.destinationChainId];
  chainsToAdd.forEach((chainId) => {
    if (!(SupportedChains as readonly number[]).includes(chainId)) {
      (SupportedChains as unknown as number[]).push(chainId);
    }
  });

  // Add token support
  (TRUE_ERC20 as any)[config.sourceChainId] = new EvmAddress(
    new Address(config.tokenA)
  );

  return config;
}

async function signOrderWithCustomLop(
  order: EvmCrossChainOrder,
  signer: Wallet,
  config: Config
): Promise<string> {
  const { buildOrderTypedData } = await import("@1inch/limit-order-sdk");

  const typedData = buildOrderTypedData(
    config.sourceChainId,
    config.lopAddress,
    "1inch Limit Order Protocol",
    "4",
    order.build()
  );

  const domainForSignature = {
    ...typedData.domain,
    chainId: config.sourceChainId,
  };

  const signature = await signer.signTypedData(
    domainForSignature,
    { Order: typedData.types.Order },
    typedData.message
  );

  (order as any).getOrderHash = (_srcChainId: number) =>
    ethers.TypedDataEncoder.hash(
      domainForSignature,
      { Order: typedData.types.Order },
      typedData.message
    );

  return signature;
}

async function createOrder(config: Config, maker: Wallet) {
  // ----------------------------------------------------------------------------
  // 1. Secret & Hash-lock
  // ----------------------------------------------------------------------------
  const secretBytes = randomBytes(32);
  const secret = "0x" + Buffer.from(secretBytes).toString("hex");
  const hashLock = HashLock.forSingleFill(secret);
  const secretHash = hashLock.toString();

  // ----------------------------------------------------------------------------
  // 2. Time-locks & Safety deposits
  // ----------------------------------------------------------------------------
  const timeLocks = TimeLocks.new({
    srcWithdrawal: 0n,
    srcPublicWithdrawal: 12000n,
    srcCancellation: 18000n,
    srcPublicCancellation: 24000n,
    dstWithdrawal: 0n,
    dstPublicWithdrawal: 120n,
    dstCancellation: 180n,
  });

  const SRC_SAFETY_DEPOSIT = safeBigInt("10000000000000000"); // 0.01 ETH
  const DST_SAFETY_DEPOSIT = safeBigInt("1000000000000000"); // 0.001 ETH

  // ----------------------------------------------------------------------------
  // 3. Auction parameters (no auction - fixed price)
  // ----------------------------------------------------------------------------
  const auctionDetails = AuctionDetails.noAuction();

  // ----------------------------------------------------------------------------
  // 4. Build Cross-Chain Order
  // ----------------------------------------------------------------------------
  const MAKING_AMOUNT = safeBigInt("1000000"); // 1 USDC (6 decimals)
  const TAKING_AMOUNT = safeBigInt("1000000"); // 1 USDC worth on Aptos

  const nonce = randBigInt(UINT_40_MAX);

  const order = EvmCrossChainOrder.new(
    new EvmAddress(new Address(config.escrowFactoryAddress)),
    {
      makerAsset: new EvmAddress(new Address(config.tokenA)),
      takerAsset: new EvmAddress(
        new Address("0x0000000000000000000000000000000000000000")
      ), // Native token placeholder
      makingAmount: MAKING_AMOUNT,
      takingAmount: TAKING_AMOUNT,
      maker: new EvmAddress(new Address(maker.address)),
      receiver: new EvmAddress(
        new Address("0x0000000000000000000000000000000000000000")
      ), // EVM placeholder - real Aptos receiver in extension
    },
    {
      hashLock,
      srcChainId: config.sourceChainId as unknown as any,
      dstChainId: config.destinationChainId as unknown as any, // Aptos = 1000
      srcSafetyDeposit: SRC_SAFETY_DEPOSIT,
      dstSafetyDeposit: DST_SAFETY_DEPOSIT,
      timeLocks,
    },
    {
      auction: auctionDetails,
      whitelist: [
        {
          address: new EvmAddress(new Address(config.resolverAddress)),
          allowFrom: 0n,
        },
      ],
    },
    {
      allowPartialFills: false,
      allowMultipleFills: false,
      nonce: nonce,
    }
  );

  // ----------------------------------------------------------------------------
  // 5. Sign the order (EIP-712)
  // ----------------------------------------------------------------------------
  // Use abstracted signing function that handles domain consistency
  const signature = await signOrderWithCustomLop(order, maker, config);

  const output = {
    order: order.build(),
    extension: order.extension.encode(),
    signature,
    secret,
    hashlock: secretHash,
    orderHash: order.getOrderHash(config.sourceChainId),
    expirationTime: new Date(Number(order.deadline) * 1000).toISOString(),
  };

  return output;
}

async function depositToSrcEscrow(
  orderData: Awaited<ReturnType<typeof createOrder>>,
  config: Config,
  resolverConfig: any
): Promise<any> {
  // Create provider and taker wallet (using same wallet as maker for demo)
  const provider = new JsonRpcProvider(config.evmRpcUrl);
  const taker = new Wallet(config.evmPrivateKey, provider);

  // Initialize EVM escrow service
  const evmEscrowService = new EvmEscrowService(resolverConfig, taker);

  // Re-create the order object from serialized data
  const extension = Extension.decode(orderData.extension);
  const order = EvmCrossChainOrder.fromDataAndExtension(
    orderData.order,
    extension
  );

  // Generate source escrow transaction directly using the order
  const tx = evmEscrowService.generateSrcEscrowTX(
    order,
    orderData.signature,
    BigInt(orderData.order.makingAmount),
    config.sourceChainId
  );

  console.log("Generated source escrow deployment transaction:", {
    to: tx.to,
    value: tx.value?.toString(),
    dataLength: tx.data?.length,
  });

  // Execute the transaction
  try {
    console.log("Attempting to send transaction...");
    console.log("Transaction details:", {
      to: tx.to,
      value: tx.value?.toString(),
      from: taker.address,
      gasLimit: tx.gasLimit?.toString(),
    });

    // Check wallet balance first
    const balance = await taker.provider!.getBalance(taker.address);
    console.log("Wallet balance:", balance.toString());
    console.log("Required value:", tx.value?.toString() || "0");

    // Check if contract exists
    const code = await taker.provider!.getCode(tx.to!);
    console.log("Contract code exists:", code !== "0x");

    const txResponse = await taker.sendTransaction(tx);
    console.log("Transaction sent:", txResponse.hash);

    const receipt = await txResponse.wait();
    console.log("Source escrow deployed successfully:", {
      txHash: txResponse.hash,
      gasUsed: receipt?.gasUsed?.toString(),
    });

    return {
      txHash: txResponse.hash,
      receipt,
      order,
    };
  } catch (error: any) {
    console.log("Transaction failed:", {
      error: error.message,
      code: error.code,
      reason: error.reason,
    });

    // Try to get more detailed error info
    if (error.transaction) {
      console.log("Failed transaction details:", {
        to: error.transaction.to,
        from: error.transaction.from,
        value: error.transaction.value?.toString(),
        data: error.transaction.data?.slice(0, 66) + "...",
      });
    }

    throw error; // Re-throw to see actual error
  }
}

async function main() {
  console.log("Starting EVM to Aptos end-to-end workflow");

  const config = initConfig();
  const resolverConfig = loadResolverConfig();

  // Create maker wallet
  const provider = new JsonRpcProvider(config.evmRpcUrl);
  const maker = new Wallet(config.evmPrivateKey, provider);

  console.log("Creating order with maker:", {
    address: maker.address,
    sourceChainId: config.sourceChainId,
    destinationChainId: config.destinationChainId,
  });

  const orderData = await createOrder(config, maker);
  console.log("Created order data:", {
    orderHash: orderData.orderHash,
    secret: orderData.secret.slice(0, 10) + "...",
    expiration: orderData.expirationTime,
  });

  // IGNORE THIS
  // Before resolver starts to execute order
  // there should be a pause of one block
  // due to LOP check allowedTime > block.timestamp
  // console.log(
  //   'Waiting for one block - before "resolver" starts to execute order'
  // );
  // await new Promise((resolve) => setTimeout(resolve, 10000));

  // Resolver deposits to src escrow
  const depositResult = await depositToSrcEscrow(
    orderData,
    config,
    resolverConfig
  );
  console.log("Deposit completed:", {
    txHash: depositResult.txHash,
  });

  console.log("Script completed successfully");
}

main().catch(console.error);

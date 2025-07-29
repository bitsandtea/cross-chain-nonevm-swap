// OrderBuilder for Fusion+ LOP Integration
// Constructs 1inch LOP orders with Dutch auction pricing and escrow postInteraction

import { ethers } from 'ethers';

export interface DutchAuctionParams {
  startRate: bigint;
  endRate: bigint;
  startTimestamp: number;
  duration: number; // in seconds
}

export interface EscrowImmutables {
  orderHash: string;
  hashlock: string;
  maker: string;
  taker: string;
  token: string;
  amount: bigint;
  safetyDeposit: bigint;
  timelocks: bigint;
}

export interface FusionPlusOrderParams {
  maker: string;
  makerAsset: string;
  takerAsset: string;
  makingAmount: bigint;
  receiver: string;
  auctionParams: DutchAuctionParams;
  escrowImmutables: EscrowImmutables;
  factoryAddress: string;
  expiration: number;
}

export interface LOPOrder {
  salt: bigint;
  maker: string;
  receiver: string;
  makerAsset: string;
  takerAsset: string;
  makingAmount: bigint;
  takingAmount: bigint;
  makerTraits: bigint;
}

export interface LOPOrderWithData {
  order: LOPOrder;
  extension: string;
  signature: string;
}

/**
 * Encodes Dutch auction getter data using DutchAuctionGetterLib ABI
 */
function encodeDutchAuctionGetter(
  auctionParams: DutchAuctionParams,
  dutchAuctionLibAddress: string
): string {
  const dutchAuctionGetterAbi = [
    "function getTakingAmount(uint256 startRate, uint256 endRate, uint256 startTs, uint256 duration) view returns (uint256)"
  ];
  
  const iface = new ethers.Interface(dutchAuctionGetterAbi);
  
  return ethers.concat([
    dutchAuctionLibAddress,
    iface.encodeFunctionData("getTakingAmount", [
      auctionParams.startRate,
      auctionParams.endRate,
      auctionParams.startTimestamp,
      auctionParams.duration
    ])
  ]);
}

/**
 * Encodes postInteraction for escrow creation via EscrowFactory.createSrcEscrow
 */
function encodePostInteraction(
  immutables: EscrowImmutables,
  factoryAddress: string
): string {
  const factoryAbi = [
    "function createSrcEscrow(bytes calldata immutables) external"
  ];
  
  const iface = new ethers.Interface(factoryAbi);
  
  // Encode the immutables struct
  const immutablesTypes = [
    "bytes32", // orderHash
    "bytes32", // hashlock
    "address", // maker
    "address", // taker
    "address", // token
    "uint256", // amount
    "uint256", // safetyDeposit
    "uint256"  // timelocks
  ];
  
  const encodedImmutables = ethers.AbiCoder.defaultAbiCoder().encode(
    immutablesTypes,
    [
      immutables.orderHash,
      immutables.hashlock,
      immutables.maker,
      immutables.taker,
      immutables.token,
      immutables.amount,
      immutables.safetyDeposit,
      immutables.timelocks
    ]
  );
  
  return ethers.concat([
    factoryAddress,
    iface.encodeFunctionData("createSrcEscrow", [encodedImmutables])
  ]);
}

/**
 * Builds a complete Fusion+ order ready for LOP execution
 */
export function buildFusionPlusOrder(
  params: FusionPlusOrderParams,
  dutchAuctionLibAddress: string,
  privateKey: string
): LOPOrderWithData {
  const salt = BigInt(ethers.randomBytes(32));
  
  // Build base LOP order
  const order: LOPOrder = {
    salt,
    maker: params.maker,
    receiver: params.receiver,
    makerAsset: params.makerAsset,
    takerAsset: params.takerAsset,
    makingAmount: params.makingAmount,
    takingAmount: params.auctionParams.startRate, // Initial taking amount
    makerTraits: 0n // Will be set based on requirements
  };
  
  // Encode Dutch auction getter
  const getter = encodeDutchAuctionGetter(params.auctionParams, dutchAuctionLibAddress);
  
  // Encode postInteraction for escrow creation
  const postInteraction = encodePostInteraction(params.escrowImmutables, params.factoryAddress);
  
  // Build extension with getter and postInteraction
  const extensionData = ethers.concat([
    ethers.toBeHex(getter.length, 2), // getter length
    getter,
    ethers.toBeHex(postInteraction.length, 2), // postInteraction length  
    postInteraction
  ]);
  
  // Create order hash for signing
  const orderTypes = [
    "uint256", // salt
    "address", // maker
    "address", // receiver
    "address", // makerAsset
    "address", // takerAsset
    "uint256", // makingAmount
    "uint256", // takingAmount
    "uint256"  // makerTraits
  ];
  
  const orderHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(orderTypes, [
      order.salt,
      order.maker,
      order.receiver,
      order.makerAsset,
      order.takerAsset,
      order.makingAmount,
      order.takingAmount,
      order.makerTraits
    ])
  );
  
  // Sign the order
  const wallet = new ethers.Wallet(privateKey);
  const signature = wallet.signMessageSync(ethers.getBytes(orderHash));
  
  return {
    order,
    extension: extensionData,
    signature
  };
}

/**
 * Validates that predicate endTime >= srcTimelock as required by design
 */
export function validateOrderTiming(
  auctionParams: DutchAuctionParams,
  srcTimelock: number
): boolean {
  const auctionEnd = auctionParams.startTimestamp + auctionParams.duration;
  return auctionEnd >= srcTimelock;
}

/**
 * Estimates gas for the complete Fusion+ transaction
 */
export function estimateFusionPlusGas(): bigint {
  // Base LOP fill: ~150k gas
  // Escrow deployment: ~100k gas  
  // Safety buffer: 50k gas
  return 300000n;
}
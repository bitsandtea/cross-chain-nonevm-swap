export interface IntentDB {
  intents: Intent[];
  whitelist: string[];
  nonces: Record<string, number>;
}

export interface Intent {
  id: string;
  userAddress: string;
  sellToken: string;
  buyToken: string;
  amountIn: string;
  minAmountOut: string;
  chainIn: number;
  chainOut: number;
  expiration: number;
  maxSlippage: number;
  feeCap: string;
  nonce: number;
  signature: string;
  status: "pending" | "filled" | "cancelled" | "expired";
  createdAt: number;
  updatedAt: number;
}

export interface IntentRequest {
  intent: {
    sellToken: string;
    buyToken: string;
    amountIn: string;
    minAmountOut: string;
    chainIn: number;
    chainOut: number;
    expiration: number;
    maxSlippage: number;
    feeCap: string;
    nonce: number;
  };
  signature: string;
}

export interface CancelRequest {
  signature: string;
}

export const DOMAIN = {
  name: "CrossChainIntentPool",
  version: "1",
  chainId: 1,
  verifyingContract:
    process.env.ZERO_ADDRESS || "0x0000000000000000000000000000000000000000",
};

export const INTENT_TYPE = {
  Intent: [
    { name: "sellToken", type: "string" },
    { name: "buyToken", type: "string" },
    { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "chainIn", type: "uint256" },
    { name: "chainOut", type: "uint256" },
    { name: "expiration", type: "uint256" },
    { name: "maxSlippage", type: "uint256" },
    { name: "feeCap", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

export const CANCEL_TYPE = {
  Cancel: [
    { name: "intentId", type: "string" },
    { name: "nonce", type: "uint256" },
  ],
};

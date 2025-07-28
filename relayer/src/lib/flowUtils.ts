import { ethers } from "ethers";
import { toast } from "react-hot-toast";
import {
  AllowanceState,
  approveTokenAllowance,
  checkTokenAllowance,
  parseTokenAmount,
} from "./tokenUtils";
import { INTENT_TYPE } from "./types";

// Flow steps
export enum FlowStep {
  FORM = "form",
  CHECKING_ALLOWANCE = "checking_allowance",
  NEEDS_APPROVAL = "needs_approval",
  APPROVING = "approving",
  READY_TO_SIGN = "ready_to_sign",
  SIGNING = "signing",
}

export interface FormData {
  chainIn: number;
  chainOut: number;
  sellToken: string;
  sellAmount: string;
  buyToken: string;
  minBuyAmount: string;
  deadline: string;
  maxSlippage: number;
}

export interface FlowState {
  currentStep: FlowStep;
  allowanceState: AllowanceState;
  approvalTxHash: string;
  loading: boolean;
}

// Flow management class
export class IntentFlowManager {
  private setCurrentStep: (step: FlowStep) => void;
  private setAllowanceState: (
    state: AllowanceState | ((prev: AllowanceState) => AllowanceState)
  ) => void;
  private setApprovalTxHash: (hash: string) => void;
  private setLoading: (loading: boolean) => void;

  constructor(
    setCurrentStep: (step: FlowStep) => void,
    setAllowanceState: (
      state: AllowanceState | ((prev: AllowanceState) => AllowanceState)
    ) => void,
    setApprovalTxHash: (hash: string) => void,
    setLoading: (loading: boolean) => void
  ) {
    this.setCurrentStep = setCurrentStep;
    this.setAllowanceState = setAllowanceState;
    this.setApprovalTxHash = setApprovalTxHash;
    this.setLoading = setLoading;
  }

  // Reset flow state
  resetFlow(): void {
    this.setCurrentStep(FlowStep.FORM);
    this.setAllowanceState({
      currentAllowance: BigInt(0),
      requiredAmount: BigInt(0),
      hasEnoughAllowance: false,
      isLoading: false,
    });
    this.setApprovalTxHash("");
  }

  // Check allowance and update flow state
  async checkAllowance(
    account: string,
    tokenAddress: string,
    amount: string
  ): Promise<void> {
    this.setAllowanceState((prev) => ({
      ...prev,
      isLoading: true,
      error: undefined,
    }));

    const result = await checkTokenAllowance(account, tokenAddress, amount);
    this.setAllowanceState(result);

    if (result.error) {
      toast.error(result.error);
      this.setCurrentStep(FlowStep.FORM);
      return;
    }

    if (result.hasEnoughAllowance) {
      this.setCurrentStep(FlowStep.READY_TO_SIGN);
    } else {
      this.setCurrentStep(FlowStep.NEEDS_APPROVAL);
    }
  }

  // Approve token and update flow state
  async approveToken(
    tokenAddress: string,
    amount: string,
    signer: ethers.Signer
  ): Promise<void> {
    this.setCurrentStep(FlowStep.APPROVING);

    const result = await approveTokenAllowance(tokenAddress, amount, signer);

    if (result.success && result.txHash) {
      this.setApprovalTxHash(result.txHash);
      // Recheck allowance after approval
      const account = await signer.getAddress();
      await this.checkAllowance(account, tokenAddress, amount);
    } else {
      this.setCurrentStep(FlowStep.NEEDS_APPROVAL);
    }
  }

  // Execute intent signing and submission
  async executeIntent(
    account: string,
    formData: FormData,
    loadIntents: () => void,
    loadUserBalances: (address: string) => void
  ): Promise<void> {
    this.setCurrentStep(FlowStep.SIGNING);
    this.setLoading(true);

    try {
      if (!window.ethereum) {
        throw new Error("MetaMask not found");
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Get current network chain ID
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);

      // Create dynamic domain with current chain ID
      const dynamicDomain = {
        name: "CrossChainIntentPool",
        version: "1",
        chainId: currentChainId,
        verifyingContract:
          process.env.NEXT_PUBLIC_ZERO_ADDRESS ||
          "0x0000000000000000000000000000000000000000",
      };

      // Get user nonce from API
      const nonceResponse = await fetch(`/api/nonce/${account}`);
      const nonceData = await nonceResponse.json();
      const nonce = nonceData.nextNonce;

      const expiration =
        Math.floor(Date.now() / 1000) + parseInt(formData.deadline) * 3600;

      // Parse amounts with correct decimals for tokens on their respective chains
      let sellAmountParsed: bigint;
      let buyAmountParsed: bigint;

      // Only use parseTokenAmount for Ethereum tokens (chain 1)
      if (formData.chainIn === 1) {
        console.log(
          "Parsing sell token:",
          formData.sellToken,
          "Amount:",
          formData.sellAmount
        );
        sellAmountParsed = await parseTokenAmount(
          formData.sellAmount,
          formData.sellToken
        );
      } else {
        // For non-Ethereum chains, use parseEther as fallback (assuming 18 decimals)
        sellAmountParsed = ethers.parseEther(formData.sellAmount);
      }

      if (formData.chainOut === 1) {
        console.log(
          "Parsing buy token:",
          formData.buyToken,
          "Amount:",
          formData.minBuyAmount
        );
        buyAmountParsed = await parseTokenAmount(
          formData.minBuyAmount,
          formData.buyToken
        );
      } else {
        // For non-Ethereum chains, use parseEther as fallback (assuming 18 decimals)
        buyAmountParsed = ethers.parseEther(formData.minBuyAmount);
      }

      const intent = {
        sellToken: formData.sellToken,
        buyToken: formData.buyToken,
        amountIn: sellAmountParsed.toString(),
        minAmountOut: buyAmountParsed.toString(),
        chainIn: formData.chainIn,
        chainOut: formData.chainOut,
        expiration,
        maxSlippage: formData.maxSlippage,
        feeCap: ethers.parseEther("0.01").toString(), // Fee is always in ETH (18 decimals)
        nonce,
      };

      console.log(
        "wanting to sign:",
        "DOMAIN:",
        dynamicDomain,
        "INTENT_TYPE:",
        INTENT_TYPE,
        "intent:",
        intent
      );

      // Sign intent with dynamic domain
      const signature = await signer.signTypedData(
        dynamicDomain,
        INTENT_TYPE,
        intent
      );

      // Submit to API
      const response = await fetch("/api/intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent, signature }),
      });

      const result = await response.json();

      if (response.ok) {
        toast.success("🚀 Intent broadcasted to the grid!");
        this.resetFlow();
        loadIntents();
        await loadUserBalances(account);
        return; // Success, return the default form data reset
      } else {
        toast.error(result.error || "Failed to submit intent");
        this.setCurrentStep(FlowStep.FORM);
      }
    } catch (error) {
      console.error("Submit error:", error);
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ACTION_REJECTED"
      ) {
        toast.error("Transaction rejected by user");
      } else {
        toast.error("Failed to submit intent");
      }
      this.setCurrentStep(FlowStep.FORM);
    } finally {
      this.setLoading(false);
    }
  }
}

// Validate form data
export function validateFormData(formData: FormData): {
  valid: boolean;
  error?: string;
} {
  if (
    !formData.sellToken ||
    !formData.sellAmount ||
    !formData.buyToken ||
    !formData.minBuyAmount
  ) {
    return { valid: false, error: "Please fill in all required fields" };
  }

  // Validate amounts are positive numbers
  const sellAmount = parseFloat(formData.sellAmount);
  const buyAmount = parseFloat(formData.minBuyAmount);

  if (isNaN(sellAmount) || sellAmount <= 0) {
    return { valid: false, error: "Invalid sell amount" };
  }

  if (isNaN(buyAmount) || buyAmount <= 0) {
    return { valid: false, error: "Invalid buy amount" };
  }

  return { valid: true };
}

// Get default form data
export function getDefaultFormData(): FormData {
  return {
    chainIn: 1,
    chainOut: 1000,
    sellToken: "",
    sellAmount: "",
    buyToken: "",
    minBuyAmount: "",
    deadline: "1",
    maxSlippage: 100,
  };
}

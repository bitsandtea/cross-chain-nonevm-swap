import { IntentFlowManager } from "@/lib/flowUtils";
import { AllowanceState } from "@/lib/tokenUtils";
import { FlowStep } from "@/types/flow";
import { useEffect, useState } from "react";

export function useAllowance(
  account: string,
  sellToken: string,
  sellAmount: string
) {
  const [allowanceState, setAllowanceState] = useState<AllowanceState>({
    currentAllowance: BigInt(0),
    requiredAmount: BigInt(0),
    hasEnoughAllowance: false,
    isLoading: false,
  });
  const [approvalTxHash, setApprovalTxHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<FlowStep>(FlowStep.FORM);

  // Create flow manager instance
  const flowManager = new IntentFlowManager(
    setCurrentStep,
    setAllowanceState,
    setApprovalTxHash,
    setLoading
  );

  const checkAllowance = async () => {
    if (!account || !sellToken || !sellAmount) return;

    try {
      await flowManager.checkAllowance(account, sellToken, sellAmount);
    } catch (error) {
      console.error("Allowance check failed:", error);
    }
  };

  const approveToken = async (signer: any) => {
    if (!sellToken || !sellAmount) return;

    try {
      await flowManager.approveToken(sellToken, sellAmount, signer);
    } catch (error) {
      console.error("Token approval failed:", error);
      throw error;
    }
  };

  // Auto-check allowances when dependencies change
  useEffect(() => {
    const checkAllowanceAutomatically = async () => {
      if (account && sellToken && sellAmount && currentStep === FlowStep.FORM) {
        try {
          await checkAllowance();
        } catch (error) {
          console.error("Auto allowance check failed:", error);
        }
      }
    };

    // Debounce the allowance check to avoid excessive API calls
    const timeoutId = setTimeout(checkAllowanceAutomatically, 500);
    return () => clearTimeout(timeoutId);
  }, [account, sellToken, sellAmount, currentStep]);

  return {
    allowanceState,
    approvalTxHash,
    loading,
    currentStep,
    checkAllowance,
    approveToken,
    hasEnoughAllowance: allowanceState.hasEnoughAllowance,
  };
}

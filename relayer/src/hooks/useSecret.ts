import { generateSecret } from "@/lib/crypto";
import { FormData } from "@/types/flow";
import { useCallback, useState } from "react";

export function useSecret(formData: FormData) {
  const [secret, setSecret] = useState<string | null>(null);
  const [secretHash, setSecretHash] = useState<string | null>(null);

  const generateNewSecret = useCallback(() => {
    const { secret: newSecret, hash } = generateSecret();
    setSecret(newSecret);
    setSecretHash(hash);
    return { secret: newSecret, hash };
  }, []);

  const storeSecret = useCallback((secretToStore: string, hash: string) => {
    setSecret(secretToStore);
    setSecretHash(hash);

    // Store in sessionStorage for persistence
    if (typeof window !== "undefined") {
      sessionStorage.setItem("crossChainSecret", secretToStore);
      sessionStorage.setItem("crossChainSecretHash", hash);
    }
  }, []);

  const retrieveSecret = useCallback(() => {
    if (typeof window !== "undefined") {
      const storedSecret = sessionStorage.getItem("crossChainSecret");
      const storedHash = sessionStorage.getItem("crossChainSecretHash");

      if (storedSecret && storedHash) {
        setSecret(storedSecret);
        setSecretHash(storedHash);
        return { secret: storedSecret, hash: storedHash };
      }
    }
    return null;
  }, []);

  const clearSecret = useCallback(() => {
    setSecret(null);
    setSecretHash(null);

    if (typeof window !== "undefined") {
      sessionStorage.removeItem("crossChainSecret");
      sessionStorage.removeItem("crossChainSecretHash");
    }
  }, []);

  // Auto-generate secret for cross-chain orders if not present
  const ensureSecretForCrossChain = useCallback(() => {
    if (formData.chainIn !== formData.chainOut && !secret) {
      return generateNewSecret();
    }
    return { secret, hash: secretHash };
  }, [
    formData.chainIn,
    formData.chainOut,
    secret,
    secretHash,
    generateNewSecret,
  ]);

  return {
    secret,
    secretHash,
    generateSecret: generateNewSecret,
    storeSecret,
    retrieveSecret,
    clearSecret,
    ensureSecretForCrossChain,
  };
}

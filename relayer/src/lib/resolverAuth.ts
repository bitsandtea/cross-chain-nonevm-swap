/**
 * Resolver API Keys for Authentication
 * Simple authentication using predefined API keys
 */

export interface ResolverConfig {
  name: string;
  apiKey: string;
  address: string;
}

// Predefined resolver API keys
export const RESOLVER_API_KEYS: ResolverConfig[] = [
  {
    name: "Resolver 1",
    apiKey: "hackathon_api_key",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  },
  {
    name: "Resolver 2",
    apiKey: "hackathon_api_key",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  },
  {
    name: "Development Resolver",
    apiKey: "hackathon_api_key",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  },
];

/**
 * Validate resolver API key
 */
export function validateResolverApiKey(apiKey: string): {
  valid: boolean;
  resolver?: ResolverConfig;
  error?: string;
} {
  if (!apiKey) {
    return { valid: false, error: "API key is required" };
  }

  const resolver = RESOLVER_API_KEYS.find((r) => r.apiKey === apiKey);

  if (!resolver) {
    return { valid: false, error: "Invalid API key" };
  }

  return { valid: true, resolver };
}

/**
 * Get all valid API keys (for testing purposes)
 */
export function getValidApiKeys(): string[] {
  return RESOLVER_API_KEYS.map((r) => r.apiKey);
}

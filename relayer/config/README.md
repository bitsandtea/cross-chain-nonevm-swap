# Environment Configuration

This directory contains centralized environment variable validation and configuration for the cross-chain swap relayer.

## Files

- `env.ts` - Centralized environment validation and typed config exports
- `whitelist.ts` - Whitelist configuration

## Required Environment Variables

The application validates different environment variables based on runtime context:

### Browser Context (Always Required)

These `NEXT_PUBLIC_*` variables are required for client-side code:

- `NEXT_PUBLIC_RPC_URL` - RPC URL for Ethereum network
- `NEXT_PUBLIC_ETH_FACTORY_ADDRESS` - EscrowFactory contract address
- `NEXT_PUBLIC_RESOLVER_ADDRESS` - Resolver bot address
- `NEXT_PUBLIC_ONEINCH_TOKEN_ADDRESS` - 1INCH token address on EVM
- `NEXT_PUBLIC_USDC_ADDRESS` - USDC token address on EVM
- `NEXT_PUBLIC_USDC_APTOS_ADDRESS` - USDC address on Aptos

### Server Context (Additional Requirements)

These additional variables are required for server-side code:

- `CHAIN_ID` - Chain ID for the EVM network (server-only)
- `APTOS_RPC_URL` - RPC URL for Aptos network (server-only)

## Usage

The configuration is context-aware and validates environment variables based on where the code is running:

- **Browser**: Only validates `NEXT_PUBLIC_*` variables
- **Server**: Validates all variables (including server-only ones)

If any required environment variable is missing for the current context, the application will fail with a clear error message.

```typescript
import { ENV, USDC_ADDRESS, ETH_FACTORY_ADDRESS } from "../config/env";

// Use typed environment variables instead of process.env
const factoryAddress = ETH_FACTORY_ADDRESS;
const usdcAddress = USDC_ADDRESS;
```

## Key Benefits

1. **Fail Fast** - Application won't start with missing env vars for current context
2. **Type Safety** - All config values are typed
3. **Context Aware** - Validates different variables based on browser vs server runtime
4. **No Fallbacks** - Prevents production issues from missing config
5. **Centralized** - Single source of truth for all environment config
6. **Clear Errors** - Helpful error messages when config is missing

## Migration from Legacy Code

Replace all instances of:

```typescript
// ❌ OLD (with fallbacks)
const address = process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x...";

// ✅ NEW (centralized, no fallbacks)
import { USDC_ADDRESS } from "../config/env";
const address = USDC_ADDRESS;
```

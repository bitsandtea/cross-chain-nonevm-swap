# Cross-Chain Resolver

Off-chain resolver service for Fusion+ cross-chain atomic swaps. Monitors for profitable swap opportunities and executes them automatically.

## Overview

This resolver implements Phase 1 of the [resolver specification](../../research/implementation/resolver_both_phases.md):

1. **Profitability Check** - Fetches 1inch quotes and calculates net profit
2. **Balance Verification** - Ensures sufficient liquidity on both chains
3. **Order Parameter Assembly** - Generates secrets and order hashes
4. **Escrow Creation** - Creates paired escrows on source and destination chains

## Quick Start

### 1. Environment Setup

Copy the environment template:

```bash
cp .env.example .env
```

Configure your environment variables:

```bash
# Private Keys (REQUIRED)
RESOLVER_EVM_PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
RESOLVER_APTOS_PRIVATE_KEY=1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef

# Network RPC URLs (REQUIRED)
EVM_RPC_URL=https://eth-mainnet.alchemyapi.io/v2/YOUR_API_KEY
APTOS_RPC_URL=https://fullnode.mainnet.aptoslabs.com/v1

# 1inch API (REQUIRED)
ONEINCH_API_KEY=your_1inch_api_key_here

# Relayer API (REQUIRED)
RELAYER_API_URL=http://localhost:3000

# Optional Configuration
MIN_EVM_BALANCE=0.1
MIN_APTOS_BALANCE=1.0
MIN_PROFIT_THRESHOLD=0.001
```

### 2. Install Dependencies

```bash
pn install
```

### 3. Run the Resolver

Development mode:

```bash
pn dev
```

Production mode:

```bash
pn build
pn start
```

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   IntentMonitor │    │ ProfitAnalyzer  │    │  BalanceManager │
│                 │    │                 │    │                 │
│ - Poll relayer  │    │ - 1inch quotes  │    │ - EVM balances  │
│ - Queue intents │    │ - Gas estimates │    │ - Aptos balance │
│ - Update status │    │ - Profit calc   │    │ - Allowances    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │    Resolver     │
                    │                 │
                    │ - Orchestrates  │
                    │ - Makes decisions│
                    │ - Creates escrows│
                    └─────────────────┘
```

## Key Features

- **Automatic Intent Monitoring** - Polls the relayer API for new cross-chain swap intents
- **Profitability Analysis** - Uses 1inch API to calculate expected profits vs costs
- **Multi-Chain Balance Management** - Tracks EVM and Aptos balances and requirements
- **Concurrent Processing** - Handles multiple orders simultaneously (configurable limit)
- **Robust Error Handling** - Retries, timeouts, and graceful degradation
- **Comprehensive Logging** - Winston-based logging with file and console output

## Configuration

### Private Keys

The resolver requires separate private keys for each chain:

- **EVM**: Standard `0x`-prefixed 64-character hex string
- **Aptos**: 64-character hex string (no `0x` prefix)

### Balance Requirements

Ensure your wallets have sufficient funds:

- **EVM**: Native tokens (ETH) for gas + destination tokens for swaps
- **Aptos**: APT for gas + safety deposits + source tokens

### Profit Thresholds

Configure minimum profit requirements to avoid unprofitable trades:

- `MIN_PROFIT_THRESHOLD` - Minimum profit in ETH equivalent (default: 0.001)

## API Integration

### Relayer API

The resolver expects the relayer API to provide:

```typescript
GET /api/intents
{
  "intents": [
    {
      "id": "intent_123",
      "fusionOrder": { /* FusionPlusOrder */ },
      "signature": "0x...",
      "nonce": 123,
      "status": "pending",
      "createdAt": 1234567890,
      "updatedAt": 1234567890
    }
  ]
}

PATCH /api/intents/:id
{
  "status": "processing|completed|failed",
  // additional metadata
}
```

### 1inch API

Requires a valid 1inch API key for fetching swap quotes:

- Sign up at https://portal.1inch.io/
- Add your API key to `ONEINCH_API_KEY`

## Development

### Project Structure

```
src/
├── config/          # Configuration management
├── lib/             # Utility functions
├── services/        # Core services
│   ├── IntentMonitor.ts
│   ├── ProfitabilityAnalyzer.ts
│   ├── BalanceManager.ts
│   └── Logger.ts
├── types/           # TypeScript definitions
└── index.ts         # Main resolver class
```

### Adding New Features

1. **New Service**: Add to `src/services/`
2. **New Types**: Add to `src/types/index.ts`
3. **Configuration**: Update `src/config/index.ts`
4. **Integration**: Wire into `src/index.ts`

### Testing

```bash
pn test
```

### Linting

```bash
pn lint
```

## Monitoring

The resolver provides health status and metrics:

```bash
# Check status endpoint (if implemented)
curl http://localhost:8080/health

# Monitor logs
tail -f resolver.log
```

## Troubleshooting

### Common Issues

1. **Insufficient Balance**

   - Check wallet balances on both chains
   - Verify `MIN_EVM_BALANCE` and `MIN_APTOS_BALANCE` settings

2. **API Connection Errors**

   - Verify RPC URLs are accessible
   - Check 1inch API key validity
   - Ensure relayer service is running

3. **Private Key Issues**
   - Verify key format (EVM vs Aptos)
   - Check wallet derivation
   - Ensure keys have proper permissions

### Debug Mode

Enable debug logging:

```bash
LOG_LEVEL=debug pn dev
```

## Security

- **Never commit private keys** to version control
- **Use environment variables** for sensitive configuration
- **Secure your RPC endpoints** with API keys
- **Monitor wallet balances** regularly
- **Set appropriate profit thresholds** to avoid MEV attacks

## Next Steps

For production deployment:

1. Implement actual escrow contract calls
2. Add more sophisticated gas estimation
3. Implement Merkle tree support for partial fills
4. Add monitoring and alerting
5. Set up automated balance management
6. Implement circuit breakers for risk management

## License

MIT

# Cross-Chain Fusion+ Swap Relayer

A cross-chain atomic swap relayer implementation following the 1inch Fusion+ specification. This relayer enables secure, decentralized cross-chain token swaps between Ethereum and Aptos using Dutch auctions and atomic swap mechanics.

## Features

### Core Fusion+ Implementation

- **FusionPlusOrder**: Complete 1inch Fusion+ order structure support
- **Cross-chain swaps**: Ethereum ↔ Aptos with extensible architecture
- **Dutch auctions**: Competitive price discovery with configurable decay
- **Atomic swaps**: HTLC-based escrow system with safety deposits
- **Partial fills**: Merkle tree-based partial order execution

### Security & Validation

- **Timelock sequences**: Multi-stage timelock protection
- **Secret management**: SDK-based secret generation and hashing
- **Address validation**: Chain-specific address format validation
- **Signature verification**: EIP-712 typed data signatures
- **Resolver whitelisting**: KYC/KYB verified resolver network

## API Endpoints

### Intent Management

- `POST /api/intents` - Create new Fusion+ intent
- `GET /api/intents` - List intents with filtering
- `GET /api/intents/{id}` - Get specific intent details

### Supporting Services

- `GET /api/prices` - Token price data
- `GET /api/nonce/{address}` - User nonce for signatures
- `GET /api/auctions` - Active auction data
- `GET /api/escrows` - Escrow contract information

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm package manager
- MetaMask wallet

### Installation

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### Environment Setup

Create `.env.local` with required configuration:

```bash
# RPC URLs
NEXT_PUBLIC_RPC_URL=http://localhost:8545
NEXT_PUBLIC_APTOS_RPC_URL=https://api.testnet.aptoslabs.com

# Contract addresses
NEXT_PUBLIC_ETH_FACTORY_ADDRESS=0x...
NEXT_PUBLIC_APTOS_FACTORY_ADDRESS=0x...

# Token addresses (see config/whitelist.ts)
NEXT_PUBLIC_USDC_ADDRESS=0x...
NEXT_PUBLIC_WETH_ADDRESS=0x...
```

## Usage

### Creating Cross-Chain Swaps

1. **Connect wallet** to source chain (Ethereum)
2. **Select tokens** and amounts for swap
3. **Configure auction** (fixed price or Dutch auction)
4. **Set destination address** for receiving tokens on target chain
5. **Sign and broadcast** intent to relayer network

### Order Structure

```typescript
interface FusionPlusOrder {
  // Core swap parameters
  makerAsset: string; // Source token address
  takerAsset: string; // Destination token address
  makingAmount: string; // Amount being sold
  takingAmount: string; // Amount being bought
  maker: string; // Order creator address

  // Cross-chain parameters
  srcChain: number; // Source chain ID
  dstChain: number; // Destination chain ID

  // Auction configuration
  auctionStartTime: number; // When auction begins
  auctionDuration: number; // How long auction runs
  startRate: string; // Initial price (Dutch auction)
  endRate: string; // Final price (Dutch auction)

  // Atomic swap parameters
  secretHash: string; // HTLC secret hash
  srcEscrowTarget: string; // Withdrawal address on source chain
  dstEscrowTarget: string; // Withdrawal address on destination chain

  // Security parameters
  srcTimelock: number; // Source chain timelock
  dstTimelock: number; // Destination chain timelock
  finalityLock: number; // Chain reorganization protection
  srcSafetyDeposit: string; // Source chain safety deposit
  dstSafetyDeposit: string; // Destination chain safety deposit

  // Partial fill support
  fillThresholds: number[]; // [25, 50, 75, 100]
  secretTree?: string; // Merkle root of partial secrets

  // Order metadata
  salt: string; // Uniqueness salt
  expiration: number; // Order expiration timestamp
}
```

## Architecture

### Components

- **Frontend**: Next.js React interface for order creation
- **API Layer**: REST endpoints for intent management
- **Database**: JSON file storage with LowDB
- **Validation**: Order structure and security validation
- **Secret Management**: 1inch SDK integration for HTLC
- **Price Service**: Token pricing and auction mechanics

### Security Model

- Orders signed with EIP-712 typed signatures
- Multi-stage timelock protection prevents fund loss
- Resolver whitelisting ensures trusted execution
- Chain-specific address validation
- Safety deposits incentivize proper execution

## Development

### Project Structure

```
src/
├── app/
│   ├── api/           # API endpoints
│   └── page.tsx       # Main UI interface
├── lib/
│   ├── types.ts       # FusionPlusOrder interfaces
│   ├── validation.ts  # Order validation logic
│   ├── flowUtils.ts   # Order creation flow
│   ├── secretUtils.ts # HTLC secret management
│   ├── merkleUtils.ts # Partial fill Merkle trees
│   └── database.ts    # Data persistence
└── config/
    └── whitelist.ts   # Token/resolver whitelists
```

### Adding New Chains

1. Add chain configuration to `tokenMapping.ts`
2. Update address validation in `flowUtils.ts`
3. Add RPC endpoints and contract addresses
4. Update whitelist configuration

## Testing

Testing framework setup required. Install Jest or similar:

```bash
pnpm add -D jest @types/jest
```

Run validation tests:

```bash
pnpm test
```

## References

- [1inch Fusion+ Whitepaper](https://docs.1inch.io/docs/fusion-plus/)
- [1inch Cross-Chain SDK](https://github.com/1inch/cross-chain-sdk)
- [Atomic Swap Specification](https://en.bitcoin.it/wiki/Atomic_swap)
- [EIP-712 Typed Data](https://eips.ethereum.org/EIPS/eip-712)

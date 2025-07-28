# Cross-Chain Intent Pool Setup

## Quick Start

1. **Install Dependencies**

   ```bash
   npm install
   ```

2. **Environment Setup**

   ```bash
   cp .env.example .env.local
   ```

3. **Configure Environment Variables** (Optional)

   ```bash
   # For real-time prices (optional - mock prices used as fallback)
   ONEINCH_API_KEY=your_1inch_api_key_here

   # Token addresses (automatically set from deployment)
   NEXT_PUBLIC_ONEINCH_TOKEN_ADDRESS=0x5fbdb2315678afecb367f032d93f642f64180aa3
   NEXT_PUBLIC_USDC_ADDRESS=0xe7f1725e7734ce288f8367e1bb143e90bb3f0512
   # ... (see .env.example for full list)
   ```

4. **Start Development Server**

   ```bash
   npm run dev
   ```

5. **Open in Browser**
   ```
   http://localhost:3000
   ```

## Features

### 🎨 **Cyberpunk UI**

- Futuristic terminal-style interface
- Neon colors and glowing effects
- Real-time status indicators

### 💰 **Real-Time Pricing**

- Live token prices from 1inch API
- Mock price fallback for development
- USD value calculations

### 🏦 **Balance Integration**

- Real-time wallet balance checking
- Multi-token balance display
- USD value calculations

### 🔗 **Cross-Chain Support**

- Ethereum ↔ Aptos swapping
- Intent-based trading
- Neural link wallet connection

## Price Service

The application automatically fetches real-time prices from the 1inch API and falls back to mock prices when unavailable. No API key required for development.

**Mock Prices:**

- 1INCH: $0.45
- USDC: $1.00
- AAVE: $89.50
- WETH: $2,650.00
- UNI: $8.75

## API Endpoints

- `GET /api/prices?tokens=addr1,addr2&action=prices` - Multiple token prices
- `GET /api/prices?token=addr&action=single` - Single token price
- `GET /api/intents` - List trading intents
- `POST /api/intents` - Create new intent

## Development

The system is designed to work seamlessly in development mode with:

- Mock prices when API unavailable
- Local token address mapping
- Fallback error handling
- Responsive cyberpunk UI

For production deployment, add a valid 1inch API key for real-time pricing.

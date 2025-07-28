# Price Service Documentation

This document explains how to use the price service that integrates with the [1inch API](https://portal.1inch.dev/documentation/apis/spot-price/quick-start) to fetch real-time token prices.

## Overview

The price service maps local development token addresses to their mainnet counterparts and fetches real-time prices from the 1inch API. This allows the cross-chain swap system to work with realistic pricing data even when using local development tokens.

## Setup

### 1. Environment Variables

Add the following to your `.env.local` file:

```bash
ONEINCH_API_KEY=your_1inch_api_key_here
```

You can get an API key from [1inch Developer Portal](https://portal.1inch.dev/).

**Note:** If no API key is provided or the API is unavailable, the system will automatically fall back to mock prices for development purposes.

### 2. Mock Pricing Fallback

When the 1inch API is unavailable or returns errors, the system automatically provides realistic mock prices:

- **1INCH**: $0.45
- **USDC**: $1.00
- **AAVE**: $89.50
- **WETH**: $2,650.00
- **UNI**: $8.75
- **DAI**: $1.00

This ensures the application continues to work seamlessly during development even without a valid API key.

### 3. Token Mappings

The system automatically maps local token addresses to mainnet addresses:

| Local Token | Mainnet Address                              | Symbol |
| ----------- | -------------------------------------------- | ------ |
| Local 1INCH | `0x111111111117dc0aa78b770fa6a738034120c302` | 1INCH  |
| Local USDC  | `0xA0b86a33E6441446414C632C6ab3b73bD3Cc6F22` | USDC   |
| Local AAVE  | `0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9` | AAVE   |
| Local WETH  | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | WETH   |
| Local UNI   | `0x1f9840a85d5af5bf1d1762f925bdaddc4201f984` | UNI    |

## API Usage

### 1. Get Multiple Token Prices

```bash
GET /api/prices?tokens=address1,address2,address3&action=prices
```

**Response:**

```json
{
  "prices": {
    "0x5fbdb2315678afecb367f032d93f642f64180aa3": "0.45123",
    "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512": "1.0001"
  }
}
```

### 2. Get Single Token Price

```bash
GET /api/prices?token=0x5fbdb2315678afecb367f032d93f642f64180aa3&action=single
```

**Response:**

```json
{
  "token": "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  "price": "0.45123"
}
```

### 3. Get Swap Quote

```bash
GET /api/prices?src=address1&dst=address2&amount=1000000000000000000&action=quote
```

**Response:**

```json
{
  "quote": {
    "dstAmount": "2245123000000000000",
    "srcToken": {
      "address": "0x111111111117dc0aa78b770fa6a738034120c302",
      "symbol": "1INCH",
      "name": "1inch Token",
      "decimals": 18
    },
    "dstToken": {
      "address": "0xA0b86a33E6441446414C632C6ab3b73bD3Cc6F22",
      "symbol": "USDC",
      "name": "USD Coin",
      "decimals": 6
    }
  }
}
```

### 4. Calculate USD Value

```bash
GET /api/prices?token=address&amount=1000000000000000000&action=usd
```

**Response:**

```json
{
  "token": "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  "amount": "1000000000000000000",
  "usdValue": 0.45123
}
```

### 5. Get Price Ratio

```bash
GET /api/prices?token1=address1&token2=address2&action=ratio
```

**Response:**

```json
{
  "token1": "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  "token2": "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
  "ratio": 0.451
}
```

## JavaScript/TypeScript Usage

### Import the Service

```typescript
import {
  getTokenPrices,
  getTokenPrice,
  calculateUSDValue,
  getPriceRatio,
  getSwapQuote,
} from "@/lib/priceService";
```

### Get Token Prices

```typescript
// Get multiple token prices
const tokens = [
  "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
];
const prices = await getTokenPrices(tokens);
console.log(prices); // { "0x5fb...": "0.45", "0xe7f...": "1.00" }

// Get single token price
const price = await getTokenPrice("0x5fbdb2315678afecb367f032d93f642f64180aa3");
console.log(`Price: $${price}`);
```

### Calculate USD Values

```typescript
// Calculate USD value of 1 token (in wei)
const usdValue = await calculateUSDValue(
  "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  "1000000000000000000" // 1 token in wei
);
console.log(`USD Value: $${usdValue.toFixed(2)}`);
```

### Get Swap Quotes

```typescript
const quote = await getSwapQuote({
  srcToken: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  dstToken: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
  amount: "1000000000000000000", // 1 token in wei
});
console.log(`You'll receive: ${quote.dstAmount}`);
```

## Token Mapping Utilities

### Get Mainnet Address

```typescript
import { getMainnetAddress } from "@/lib/tokenMapping";

const mainnetAddr = getMainnetAddress(
  "0x5fbdb2315678afecb367f032d93f642f64180aa3"
);
console.log(mainnetAddr); // "0x111111111117dc0aa78b770fa6a738034120c302"
```

### Get Token Information

```typescript
import { getTokenInfo, getAllTokens } from "@/lib/tokenMapping";

// Get info for specific token
const tokenInfo = getTokenInfo("0x5fbdb2315678afecb367f032d93f642f64180aa3");
console.log(tokenInfo?.symbol); // "1INCH"

// Get all supported tokens
const allTokens = getAllTokens();
console.log(allTokens);
```

## Testing

### Run Price Service Tests

```bash
npx ts-node scripts/test-prices.ts
```

This will test:

- Token mapping functionality
- Price fetching for multiple tokens
- Single token price fetching
- USD value calculations
- Price ratios

### Manual Testing via API

```bash
# Test with curl
curl "http://localhost:3000/api/prices?tokens=0x5fbdb2315678afecb367f032d93f642f64180aa3&action=prices"
```

## Error Handling

The service includes comprehensive error handling for:

- **Missing API Key**: Falls back to working without authentication (with rate limits)
- **Invalid Token Addresses**: Returns appropriate error messages
- **Network Issues**: Proper error propagation with meaningful messages
- **Rate Limiting**: Clear error messages about API limits

## Rate Limits

The 1inch API has rate limits:

- **Without API Key**: 1 request per second
- **With API Key**: Higher limits based on your plan

Always include your API key for production usage.

## Integration with Intent Pool

The price service integrates seamlessly with the intent pool system:

1. **Intent Validation**: Prices are used to validate that intent amounts are reasonable
2. **Market Making**: Automated market makers can use real-time prices
3. **Fee Calculation**: Dynamic fees based on token values
4. **UI Display**: Show USD values alongside token amounts

## Security Considerations

- **API Key Protection**: Store API keys in environment variables, never in code
- **Rate Limiting**: Implement client-side rate limiting to avoid API limits
- **Error Handling**: Don't expose internal errors to client applications
- **Data Validation**: Always validate addresses and amounts before API calls

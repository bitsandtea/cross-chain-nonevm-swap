# Token Utility Tasks

This file defines Hardhat tasks to interact with ERC20 tokens for checking balances, allowances, and setting approvals.

## Usage

The tasks are automatically available when you run Hardhat. You can see them with:

```bash
npx hardhat
```

## Available Tasks

### 1. Check Token Balance

```bash
npx hardhat token:balance --token <token_address> --address <user_address> --network localhost
```

hardh token:balance --token 0xe7f1725e7734ce288f8367e1bb143e90bb3f0512 --address 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --network localhost

**Example:**

```bash
npx hardhat token:balance --token 0xe7f1725e7734ce288f8367e1bb143e90bb3f0512 --address 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --network localhost
```

### 2. Check Token Allowance

```bash
npx hardhat token:allowance --token <token_address> --owner <owner_address> --spender <spender_address> --network localhost
```

**Example:**

```bash
npx hardhat token:allowance --token 0xe7f1725e7734ce288f8367e1bb143e90bb3f0512 --owner 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --spender 0x5fc8d32690cc91d4c39d9d3abcbd16989f875707 --network localhost
```

### 3. Approve Token Allowance

```bash
npx hardhat token:approve --token <token_address> --spender <spender_address> --amount <amount> --network localhost
```

**Example:**

```bash
npx hardhat token:approve --token 0xe7f1725e7734ce288f8367e1bb143e90bb3f0512 --spender 0x5fc8d32690cc91d4c39d9d3abcbd16989f875707 --amount 100 --network localhost
```

## Notes

- The script automatically detects the correct contract type (OneInchToken, USDCoin, AaveToken, etc.)
- For `approve` method, the current signer must be the token owner
- Amounts are specified in token units (not wei)
- The script will wait for transaction confirmation and verify the new allowance

## Common Token Addresses (Local Development)

After running `deploy-escrow-factory.ts`, you'll get addresses like:

- 1INCH Token: `0x5fbdb2315678afecb367f032d93f642f64180aa3`
- USDC: `0xe7f1725e7734ce288f8367e1bb143e90bb3f0512`
- AAVE: `0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0`
- WETH: `0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9`
- UNI: `0xdc64a140aa3e981100a9beca4e685f962f0cf6c9`

## Common User Addresses (Hardhat Default)

- Account #0: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- Account #1: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- Account #2: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`

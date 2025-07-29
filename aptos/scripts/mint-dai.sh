#!/bin/bash
set -e

# Default profile name
PROFILE="default"

# Parse command-line arguments
while [ "$1" != "" ]; do
    case $1 in
        --profile)
            shift
            PROFILE=$1
            ;;
        *)
            echo "Usage: $0 --profile <PROFILE_NAME>"
            echo "Example: $0 --profile default"
            exit 1
            ;;
    esac
    shift
done

echo "🚀 Minting additional DAI tokens..."

# Get account address
ACCOUNT_ADDR=$(aptos account list --profile "$PROFILE" | grep -o '"0x[a-fA-F0-9]*"' | head -n 1 | tr -d '"')
echo "Account address: $ACCOUNT_ADDR"

# Module ID
MODULE_ID="$ACCOUNT_ADDR::dai_coin"

# Mint 1,000,000 DAI (1,000,000 * 10^6 = 1,000,000,000,000 units)
echo "▶️ Minting 1,000,000 DAI to your account..."
echo "Amount in units: 1,000,000,000,000 (1,000,000 DAI * 10^6 decimals)"

aptos move run --profile "$PROFILE" --function-id "$MODULE_ID::mint" --args "address:$ACCOUNT_ADDR" "u64:1000000000000"

echo "✅ Minting complete!"
echo "🔗 View your account: https://explorer.aptoslabs.com/account/$ACCOUNT_ADDR?network=testnet" 
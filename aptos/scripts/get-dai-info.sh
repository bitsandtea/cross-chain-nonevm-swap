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

echo "🔍 Getting DAI token information..."

# Get account address
ACCOUNT_ADDR=$(aptos account list --profile "$PROFILE" | grep -o '"0x[a-fA-F0-9]*"' | head -n 1 | tr -d '"')
echo "Account address: $ACCOUNT_ADDR"

# DAI token address (this is the full address of the DAI token)
DAI_TOKEN_ADDR="$ACCOUNT_ADDR::dai_coin::DAI"
echo "DAI Token Address: $DAI_TOKEN_ADDR"

# Get DAI coin info
echo ""
echo "📊 DAI Coin Information:"
aptos account list --profile "$PROFILE" --query "resources" | grep -A 10 "CoinInfo.*DAI" || echo "DAI coin info not found"

# Get your DAI balance
echo ""
echo "💰 Your DAI Balance:"
aptos account list --profile "$PROFILE" --query "resources" | grep -A 5 "CoinStore.*DAI" || echo "DAI balance not found"

echo ""
echo "🔗 Explorer Links:"
echo "Account: https://explorer.aptoslabs.com/account/$ACCOUNT_ADDR?network=testnet"
echo "Module: https://explorer.aptoslabs.com/module/$ACCOUNT_ADDR/dai_coin?network=testnet" 
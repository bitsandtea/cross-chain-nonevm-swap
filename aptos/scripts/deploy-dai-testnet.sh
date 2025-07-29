#!/bin/bash

# Deploy DAI coin to Aptos testnet
# Prerequisites: aptos CLI installed and configured

set -e

echo "🚀 Deploying DAI coin to Aptos testnet..."

# Check if aptos CLI is installed
if ! command -v aptos &> /dev/null; then
    echo "❌ aptos CLI not found. Please install it first:"
    echo "curl -fsSL \"https://aptos.dev/scripts/install_cli.py\" | python3"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "Move.toml" ]; then
    echo "❌ Move.toml not found. Please run this script from the aptos directory."
    exit 1
fi

# Set network to testnet
echo "📡 Setting network to testnet..."
aptos init --profile testnet --network testnet --assume-yes

# Compile the module
echo "🔨 Compiling Move module..."
aptos move compile --named-addresses my_first_module=0x42

# Deploy to testnet
echo "📦 Deploying module to testnet..."
aptos move publish --named-addresses my_first_module=0x42 --profile testnet

# Initialize the DAI coin
echo "🏁 Initializing DAI coin..."
aptos move run --function-id '0x42::dai_coin::initialize' --profile testnet

# Register the account for DAI
echo "📝 Registering account for DAI..."
aptos move run --function-id '0x42::dai_coin::register' --profile testnet

# Mint DAI tokens to the owner (1 DAI = 1000000 with 6 decimals)
echo "💰 Minting 1 DAI to owner..."
aptos move run \
    --function-id '0x42::dai_coin::mint' \
    --args address:$(aptos account list --profile testnet --query account --output table | grep -o '0x[a-fA-F0-9]*' | head -1) u64:1000000 \
    --profile testnet

# Check the balance
echo "📊 Checking DAI balance..."
aptos account list --profile testnet

echo "✅ DAI deployment completed successfully!"
echo "🔗 View your account on testnet explorer: https://explorer.aptoslabs.com/account/$(aptos account list --profile testnet --query account --output table | grep -o '0x[a-fA-F0-9]*' | head -1)?network=testnet" 
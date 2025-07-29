#!/bin/bash
set -e

# Default profile name, can be overridden with --profile flag
PROFILE="default"

# --- Helper Functions ---
function check_aptos_cli() {
    if ! command -v aptos &> /dev/null; then
        echo "❌ aptos CLI not found. Please install it first:"
        echo "https://aptos.dev/cli-tools/aptos-cli/install-aptos-cli"
        exit 1
    fi
}

# --- Main Script ---

# 1. Parse command-line arguments to get the profile name
while [ "$1" != "" ]; do
    case $1 in
        --profile)
            shift
            PROFILE=$1
            ;;
        *)
            echo "Usage: $0 --profile <PROFILE_NAME>"
            echo "Example: $0 --profile petra"
            exit 1
            ;;
    esac
    shift
done

echo "🚀 Starting DAI coin deployment using profile: '$PROFILE'"
check_aptos_cli

# 2. Get the account address from the specified profile
echo "🔍 Looking up account address for profile '$PROFILE'..."
ACCOUNT_ADDR=$(aptos account list --profile "$PROFILE" | grep -o '"0x[a-fA-F0-9]*"' | head -n 1 | tr -d '"')

if [ -z "$ACCOUNT_ADDR" ]; then
    echo "❌ Could not find an account for profile '$PROFILE'."
    echo "Please ensure the profile is configured correctly."
    echo "You can set it up by running: aptos init --profile $PROFILE"
    exit 1
fi
echo "✅ Found account address: $ACCOUNT_ADDR"

# 3. Create a temporary, isolated directory for deployment
TEMP_DIR=$(mktemp -d)
# Ensure the temp directory is cleaned up on script exit
trap 'echo "📁 Cleaning up temporary directory..."; rm -rf -- "$TEMP_DIR"' EXIT

echo "📁 Created temporary directory for deployment: $TEMP_DIR"

# 4. Prepare files for the isolated deployment
mkdir -p "$TEMP_DIR/sources"
mkdir -p "$TEMP_DIR/.aptos"
cp "sources/dai_coin.move" "$TEMP_DIR/sources/"
cp ".aptos/config.yaml" "$TEMP_DIR/.aptos/"

# Create a minimal Move.toml to define a new, unique package
cat > "$TEMP_DIR/Move.toml" << EOF
[package]
name = "dai_deployment_package"
version = "1.0.0"

[addresses]
# This is a placeholder; the CLI will use the deployer's address from the profile
dai_deployer_addr = "_"

[dependencies.AptosFramework]
git = "https://github.com/aptos-labs/aptos-framework.git"
rev = "testnet"
subdir = "aptos-framework"
EOF

# Update the module definition in the copied file to use the new address name
# This avoids clashes with any 'my_first_module' on other accounts
sed -i.bak "s/my_first_module::dai_coin/dai_deployer_addr::dai_coin/" "$TEMP_DIR/sources/dai_coin.move"
echo "✅ Prepared isolated files for deployment."

# 5. Compile and publish from the isolated environment
# The subshell `( ... )` ensures we 'cd' back automatically
(
    cd "$TEMP_DIR"
    echo "🔨 Compiling module..."
    aptos move compile --named-addresses dai_deployer_addr="$ACCOUNT_ADDR"
    
    echo "📦 Publishing module to address $ACCOUNT_ADDR..."
    aptos move publish --profile "$PROFILE" --named-addresses dai_deployer_addr="$ACCOUNT_ADDR"
)
echo "✅ Module published successfully!"

# 6. Interact with the newly deployed module
MODULE_ID="$ACCOUNT_ADDR::dai_coin"
echo "🎉 Module deployed with ID: $MODULE_ID"

echo "▶️ Initializing DAI coin..."
aptos move run --profile "$PROFILE" --function-id "$MODULE_ID::initialize"

echo "▶️ Registering your account for DAI..."
aptos move run --profile "$PROFILE" --function-id "$MODULE_ID::register"

echo "▶️ Minting 1,000,000 DAI to your account..."
# 1,000,000 DAI * 10^6 decimals = 1,000,000,000,000 units
aptos move run --profile "$PROFILE" --function-id "$MODULE_ID::mint" --args "address:$ACCOUNT_ADDR" "u64:1000000000000"

echo "📊 Checking final balance..."
aptos account list --profile "$PROFILE"

echo "✅ Deployment complete!"
echo "🔗 View your account on the explorer: https://explorer.aptoslabs.com/account/$ACCOUNT_ADDR?network=testnet" 
import { AptosAccount, AptosClient } from "aptos";

const TESTNET_URL = "https://fullnode.testnet.aptoslabs.com/v1";
const MODULE_ADDRESS = "0x42"; // Your module address from Move.toml

async function deployDAIToTestnet() {
  // Initialize Aptos client
  const client = new AptosClient(TESTNET_URL);

  // Create account from private key (you'll need to set this)
  const privateKeyHex = process.env.APTOS_PRIVATE_KEY;
  if (!privateKeyHex) {
    throw new Error("Please set APTOS_PRIVATE_KEY environment variable");
  }

  const privateKeyBytes = new Uint8Array(
    Buffer.from(privateKeyHex.replace("0x", ""), "hex")
  );
  const account = new AptosAccount(privateKeyBytes);

  console.log(`Deploying from address: ${account.address()}`);

  try {
    // Check account balance
    const balance = await client.getAccountBalance(account.address());
    console.log(`Account balance: ${balance.total} octas`);

    // Compile and deploy the module
    console.log("Compiling Move module...");
    const compiledModules = await client.compileMoveModules({
      address: MODULE_ADDRESS,
      modules: [
        {
          name: "dai_coin",
          source: `
module my_first_module::dai_coin {
    use std::signer;
    use std::string;
    use std::option;
    use aptos_framework::managed_coin;
    use aptos_framework::coin;

    /// DAI coin type
    struct DAI {}

    /// Initialize DAI coin - only callable once by deployer
    public entry fun initialize(account: &signer) {
        let name = b"DAI Stablecoin";
        let symbol = b"DAI";
        let decimals = 6;
        let monitor_supply = true;

        managed_coin::initialize<DAI>(
            account,
            name,
            symbol,
            decimals,
            monitor_supply,
        );
    }

    /// Mint DAI tokens - only callable by deployer  
    public entry fun mint(
        account: &signer,
        to: address,
        amount: u64,
    ) {
        managed_coin::mint<DAI>(account, to, amount);
    }

    /// Burn DAI tokens - only callable by deployer
    public entry fun burn(
        account: &signer,
        amount: u64,
    ) {
        managed_coin::burn<DAI>(account, amount);
    }

    /// Get DAI supply
    #[view]
    public fun get_supply(): u128 {
        let supply_option = coin::supply<DAI>();
        if (option::is_some(&supply_option)) {
            *option::borrow(&supply_option)
        } else {
            0u128
        }
    }

    /// Register DAI for an account
    public entry fun register(account: &signer) {
        managed_coin::register<DAI>(account);
    }
}
          `,
        },
      ],
    });

    console.log("Module compiled successfully");

    // Deploy the module
    console.log("Deploying module to testnet...");
    const deployTxn = await client.publishPackage(account, compiledModules, {
      maxGasAmount: 1000000,
      gasUnitPrice: 100,
      expireTimestamp: Math.floor(Date.now() / 1000) + 600, // 10 minutes
    });

    console.log(`Deployment transaction hash: ${deployTxn.hash}`);
    await client.waitForTransaction(deployTxn.hash);
    console.log("Module deployed successfully!");

    // Initialize the DAI coin
    console.log("Initializing DAI coin...");
    const initPayload = {
      function: `${MODULE_ADDRESS}::dai_coin::initialize`,
      type_arguments: [],
      arguments: [],
    };

    const initTxn = await client.generateSignSubmitTransaction(
      account,
      initPayload,
      {
        maxGasAmount: 1000000,
        gasUnitPrice: 100,
        expireTimestamp: Math.floor(Date.now() / 1000) + 600,
      }
    );

    console.log(`Initialization transaction hash: ${initTxn.hash}`);
    await client.waitForTransaction(initTxn.hash);
    console.log("DAI coin initialized successfully!");

    // Register the account for DAI
    console.log("Registering account for DAI...");
    const registerPayload = {
      function: `${MODULE_ADDRESS}::dai_coin::register`,
      type_arguments: [],
      arguments: [],
    };

    const registerTxn = await client.generateSignSubmitTransaction(
      account,
      registerPayload,
      {
        maxGasAmount: 1000000,
        gasUnitPrice: 100,
        expireTimestamp: Math.floor(Date.now() / 1000) + 600,
      }
    );

    console.log(`Registration transaction hash: ${registerTxn.hash}`);
    await client.waitForTransaction(registerTxn.hash);
    console.log("Account registered for DAI!");

    // Mint DAI tokens to the owner
    const mintAmount = 1000000; // 1 DAI (with 6 decimals)
    console.log(`Minting ${mintAmount} DAI tokens to owner...`);

    const mintPayload = {
      function: `${MODULE_ADDRESS}::dai_coin::mint`,
      type_arguments: [],
      arguments: [account.address().toString(), mintAmount.toString()],
    };

    const mintTxn = await client.generateSignSubmitTransaction(
      account,
      mintPayload,
      {
        maxGasAmount: 1000000,
        gasUnitPrice: 100,
        expireTimestamp: Math.floor(Date.now() / 1000) + 600,
      }
    );

    console.log(`Mint transaction hash: ${mintTxn.hash}`);
    await client.waitForTransaction(mintTxn.hash);
    console.log("DAI tokens minted successfully!");

    // Check the balance
    const daiBalance = await client.getAccountResource(
      account.address(),
      `${MODULE_ADDRESS}::coin::CoinStore<${MODULE_ADDRESS}::dai_coin::DAI>`
    );

    console.log(`DAI balance: ${daiBalance.data.coin.value}`);
    console.log("Deployment completed successfully!");
  } catch (error) {
    console.error("Error during deployment:", error);
    throw error;
  }
}

// Run the deployment
if (require.main === module) {
  deployDAIToTestnet()
    .then(() => {
      console.log("Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

export { deployDAIToTestnet };

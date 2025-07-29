module my_first_module::dai_coin {
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
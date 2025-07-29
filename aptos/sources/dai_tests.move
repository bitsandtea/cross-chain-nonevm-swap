#[test_only]
module my_first_module::dai_tests {
    use std::signer;
    use aptos_framework::coin;
    use aptos_framework::aptos_coin;
    use my_first_module::dai_coin::{Self, DAI};

    #[test(aptos_framework = @0x1, admin = @my_first_module)]
    public fun test_dai_initialize(aptos_framework: &signer, admin: &signer) {
        // Initialize coin conversion map for testing
        aptos_coin::ensure_initialized_with_apt_fa_metadata_for_test();
        
        // Initialize the DAI coin
        dai_coin::initialize(admin);
        
        // Verify that the coin type exists by checking if we can register it
        dai_coin::register(admin);
        
        // Check that the account is now registered for DAI
        assert!(coin::is_account_registered<DAI>(signer::address_of(admin)), 1);
    }

    #[test(aptos_framework = @0x1, admin = @my_first_module, user = @0x123)]
    public fun test_dai_mint_and_burn(aptos_framework: &signer, admin: &signer, user: &signer) {
        // Initialize coin conversion map for testing
        aptos_coin::ensure_initialized_with_apt_fa_metadata_for_test();
        let user_addr = signer::address_of(user);
        
        // Initialize DAI
        dai_coin::initialize(admin);
        
        // Register admin and user for DAI
        dai_coin::register(admin);
        dai_coin::register(user);
        
        // Mint 1000 DAI to user
        let mint_amount = 1000u64;
        dai_coin::mint(admin, user_addr, mint_amount);
        
        // Check balance
        assert!(coin::balance<DAI>(user_addr) == mint_amount, 2);
        
        // Burn 300 DAI from user - admin burns from their own account
        let burn_amount = 300u64;
        // First transfer to admin, then burn
        coin::transfer<DAI>(user, signer::address_of(admin), burn_amount);
        dai_coin::burn(admin, burn_amount);
        
        // Check remaining balance
        assert!(coin::balance<DAI>(user_addr) == mint_amount - burn_amount, 3);
    }

    #[test(aptos_framework = @0x1, admin = @my_first_module, user1 = @0x123, user2 = @0x456)]
    public fun test_dai_transfer(aptos_framework: &signer, admin: &signer, user1: &signer, user2: &signer) {
        // Initialize coin conversion map for testing
        aptos_coin::ensure_initialized_with_apt_fa_metadata_for_test();
        
        let user1_addr = signer::address_of(user1);
        let user2_addr = signer::address_of(user2);
        
        // Initialize DAI
        dai_coin::initialize(admin);
        
        // Register both users
        dai_coin::register(user1);
        dai_coin::register(user2);
        
        // Mint DAI to user1
        let initial_amount = 500u64;
        dai_coin::mint(admin, user1_addr, initial_amount);
        
        // Transfer from user1 to user2
        let transfer_amount = 200u64;
        coin::transfer<DAI>(user1, user2_addr, transfer_amount);
        
        // Check balances
        assert!(coin::balance<DAI>(user1_addr) == initial_amount - transfer_amount, 4);
        assert!(coin::balance<DAI>(user2_addr) == transfer_amount, 5);
    }

    #[test(aptos_framework = @0x1, admin = @my_first_module)]
    #[expected_failure(abort_code = 0x80002, location = aptos_framework::coin)]
    public fun test_dai_double_initialize_fails(aptos_framework: &signer, admin: &signer) {
        // Initialize coin conversion map for testing
        aptos_coin::ensure_initialized_with_apt_fa_metadata_for_test();
        
        // Initialize DAI first time - should succeed
        dai_coin::initialize(admin);
        
        // Try to initialize again - should fail
        dai_coin::initialize(admin);
    }

    #[test(aptos_framework = @0x1, admin = @my_first_module, user = @0x123)]
    public fun test_dai_supply_tracking(aptos_framework: &signer, admin: &signer, user: &signer) {
        // Initialize coin conversion map for testing
        aptos_coin::ensure_initialized_with_apt_fa_metadata_for_test();
        
        let user_addr = signer::address_of(user);
        
        // Initialize DAI
        dai_coin::initialize(admin);
        
        // Initial supply should be 0
        assert!(dai_coin::get_supply() == 0u128, 1);
        
        // Register user for DAI
        dai_coin::register(user);
        
        // Mint 1000 DAI to user
        let mint_amount = 1000u64;
        dai_coin::mint(admin, user_addr, mint_amount);
        
        // Supply should now be 1000
        assert!(dai_coin::get_supply() == (mint_amount as u128), 2);
        
        // Register admin and burn some
        dai_coin::register(admin);
        let burn_amount = 300u64;
        coin::transfer<DAI>(user, signer::address_of(admin), burn_amount);
        dai_coin::burn(admin, burn_amount);
        
        // Supply should be reduced
        assert!(dai_coin::get_supply() == ((mint_amount - burn_amount) as u128), 3);
    }
} 
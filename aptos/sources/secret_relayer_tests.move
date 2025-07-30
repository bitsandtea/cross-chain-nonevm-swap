#[test_only]
module cross_chain_escrow::secret_relayer_tests {
    use std::signer;
    use std::vector;
    use std::hash;
    use aptos_framework::timestamp;

    use cross_chain_escrow::secret_relayer;
    use cross_chain_escrow::escrow;
    use cross_chain_escrow::dai_coin::{Self, DAI};

    // Test constants
    const TEST_AMOUNT: u64 = 1000;
    const TEST_SAFETY_DEPOSIT: u64 = 100;

    #[test(admin = @cross_chain_escrow, relayer = @0x123, maker = @0x456, taker = @0x789)]
    public fun test_secret_sharing_with_local_validation(
        admin: &signer,
        relayer: &signer,
        maker: &signer,
        taker: &signer
    ) {
        // Setup: Initialize DAI and secret relayer
        dai_coin::initialize(admin);
        secret_relayer::initialize(admin);

        // Add relayer to authorized list
        let relayer_addr = signer::address_of(relayer);
        secret_relayer::add_relayer(admin, relayer_addr);

        // Prepare escrow parameters
        let maker_addr = signer::address_of(maker);
        let taker_addr = signer::address_of(taker);
        let secret = b"test_secret_for_atomic_swap_demo";
        let hashlock = hash::sha2_256(secret);
        
        // Create timelocks with STAGE_FINALITY in the past (simulating finality passed)
        let current_time = timestamp::now_seconds();
        let finality_time = current_time - 100; // Finality already passed
        let timelocks = vector::empty<u64>();
        vector::push_back(&mut timelocks, finality_time); // STAGE_FINALITY
        vector::push_back(&mut timelocks, current_time + 3600); // STAGE_SRC_WITHDRAWAL
        vector::push_back(&mut timelocks, current_time + 7200); // STAGE_SRC_PUBLIC_WITHDRAWAL
        vector::push_back(&mut timelocks, current_time + 10800); // STAGE_SRC_CANCELLATION
        vector::push_back(&mut timelocks, current_time + 14400); // STAGE_SRC_PUBLIC_CANCELLATION

        // Register accounts for DAI
        dai_coin::register(maker);
        dai_coin::register(taker);

        // Mint DAI for testing
        dai_coin::mint(admin, maker_addr, TEST_AMOUNT + TEST_SAFETY_DEPOSIT);
        dai_coin::mint(admin, taker_addr, TEST_AMOUNT + TEST_SAFETY_DEPOSIT);

        // Create local escrow on Aptos (for this test, assuming it's the source chain)
        let merkle_root = vector::empty<u8>();
        let parts = 1u8;
        
        escrow::create_escrow<DAI>(
            maker,
            maker_addr,
            taker_addr,
            TEST_AMOUNT,
            TEST_SAFETY_DEPOSIT,
            hashlock,
            timelocks,
            true, // is_src (this Aptos escrow is the source)
            merkle_root,
            parts
        );

        // Note: In real cross-chain scenario, the destination escrow would be on another chain
        // and the off-chain relayer would verify both chains before calling emit_secret_shared

        // Compute order hash for verification
        let order_hash = escrow::compute_order_hash_from_info(
            maker_addr,
            taker_addr,
            escrow::get_escrow_token_type(maker_addr),
            TEST_AMOUNT,
            hashlock,
            timelocks,
            true
        );

        // Test: Secret sharing should succeed when local validation passes
        // (Off-chain relayer is trusted to have done cross-chain verification)
        secret_relayer::emit_secret_shared(
            relayer,
            signer::address_of(admin),
            maker_addr, // local_escrow_addr (source escrow on Aptos)
            order_hash,
            0u8 // part_idx
        );

        // Test passed if no abort occurred - local escrow validation succeeded
    }

    #[test(admin = @cross_chain_escrow, relayer = @0x123)]
    #[expected_failure(abort_code = 1, location = cross_chain_escrow::secret_relayer)]
    public fun test_unauthorized_relayer_fails(admin: &signer, relayer: &signer) {
        // Setup
        secret_relayer::initialize(admin);
        
        // Note: Not adding relayer to authorized list
        let dummy_order_hash = vector::empty<u8>();
        
        // Attempt to emit secret without authorization - should fail
        secret_relayer::emit_secret_shared(
            relayer,
            signer::address_of(admin),
            @0x999, // dummy escrow address
            dummy_order_hash,
            0u8
        );
    }

    #[test(admin = @cross_chain_escrow, relayer = @0x123)]
    #[expected_failure(abort_code = 1, location = cross_chain_escrow::secret_relayer)]
    public fun test_nonexistent_escrow_fails(admin: &signer, relayer: &signer) {
        // Test that secret sharing fails with non-existent escrow address
        
        secret_relayer::initialize(admin);
        secret_relayer::add_relayer(admin, signer::address_of(relayer));
        
        let dummy_order_hash = vector::empty<u8>();
        secret_relayer::emit_secret_shared(
            relayer,
            signer::address_of(admin),
            @0x999, // non-existent escrow address will trigger validation failure
            dummy_order_hash,
            0u8
        );
    }

    #[test(admin = @cross_chain_escrow)]
    public fun test_relayer_management(admin: &signer) {
        let relayer1 = @0x123;
        let relayer2 = @0x456;
        
        // Initialize
        secret_relayer::initialize(admin);
        
        // Add relayers
        secret_relayer::add_relayer(admin, relayer1);
        secret_relayer::add_relayer(admin, relayer2);
        
        // Verify they're authorized
        assert!(secret_relayer::is_authorized_relayer(signer::address_of(admin), relayer1), 1);
        assert!(secret_relayer::is_authorized_relayer(signer::address_of(admin), relayer2), 2);
        
        // Remove one relayer
        secret_relayer::remove_relayer(admin, relayer1);
        
        // Verify removal
        assert!(!secret_relayer::is_authorized_relayer(signer::address_of(admin), relayer1), 3);
        assert!(secret_relayer::is_authorized_relayer(signer::address_of(admin), relayer2), 4);
        
        // Check authorized relayers list
        let authorized = secret_relayer::get_authorized_relayers(signer::address_of(admin));
        assert!(vector::length(&authorized) == 1, 5);
        assert!(*vector::borrow(&authorized, 0) == relayer2, 6);
    }
} 
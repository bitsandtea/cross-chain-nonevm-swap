module my_first_module::secret_relayer {
    use std::signer;
    use std::event;
    use std::vector;
    use aptos_framework::timestamp;
    use my_first_module::escrow;

    /// Error codes
    const E_UNAUTHORIZED: u64 = 1;

    /// Relayer authority resource - only the deployer can create and manage relayers
    struct RelayerAuthority has key {
        authorized_relayers: vector<address>,
    }

    #[event]
    struct SecretSharedEvent has drop, store {
        order_hash: vector<u8>,
        part_idx: u8,
    }

    /// Initialize relayer authority - only callable once by deployer
    public entry fun initialize(account: &signer) {
        let relayer_authority = RelayerAuthority {
            authorized_relayers: vector::empty<address>(),
        };
        move_to(account, relayer_authority);
    }

    /// Add authorized relayer - only callable by deployer
    public entry fun add_relayer(
        admin: &signer,
        relayer: address,
    ) acquires RelayerAuthority {
        let admin_addr = signer::address_of(admin);
        assert!(exists<RelayerAuthority>(admin_addr), E_UNAUTHORIZED);
        
        let authority = borrow_global_mut<RelayerAuthority>(admin_addr);
        vector::push_back(&mut authority.authorized_relayers, relayer);
    }

    /// Remove authorized relayer - only callable by deployer
    public entry fun remove_relayer(
        admin: &signer,
        relayer: address,
    ) acquires RelayerAuthority {
        let admin_addr = signer::address_of(admin);
        assert!(exists<RelayerAuthority>(admin_addr), E_UNAUTHORIZED);
        
        let authority = borrow_global_mut<RelayerAuthority>(admin_addr);
        let (found, index) = vector::index_of(&authority.authorized_relayers, &relayer);
        if (found) {
            vector::remove(&mut authority.authorized_relayers, index);
        };
    }

    /// Emit secret shared event - only callable by authorized relayers
    /// Validates local escrow state and trusts off-chain relayer for cross-chain verification
    public entry fun emit_secret_shared(
        relayer: &signer,
        admin: address,
        local_escrow_addr: address,
        order_hash: vector<u8>,
        part_idx: u8,
    ) acquires RelayerAuthority {
        let relayer_addr = signer::address_of(relayer);
        assert!(exists<RelayerAuthority>(admin), E_UNAUTHORIZED);
        
        let authority = borrow_global<RelayerAuthority>(admin);
        let (found, _) = vector::index_of(&authority.authorized_relayers, &relayer_addr);
        assert!(found, E_UNAUTHORIZED);

        // 1. Verify local escrow exists
        assert!(escrow::escrow_exists(local_escrow_addr), E_UNAUTHORIZED);

        // 2. Get local escrow info
        let (maker, taker, amount, hashlock, timelocks, claimed, cancelled, is_src, _) = 
            escrow::get_escrow_info(local_escrow_addr);

        // 3. Verify escrow is not already finalized
        assert!(!claimed && !cancelled, E_UNAUTHORIZED);

        // 4. Verify local escrow has passed STAGE_FINALITY timelock
        let current_time = timestamp::now_seconds();
        let finality_deadline = *vector::borrow(&timelocks, 0); // STAGE_FINALITY = 0
        assert!(current_time >= finality_deadline, E_UNAUTHORIZED);

        // 5. Verify order hash matches local escrow (prevents replay attacks)
        let recomputed_hash = escrow::compute_order_hash_from_info(
            maker,
            taker,
            escrow::get_escrow_token_type(local_escrow_addr),
            amount,
            hashlock,
            timelocks,
            is_src
        );
        assert!(recomputed_hash == order_hash, E_UNAUTHORIZED);

        // 6. Verify safety deposit exists (incentive mechanism)
        let safety_deposit = escrow::get_escrow_safety_deposit(local_escrow_addr);
        assert!(safety_deposit > 0, E_UNAUTHORIZED);

        // Note: Off-chain relayer is trusted to have verified:
        // - Cross-chain escrow existence and consistency
        // - Cross-chain finality timing
        // - Hashlock matching between chains
        // - Order validity across both chains

        // Emit the secret shared event
        event::emit(SecretSharedEvent {
            order_hash,
            part_idx,
        });
    }

    #[view]
    public fun is_authorized_relayer(admin: address, relayer: address): bool acquires RelayerAuthority {
        if (!exists<RelayerAuthority>(admin)) {
            return false
        };
        
        let authority = borrow_global<RelayerAuthority>(admin);
        let (found, _) = vector::index_of(&authority.authorized_relayers, &relayer);
        found
    }

    #[view]
    public fun get_authorized_relayers(admin: address): vector<address> acquires RelayerAuthority {
        assert!(exists<RelayerAuthority>(admin), E_UNAUTHORIZED);
        let authority = borrow_global<RelayerAuthority>(admin);
        authority.authorized_relayers
    }
} 
module my_first_module::escrow {
    use std::signer;
    use std::vector;
    use std::event;
    use std::type_info::{Self, TypeInfo};
    use std::hash;
    use aptos_std::bcs;
    use aptos_framework::timestamp;
    use aptos_framework::account;
    use aptos_framework::coin;
    use aptos_framework::managed_coin;

    // Error codes
    const E_ALREADY_FINALIZED: u64 = 1;
    const E_STAGE_NOT_REACHED: u64 = 2;
    const E_STAGE_EXPIRED: u64 = 3;
    const E_INVALID_PREIMAGE: u64 = 4;
    const E_UNAUTHORIZED: u64 = 5;
    const E_ESCROW_NOT_EXISTS: u64 = 6;
    const E_INVALID_AMOUNT: u64 = 7;
    const E_INSUFFICIENT_BALANCE: u64 = 8;
    const E_INVALID_MERKLE_PROOF: u64 = 9;
    const E_PART_ALREADY_USED: u64 = 10;
    const E_UNREGISTERED_COIN: u64 = 11;

    // Stage constants
    const STAGE_FINALITY: u8 = 0;
    const STAGE_SRC_WITHDRAWAL: u8 = 1;
    const STAGE_SRC_PUBLIC_WITHDRAWAL: u8 = 2;
    const STAGE_SRC_CANCELLATION: u8 = 3;
    const STAGE_SRC_PUBLIC_CANCELLATION: u8 = 4;

    /// Hash of immutable order parameters
    struct OrderHash has copy, drop, store {
        value: vector<u8>,
    }

    /// SHA-256(secret) committed during escrow creation
    struct HashLock has copy, drop, store {
        value: vector<u8>,
    }

    /// Resource account info for holding funds
    struct ResourceInfo has key {
        source: address,
        resource_cap: account::SignerCapability,
    }

    /// Main escrow state
    struct Escrow has key, drop {
        maker: address,
        taker: address,
        token_type: TypeInfo,
        amount: u64,
        safety_deposit: u64,
        hashlock: HashLock,
        timelocks: vector<u64>,
        claimed: bool,
        cancelled: bool,
        is_src: bool,
        vault_address: address,
        merkle_root: vector<u8>,
        parts: u8,
        used_parts: vector<bool>,
    }

    #[event]
    struct EscrowCreatedEvent has drop, store {
        order_hash: vector<u8>,
        maker: address,
        taker: address,
        token_type: TypeInfo,
        amount: u64,
        hashlock: vector<u8>,
        timelocks: vector<u64>,
        is_src: bool,
        vault_address: address,
        merkle_root: vector<u8>,
        parts: u8,
    }

    #[event]
    struct FundsClaimedEvent has drop, store {
        order_hash: vector<u8>,
        preimage: vector<u8>,
        recipient: address,
        amount: u64,
        merkle_root: vector<u8>,
        parts: u8,
    }

    #[event]
    struct FundsRefundedEvent has drop, store {
        order_hash: vector<u8>,
        sender: address,
        amount: u64,
        merkle_root: vector<u8>,
        parts: u8,
    }

    #[event]
    struct SecretSharedEvent has drop, store {
        order_hash: vector<u8>,
        part_idx: u8,
    }

    #[event]
    struct SafetyDepositClaimedEvent has drop, store {
        order_hash: vector<u8>,
        executor: address,
        amount: u64,
    }

    /// Factory: Create new escrow
    public entry fun create_escrow<CoinType>(
        account: &signer,
        maker: address,
        taker: address,
        amount: u64,
        safety_deposit: u64,
        hashlock: vector<u8>,
        timelocks: vector<u64>,
        is_src: bool,
        merkle_root: vector<u8>,
        parts: u8,
    ) {
        assert!(amount > 0, E_INVALID_AMOUNT);
        assert!(safety_deposit > 0, E_INVALID_AMOUNT);
        assert!(vector::length(&hashlock) == 32, E_INVALID_PREIMAGE);
        assert!(vector::length(&timelocks) == 5, E_STAGE_EXPIRED);

        let account_addr = signer::address_of(account);
        let token_type = type_info::type_of<CoinType>();
        
        // Compute order hash for deterministic vault creation
        let order_hash_data = vector::empty<u8>();
        vector::append(&mut order_hash_data, bcs::to_bytes(&maker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&taker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&token_type));
        vector::append(&mut order_hash_data, bcs::to_bytes(&amount));
        vector::append(&mut order_hash_data, hashlock);
        vector::append(&mut order_hash_data, bcs::to_bytes(&timelocks));
        vector::append(&mut order_hash_data, bcs::to_bytes(&is_src));
        
        let order_hash = hash::sha3_256(order_hash_data);
        let hashlock_struct = HashLock { value: hashlock };

        // Create resource account for holding funds
        let (vault, vault_signer_cap) = account::create_resource_account(account, order_hash);
        let vault_addr = signer::address_of(&vault);
        let resource_account_from_cap = account::create_signer_with_capability(&vault_signer_cap);
        
        // Store resource info in vault
        move_to<ResourceInfo>(&resource_account_from_cap, ResourceInfo {
            resource_cap: vault_signer_cap,
            source: account_addr,
        });

        // Validate that the creator has the coin type registered
        assert!(coin::is_account_registered<CoinType>(account_addr), E_UNREGISTERED_COIN);
        
        // Register coin type for vault and transfer funds + safety deposit to vault
        managed_coin::register<CoinType>(&vault);
        let total_amount = amount + safety_deposit;
        assert!(coin::balance<CoinType>(account_addr) >= total_amount, E_INSUFFICIENT_BALANCE);
        coin::transfer<CoinType>(account, vault_addr, total_amount);

        // Initialize used_parts bitmap based on number of parts
        let used_parts = vector::empty<bool>();
        let i = 0;
        while (i < parts) {
            vector::push_back(&mut used_parts, false);
            i = i + 1;
        };

        // Create escrow resource
        let escrow = Escrow {
            maker,
            taker,
            token_type,
            amount,
            safety_deposit,
            hashlock: hashlock_struct,
            timelocks,
            claimed: false,
            cancelled: false,
            is_src,
            vault_address: vault_addr,
            merkle_root,
            parts,
            used_parts,
        };

        // Store escrow resource
        move_to(account, escrow);

        // Emit event
        event::emit(EscrowCreatedEvent {
            order_hash,
            maker,
            taker,
            token_type,
            amount,
            hashlock,
            timelocks,
            is_src,
            vault_address: vault_addr,
            merkle_root,
            parts,
        });
    }

    /// Withdraw funds with preimage (private) - mirrors EVM logic
    public entry fun withdraw<CoinType>(
        account: &signer,
        escrow_addr: address,
        preimage: vector<u8>,
        merkle_proof: vector<vector<u8>>,
        fill_index: u8,
    ) acquires Escrow, ResourceInfo {
        let account_addr = signer::address_of(account);
        assert!(exists<Escrow>(escrow_addr), E_ESCROW_NOT_EXISTS);
        
        let escrow_ref = borrow_global_mut<Escrow>(escrow_addr);
        assert!(!escrow_ref.claimed && !escrow_ref.cancelled, E_ALREADY_FINALIZED);
        
        // Verify preimage
        let computed_hash = hash::sha2_256(preimage);
        assert!(computed_hash == escrow_ref.hashlock.value, E_INVALID_PREIMAGE);
        
        // Verify partial fill if using Merkle tree
        if (escrow_ref.parts > 1) {
            assert!((fill_index as u64) < (escrow_ref.parts as u64), E_INVALID_AMOUNT);
            assert!(!*vector::borrow(&escrow_ref.used_parts, (fill_index as u64)), E_PART_ALREADY_USED);
            
            // Verify Merkle proof: sha2_256(secret) is the leaf
            let leaf = hash::sha2_256(preimage);
            assert!(verify_merkle_proof(leaf, merkle_proof, (fill_index as u64), escrow_ref.merkle_root), E_INVALID_MERKLE_PROOF);
            
            // Mark this part as used
            *vector::borrow_mut(&mut escrow_ref.used_parts, (fill_index as u64)) = true;
        };
        
        // Mark as claimed and get needed values before moving vault_info
        escrow_ref.claimed = true;
        let recipient = if (escrow_ref.is_src) {
            // EscrowSrc: only taker can withdraw, tokens go to taker
            assert!(account_addr == escrow_ref.taker, E_UNAUTHORIZED);
            escrow_ref.taker
        } else {
            // EscrowDst: only taker can withdraw, tokens go to maker  
            assert!(account_addr == escrow_ref.taker, E_UNAUTHORIZED);
            escrow_ref.maker
        };
        
        // Check authorization and timing
        let current_time = timestamp::now_seconds();
        assert!(current_time >= *vector::borrow(&escrow_ref.timelocks, (STAGE_SRC_WITHDRAWAL as u64)), E_STAGE_NOT_REACHED);
        assert!(current_time < *vector::borrow(&escrow_ref.timelocks, (STAGE_SRC_CANCELLATION as u64)), E_STAGE_EXPIRED);

        // Get values needed for operations
        let amount = escrow_ref.amount;
        let safety_deposit = escrow_ref.safety_deposit;
        let vault_address = escrow_ref.vault_address;
        
        // Transfer funds from vault - amount to recipient, safety deposit back to resolver
        let vault_info = move_from<ResourceInfo>(vault_address);
        let resource_account_from_cap = account::create_signer_with_capability(&vault_info.resource_cap);
        
        // Transfer the swap amount to recipient
        coin::transfer<CoinType>(&resource_account_from_cap, recipient, amount);
        
        // Compute order hash for event (needed for SafetyDepositClaimedEvent)
        let order_hash_data = vector::empty<u8>();
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.maker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.taker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.token_type));
        vector::append(&mut order_hash_data, bcs::to_bytes(&amount));
        vector::append(&mut order_hash_data, escrow_ref.hashlock.value);
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.timelocks));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.is_src));
        let order_hash = hash::sha3_256(order_hash_data);
        
        // Return safety deposit to resolver (original escrow creator)
        if (safety_deposit > 0) {
            coin::transfer<CoinType>(&resource_account_from_cap, vault_info.source, safety_deposit);
            
            // Emit safety deposit claimed event
            event::emit(SafetyDepositClaimedEvent {
                order_hash,
                executor: vault_info.source,
                amount: safety_deposit,
            });
        };

        // Emit event
        event::emit(FundsClaimedEvent {
            order_hash,
            preimage,
            recipient,
            amount,
            merkle_root: escrow_ref.merkle_root,
            parts: escrow_ref.parts,
        });

        // Clean up capability
        let ResourceInfo { source: _, resource_cap: _ } = vault_info;
    }

    /// Cancel escrow (private) - mirrors EVM logic
    public entry fun cancel<CoinType>(
        account: &signer,
        escrow_addr: address,
    ) acquires Escrow, ResourceInfo {
        let account_addr = signer::address_of(account);
        assert!(exists<Escrow>(escrow_addr), E_ESCROW_NOT_EXISTS);
        
        let escrow_ref = borrow_global_mut<Escrow>(escrow_addr);
        assert!(!escrow_ref.claimed && !escrow_ref.cancelled, E_ALREADY_FINALIZED);
        
        // Mark as cancelled
        escrow_ref.cancelled = true;
        
        // Check authorization and timing
        let current_time = timestamp::now_seconds();
        let refund_recipient = if (escrow_ref.is_src) {
            // EscrowSrc: only taker can cancel, tokens go back to maker
            assert!(account_addr == escrow_ref.taker, E_UNAUTHORIZED);
            escrow_ref.maker
        } else {
            // EscrowDst: only taker can cancel, tokens go back to taker
            assert!(account_addr == escrow_ref.taker, E_UNAUTHORIZED);
            escrow_ref.taker
        };
        
        assert!(current_time >= *vector::borrow(&escrow_ref.timelocks, (STAGE_SRC_CANCELLATION as u64)), E_STAGE_NOT_REACHED);

        // Get values needed for operations
        let amount = escrow_ref.amount;
        let safety_deposit = escrow_ref.safety_deposit;
        let vault_address = escrow_ref.vault_address;

        // Transfer funds from vault - amount back to refund recipient, safety deposit back to resolver
        let vault_info = move_from<ResourceInfo>(vault_address);
        let resource_account_from_cap = account::create_signer_with_capability(&vault_info.resource_cap);
        
        // Refund the swap amount
        coin::transfer<CoinType>(&resource_account_from_cap, refund_recipient, amount);
        
        // Return safety deposit to resolver (original escrow creator)
        if (safety_deposit > 0) {
            coin::transfer<CoinType>(&resource_account_from_cap, vault_info.source, safety_deposit);
        };

        // Compute order hash for event
        let order_hash_data = vector::empty<u8>();
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.maker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.taker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.token_type));
        vector::append(&mut order_hash_data, bcs::to_bytes(&amount));
        vector::append(&mut order_hash_data, escrow_ref.hashlock.value);
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.timelocks));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.is_src));
        let order_hash = hash::sha3_256(order_hash_data);

        // Emit event
        event::emit(FundsRefundedEvent {
            order_hash,
            sender: refund_recipient,
            amount,
            merkle_root: vector::empty<u8>(),
            parts: 0,
        });

        // Clean up capability
        let ResourceInfo { source: _, resource_cap: _ } = vault_info;
    }

    /// Public withdraw with preimage (for relayer)
    public entry fun public_withdraw<CoinType>(
        _account: &signer,
        escrow_addr: address,
        preimage: vector<u8>,
        merkle_proof: vector<vector<u8>>,
        fill_index: u8,
    ) acquires Escrow, ResourceInfo {
        assert!(exists<Escrow>(escrow_addr), E_ESCROW_NOT_EXISTS);
        
        let escrow_ref = borrow_global_mut<Escrow>(escrow_addr);
        assert!(!escrow_ref.claimed && !escrow_ref.cancelled, E_ALREADY_FINALIZED);
        
        // Verify preimage
        let computed_hash = hash::sha2_256(preimage);
        assert!(computed_hash == escrow_ref.hashlock.value, E_INVALID_PREIMAGE);
        
        // Verify partial fill if using Merkle tree
        if (escrow_ref.parts > 1) {
            assert!((fill_index as u64) < (escrow_ref.parts as u64), E_INVALID_AMOUNT);
            assert!(!*vector::borrow(&escrow_ref.used_parts, (fill_index as u64)), E_PART_ALREADY_USED);
            
            // Verify Merkle proof: sha2_256(secret) is the leaf
            let leaf = hash::sha2_256(preimage);
            assert!(verify_merkle_proof(leaf, merkle_proof, (fill_index as u64), escrow_ref.merkle_root), E_INVALID_MERKLE_PROOF);
            
            // Mark this part as used
            *vector::borrow_mut(&mut escrow_ref.used_parts, (fill_index as u64)) = true;
        };
        
        // Mark as claimed and get needed values
        escrow_ref.claimed = true;
        
        // Check timing for public withdrawal
        let current_time = timestamp::now_seconds();
        assert!(current_time >= *vector::borrow(&escrow_ref.timelocks, (STAGE_SRC_PUBLIC_WITHDRAWAL as u64)), E_STAGE_NOT_REACHED);
        assert!(current_time < *vector::borrow(&escrow_ref.timelocks, (STAGE_SRC_PUBLIC_CANCELLATION as u64)), E_STAGE_EXPIRED);

        // Determine recipient based on escrow type (same logic as private withdraw)
        let recipient = if (escrow_ref.is_src) { escrow_ref.taker } else { escrow_ref.maker };

        // Get values needed for operations
        let amount = escrow_ref.amount;
        let safety_deposit = escrow_ref.safety_deposit;
        let vault_address = escrow_ref.vault_address;

        // Transfer funds from vault - amount to recipient, safety deposit to executor
        let vault_info = move_from<ResourceInfo>(vault_address);
        let resource_account_from_cap = account::create_signer_with_capability(&vault_info.resource_cap);
        let executor = signer::address_of(_account);
        
        // Transfer the swap amount to recipient
        coin::transfer<CoinType>(&resource_account_from_cap, recipient, amount);
        
        // Compute order hash for event (needed for SafetyDepositClaimedEvent)
        let order_hash_data = vector::empty<u8>();
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.maker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.taker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.token_type));
        vector::append(&mut order_hash_data, bcs::to_bytes(&amount));
        vector::append(&mut order_hash_data, escrow_ref.hashlock.value);
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.timelocks));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow_ref.is_src));
        let order_hash = hash::sha3_256(order_hash_data);
        
        // Award safety deposit to executor as incentive for public execution
        if (safety_deposit > 0) {
            coin::transfer<CoinType>(&resource_account_from_cap, executor, safety_deposit);
            
            // Emit safety deposit claimed event
            event::emit(SafetyDepositClaimedEvent {
                order_hash,
                executor,
                amount: safety_deposit,
            });
        };

        // Emit event
        event::emit(FundsClaimedEvent {
            order_hash,
            preimage,
            recipient,
            amount,
            merkle_root: vector::empty<u8>(),
            parts: 0,
        });

        // Clean up capability
        let ResourceInfo { source: _, resource_cap: _ } = vault_info;
    }

    /// Public cancel (for relayer) - only available on SRC chain
    public entry fun public_cancel<CoinType>(
        _account: &signer,
        escrow_addr: address,
    ) acquires Escrow, ResourceInfo {
        assert!(exists<Escrow>(escrow_addr), E_ESCROW_NOT_EXISTS);
        
        let escrow = move_from<Escrow>(escrow_addr);
        assert!(!escrow.claimed && !escrow.cancelled, E_ALREADY_FINALIZED);
        assert!(escrow.is_src, E_UNAUTHORIZED); // Only available on SRC chain like EVM
        
        // Check timing for public cancellation
        let current_time = timestamp::now_seconds();
        assert!(current_time >= *vector::borrow(&escrow.timelocks, (STAGE_SRC_PUBLIC_CANCELLATION as u64)), E_STAGE_NOT_REACHED);

        // On SRC chain: refund to maker, safety deposit to executor
        let refund_recipient = escrow.maker;
        let executor = signer::address_of(_account);

        // Transfer funds from vault
        let vault_info = move_from<ResourceInfo>(escrow.vault_address);
        let resource_account_from_cap = account::create_signer_with_capability(&vault_info.resource_cap);
        
        // Refund the swap amount to maker
        coin::transfer<CoinType>(&resource_account_from_cap, refund_recipient, escrow.amount);
        
        // Compute order hash for event (needed for SafetyDepositClaimedEvent)
        let order_hash_data = vector::empty<u8>();
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow.maker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow.taker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow.token_type));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow.amount));
        vector::append(&mut order_hash_data, escrow.hashlock.value);
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow.timelocks));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow.is_src));
        let computed_order_hash = hash::sha3_256(order_hash_data);
        
        // Award safety deposit to executor as incentive for public cancellation
        if (escrow.safety_deposit > 0) {
            coin::transfer<CoinType>(&resource_account_from_cap, executor, escrow.safety_deposit);
            
            // Emit safety deposit claimed event
            event::emit(SafetyDepositClaimedEvent {
                order_hash: computed_order_hash,
                executor,
                amount: escrow.safety_deposit,
            });
        };

        // Compute order hash for event
        let order_hash_data = vector::empty<u8>();
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow.maker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow.taker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow.token_type));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow.amount));
        vector::append(&mut order_hash_data, escrow.hashlock.value);
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow.timelocks));
        vector::append(&mut order_hash_data, bcs::to_bytes(&escrow.is_src));
        let order_hash = hash::sha3_256(order_hash_data);

        // Emit event
        event::emit(FundsRefundedEvent {
            order_hash,
            sender: refund_recipient,
            amount: escrow.amount,
            merkle_root: escrow.merkle_root,
            parts: escrow.parts,
        });

        // Clean up capability
        let ResourceInfo { source: _, resource_cap: _ } = vault_info;
    }

    #[view]
    public fun get_escrow_info(escrow_addr: address): (address, address, u64, vector<u8>, vector<u64>, bool, bool, bool, address) acquires Escrow {
        assert!(exists<Escrow>(escrow_addr), E_ESCROW_NOT_EXISTS);
        let escrow = borrow_global<Escrow>(escrow_addr);
        (escrow.maker, escrow.taker, escrow.amount, escrow.hashlock.value, escrow.timelocks, escrow.claimed, escrow.cancelled, escrow.is_src, escrow.vault_address)
    }

    #[view]
    public fun escrow_exists(escrow_addr: address): bool {
        exists<Escrow>(escrow_addr)
    }

    #[view]
    public fun get_escrow_token_type(escrow_addr: address): TypeInfo acquires Escrow {
        assert!(exists<Escrow>(escrow_addr), E_ESCROW_NOT_EXISTS);
        let escrow = borrow_global<Escrow>(escrow_addr);
        escrow.token_type
    }

    #[view]
    public fun get_escrow_safety_deposit(escrow_addr: address): u64 acquires Escrow {
        assert!(exists<Escrow>(escrow_addr), E_ESCROW_NOT_EXISTS);
        let escrow = borrow_global<Escrow>(escrow_addr);
        escrow.safety_deposit
    }

    #[view]
    public fun get_vault_balance<CoinType>(vault_addr: address): u64 {
        coin::balance<CoinType>(vault_addr)
    }

    /// Helper function to compute order hash from escrow info - used for verification
    public fun compute_order_hash_from_info(
        maker: address,
        taker: address,
        token_type: TypeInfo,
        amount: u64,
        hashlock: vector<u8>,
        timelocks: vector<u64>,
        is_src: bool
    ): vector<u8> {
        let order_hash_data = vector::empty<u8>();
        vector::append(&mut order_hash_data, bcs::to_bytes(&maker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&taker));
        vector::append(&mut order_hash_data, bcs::to_bytes(&token_type));
        vector::append(&mut order_hash_data, bcs::to_bytes(&amount));
        vector::append(&mut order_hash_data, hashlock);
        vector::append(&mut order_hash_data, bcs::to_bytes(&timelocks));
        vector::append(&mut order_hash_data, bcs::to_bytes(&is_src));
        hash::sha3_256(order_hash_data)
    }

    /// Helper function to compute timelock deadline
    public fun get_timelock_deadline(stage: u8, init_time: u64, rescue_delay: u32): u64 {
        if (stage == STAGE_FINALITY) {
            init_time
        } else if (stage == STAGE_SRC_WITHDRAWAL) {
            init_time + (rescue_delay as u64)
        } else if (stage == STAGE_SRC_PUBLIC_WITHDRAWAL) {
            init_time + (rescue_delay as u64) * 2
        } else if (stage == STAGE_SRC_CANCELLATION) {
            init_time + (rescue_delay as u64) * 3
        } else if (stage == STAGE_SRC_PUBLIC_CANCELLATION) {
            init_time + (rescue_delay as u64) * 4
        } else {
            abort E_STAGE_EXPIRED
        }
    }

    /// Verify Merkle proof for partial fills
    fun verify_merkle_proof(
        leaf: vector<u8>,
        proof: vector<vector<u8>>,
        index: u64,
        root: vector<u8>
    ): bool {
        let current_hash = leaf;
        let current_index = (index as u64);
        
        let i = 0;
        let proof_len = vector::length(&proof);
        while (i < proof_len) {
            let proof_element = *vector::borrow(&proof, i);
            
            // Create new vector for concatenation to avoid mutation issues
            let combined = vector::empty<u8>();
            
            if (current_index % 2 == 0) {
                // Left node - concatenate current_hash + proof_element
                vector::append(&mut combined, current_hash);
                vector::append(&mut combined, proof_element);
            } else {
                // Right node - concatenate proof_element + current_hash
                vector::append(&mut combined, proof_element);
                vector::append(&mut combined, current_hash);
            };
            
            current_hash = hash::sha2_256(combined);
            current_index = current_index / 2;
            i = i + 1;
        };
        
        current_hash == root
    }
} 
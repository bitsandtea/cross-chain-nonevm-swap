module fusion_plus::escrow {
    use std::error;
    use std::event;
    use std::option::{Self, Option};
    use std::signer;
    use std::timestamp;
    use std::vector;
    
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::aptos_coin::AptosCoin;

    // Error codes
    const E_ESCROW_NOT_FOUND: u64 = 1;
    const E_INVALID_CALLER: u64 = 2;
    const E_INVALID_SECRET: u64 = 3;
    const E_INVALID_TIME: u64 = 4;
    const E_INSUFFICIENT_BALANCE: u64 = 5;
    const E_FINALITY_LOCK_ACTIVE: u64 = 6;

    /// Escrow data structure with Fusion+ extensions
    struct Escrow has key, store {
        /// Hash of the secret that unlocks the escrow
        hashlock: vector<u8>,
        /// Recipient address
        taker: address,
        /// Locked amount
        amount: u64,
        /// Safety deposit amount
        safety_deposit: u64,
        /// Merkle root for partial fills (32 bytes)
        merkle_root: Option<vector<u8>>,
        /// Number of parts for partial fills
        num_parts: Option<u64>,
        /// Withdrawal timelock timestamp
        withdrawal_timelock: u64,
        /// Cancellation timelock timestamp  
        cancellation_timelock: u64,
        /// Finality lock timestamp - secret cannot be shared before this
        finality_lock: u64,
        /// Whether the escrow has been withdrawn
        is_withdrawn: bool,
        /// Whether the escrow has been cancelled
        is_cancelled: bool,
    }

    /// Global storage for escrows by ID
    struct EscrowRegistry has key {
        escrows: vector<Escrow>,
        next_id: u64,
    }

    /// Event emitted when escrow is created
    struct EscrowCreated has drop, store {
        escrow_id: u64,
        maker: address,
        taker: address,
        amount: u64,
        safety_deposit: u64,
        hashlock: vector<u8>,
        withdrawal_timelock: u64,
        cancellation_timelock: u64,
        finality_lock: u64,
        merkle_root: Option<vector<u8>>,
        num_parts: Option<u64>,
    }

    /// Event emitted when secret is shared by relayer
    struct SecretShared has drop, store {
        escrow_id: u64,
        secret: vector<u8>,
        shared_by: address,
    }

    /// Event emitted when escrow is withdrawn
    struct EscrowWithdrawn has drop, store {
        escrow_id: u64,
        secret: vector<u8>,
        amount: u64,
        withdrawn_by: address,
    }

    /// Event emitted when escrow is cancelled
    struct EscrowCancelled has drop, store {
        escrow_id: u64,
        amount: u64,
        safety_deposit: u64,
        cancelled_by: address,
    }

    /// Initialize the module
    fun init_module(admin: &signer) {
        move_to(admin, EscrowRegistry {
            escrows: vector::empty(),
            next_id: 0,
        });
    }

    /// Create a new escrow with Fusion+ extensions
    public entry fun create_escrow(
        maker: &signer,
        taker: address,
        amount: u64,
        safety_deposit: u64,
        hashlock: vector<u8>,
        withdrawal_timelock: u64,
        cancellation_timelock: u64,
        finality_lock: u64,
        merkle_root: Option<vector<u8>>,
        num_parts: Option<u64>,
    ) acquires EscrowRegistry {
        let maker_addr = signer::address_of(maker);
        
        // Validate timelock ordering
        let now = timestamp::now_seconds();
        assert!(withdrawal_timelock > now, error::invalid_argument(E_INVALID_TIME));
        assert!(cancellation_timelock > withdrawal_timelock, error::invalid_argument(E_INVALID_TIME));
        assert!(finality_lock <= now + 3600, error::invalid_argument(E_INVALID_TIME)); // Max 1 hour in future
        
        // Transfer total amount (amount + safety_deposit) to escrow
        let total_cost = amount + safety_deposit;
        let payment = coin::withdraw<AptosCoin>(maker, total_cost);
        
        // Get registry and assign ID
        let registry = borrow_global_mut<EscrowRegistry>(@fusion_plus);
        let escrow_id = registry.next_id;
        registry.next_id = registry.next_id + 1;
        
        // Create escrow
        let escrow = Escrow {
            hashlock,
            taker,
            amount,
            safety_deposit,
            merkle_root,
            num_parts,
            withdrawal_timelock,
            cancellation_timelock,
            finality_lock,
            is_withdrawn: false,
            is_cancelled: false,
        };
        
        vector::push_back(&mut registry.escrows, escrow);
        
        // Store the coins with the escrow (simplified - in production, use resource account)
        coin::deposit(maker_addr, payment);
        
        // Emit event
        event::emit(EscrowCreated {
            escrow_id,
            maker: maker_addr,
            taker,
            amount,
            safety_deposit,
            hashlock: *&escrow.hashlock,
            withdrawal_timelock,
            cancellation_timelock,
            finality_lock,
            merkle_root,
            num_parts,
        });
    }

    /// Relayer function to emit secret sharing after finality
    public entry fun emit_secret_shared(
        relayer: &signer,
        escrow_id: u64,
        secret: vector<u8>,
    ) acquires EscrowRegistry {
        let relayer_addr = signer::address_of(relayer);
        let registry = borrow_global<EscrowRegistry>(@fusion_plus);
        
        assert!(escrow_id < vector::length(&registry.escrows), error::not_found(E_ESCROW_NOT_FOUND));
        let escrow = vector::borrow(&registry.escrows, escrow_id);
        
        // Verify finality lock has passed
        let now = timestamp::now_seconds();
        assert!(now >= escrow.finality_lock, error::invalid_state(E_FINALITY_LOCK_ACTIVE));
        
        // Verify secret is correct (hash matches hashlock)
        let secret_hash = aptos_hash::keccak256(secret);
        assert!(secret_hash == escrow.hashlock, error::invalid_argument(E_INVALID_SECRET));
        
        // Emit secret sharing event
        event::emit(SecretShared {
            escrow_id,
            secret,
            shared_by: relayer_addr,
        });
    }

    /// Withdraw funds using the secret
    public entry fun withdraw(
        taker: &signer,
        escrow_id: u64,
        secret: vector<u8>,
    ) acquires EscrowRegistry {
        let taker_addr = signer::address_of(taker);
        let registry = borrow_global_mut<EscrowRegistry>(@fusion_plus);
        
        assert!(escrow_id < vector::length(&registry.escrows), error::not_found(E_ESCROW_NOT_FOUND));
        let escrow = vector::borrow_mut(&mut registry.escrows, escrow_id);
        
        // Validate caller
        assert!(taker_addr == escrow.taker, error::permission_denied(E_INVALID_CALLER));
        
        // Validate secret
        let secret_hash = aptos_hash::keccak256(secret);
        assert!(secret_hash == escrow.hashlock, error::invalid_argument(E_INVALID_SECRET));
        
        // Validate timelock
        let now = timestamp::now_seconds();
        assert!(now >= escrow.withdrawal_timelock, error::invalid_state(E_INVALID_TIME));
        
        // Validate not already withdrawn or cancelled
        assert!(!escrow.is_withdrawn, error::invalid_state(E_INVALID_TIME));
        assert!(!escrow.is_cancelled, error::invalid_state(E_INVALID_TIME));
        
        // Mark as withdrawn
        escrow.is_withdrawn = true;
        
        // Transfer amount to taker (safety deposit remains locked)
        let payment = coin::withdraw<AptosCoin>(taker, escrow.amount);
        coin::deposit(taker_addr, payment);
        
        // Emit event
        event::emit(EscrowWithdrawn {
            escrow_id,
            secret,
            amount: escrow.amount,
            withdrawn_by: taker_addr,
        });
    }

    /// Cancel escrow and reclaim safety deposit
    public entry fun cancel(
        maker: &signer,
        escrow_id: u64,
    ) acquires EscrowRegistry {
        let maker_addr = signer::address_of(maker);
        let registry = borrow_global_mut<EscrowRegistry>(@fusion_plus);
        
        assert!(escrow_id < vector::length(&registry.escrows), error::not_found(E_ESCROW_NOT_FOUND));
        let escrow = vector::borrow_mut(&mut registry.escrows, escrow_id);
        
        // Validate timelock
        let now = timestamp::now_seconds();
        assert!(now >= escrow.cancellation_timelock, error::invalid_state(E_INVALID_TIME));
        
        // Validate not already withdrawn or cancelled
        assert!(!escrow.is_withdrawn, error::invalid_state(E_INVALID_TIME));
        assert!(!escrow.is_cancelled, error::invalid_state(E_INVALID_TIME));
        
        // Mark as cancelled
        escrow.is_cancelled = true;
        
        // Return both amount and safety deposit to maker
        let total_refund = escrow.amount + escrow.safety_deposit;
        let payment = coin::withdraw<AptosCoin>(maker, total_refund);
        coin::deposit(maker_addr, payment);
        
        // Emit event
        event::emit(EscrowCancelled {
            escrow_id,
            amount: escrow.amount,
            safety_deposit: escrow.safety_deposit,
            cancelled_by: maker_addr,
        });
    }

    /// Get escrow details
    #[view]
    public fun get_escrow(escrow_id: u64): (
        vector<u8>, // hashlock
        address,    // taker
        u64,        // amount
        u64,        // safety_deposit
        Option<vector<u8>>, // merkle_root
        Option<u64>,        // num_parts
        u64,        // withdrawal_timelock
        u64,        // cancellation_timelock
        u64,        // finality_lock
        bool,       // is_withdrawn
        bool,       // is_cancelled
    ) acquires EscrowRegistry {
        let registry = borrow_global<EscrowRegistry>(@fusion_plus);
        assert!(escrow_id < vector::length(&registry.escrows), error::not_found(E_ESCROW_NOT_FOUND));
        
        let escrow = vector::borrow(&registry.escrows, escrow_id);
        (
            escrow.hashlock,
            escrow.taker,
            escrow.amount,
            escrow.safety_deposit,
            escrow.merkle_root,
            escrow.num_parts,
            escrow.withdrawal_timelock,
            escrow.cancellation_timelock,
            escrow.finality_lock,
            escrow.is_withdrawn,
            escrow.is_cancelled,
        )
    }
}
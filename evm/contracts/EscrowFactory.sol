// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@1inch/solidity-utils/contracts/libraries/SafeERC20.sol";
import { Address, AddressLib } from "@1inch/solidity-utils/contracts/libraries/AddressLib.sol";

import { ResolverValidationExtension } from "./extensions/ResolverValidationExtension.sol";

import { ProxyHashLib } from "./libraries/ProxyHashLib.sol";

import { BaseEscrowFactory } from "./BaseEscrowFactory.sol";
import { EscrowDst } from "./EscrowDst.sol";
import { EscrowSrc } from "./EscrowSrc.sol";
import { MerkleStorageInvalidator } from "./MerkleStorageInvalidator.sol";
import { IBaseEscrow } from "./interfaces/IBaseEscrow.sol";
import { ImmutablesLib } from "./libraries/ImmutablesLib.sol";


/**
 * @title Escrow Factory contract
 * @notice Contract to create escrow contracts for cross-chain atomic swap.
 * @custom:security-contact security@1inch.io
 */
contract EscrowFactory is BaseEscrowFactory {
    using SafeERC20 for IERC20;
    using AddressLib for Address;
    constructor(
        address limitOrderProtocol,
        IERC20 feeToken,
        IERC20 accessToken,
        address owner,
        uint32 rescueDelaySrc,
        uint32 rescueDelayDst
    )
    ResolverValidationExtension(feeToken, accessToken, owner)
    MerkleStorageInvalidator(limitOrderProtocol) {
        ESCROW_SRC_IMPLEMENTATION = address(new EscrowSrc(rescueDelaySrc, accessToken));
        ESCROW_DST_IMPLEMENTATION = address(new EscrowDst(rescueDelayDst, accessToken));
        _PROXY_SRC_BYTECODE_HASH = ProxyHashLib.computeProxyBytecodeHash(ESCROW_SRC_IMPLEMENTATION);
        _PROXY_DST_BYTECODE_HASH = ProxyHashLib.computeProxyBytecodeHash(ESCROW_DST_IMPLEMENTATION);
    }

    /**
     * @notice Emitted on EscrowSrc deployment via LOP postInteraction.
     * @param orderHash The hash of the order.
     * @param escrowAddr The address of the created escrow.
     * @param immutables The encoded immutables used for deployment.
     */
    event EscrowCreatedSrc(bytes32 orderHash, address escrowAddr, bytes immutables);

    /**
     * @notice LOP static-call hook for compatibility
     * @dev Returns the expected selector for LOP integration
     * @return The selector 0x150b7a02
     */
    function lopCallback() external pure returns (bytes4) {
        return 0x150b7a02;
    }

    /**
     * @notice Creates a source escrow via LOP postInteraction
     * @dev This function is called by the Resolver contract during LOP order filling
     * @param immutables The escrow immutables encoded as bytes
     */
    function createSrcEscrow(bytes calldata immutables) external {
        // Decode immutables from calldata
        IBaseEscrow.Immutables memory escrowImmutables = abi.decode(immutables, (IBaseEscrow.Immutables));
        
        // Deploy escrow with safety deposit already sent to computed address
        bytes32 salt = ImmutablesLib.hashMem(escrowImmutables);
        address escrow = _deployEscrow(salt, 0, ESCROW_SRC_IMPLEMENTATION);
        
        // Verify funds are present (safety deposit + token amount)
        if (escrow.balance < escrowImmutables.safetyDeposit || 
            IERC20(escrowImmutables.token.get()).safeBalanceOf(escrow) < escrowImmutables.amount) {
            revert InsufficientEscrowBalance();
        }

        emit EscrowCreatedSrc(escrowImmutables.orderHash, escrow, immutables);
    }
}

// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IOrderMixin } from "@1inch/limit-order-protocol-contract/contracts/interfaces/IOrderMixin.sol";
import { TakerTraits } from "@1inch/limit-order-protocol-contract/contracts/libraries/TakerTraitsLib.sol";
import { RevertReasonForwarder } from "@1inch/solidity-utils/contracts/libraries/RevertReasonForwarder.sol";

import { IBaseEscrow } from "./interfaces/IBaseEscrow.sol";
import { IEscrowFactory } from "./interfaces/IEscrowFactory.sol";

/**
 * @title Production Resolver contract for Fusion+ cross-chain swap via LOP integration.
 * @notice Handles atomic swap execution and escrow deployment in single transaction.
 * @custom:security-contact security@1inch.io
 */
contract Resolver is Ownable {
    IEscrowFactory private immutable _FACTORY;
    IOrderMixin private immutable _LOP;

    error InsufficientSafetyDeposit();
    error LengthMismatch();

    constructor(IEscrowFactory factory, IOrderMixin lop, address initialOwner) Ownable(initialOwner) {
        _FACTORY = factory;
        _LOP = lop;
    }

    receive() external payable {} // solhint-disable-line no-empty-blocks

    /**
     * @notice Deploy source escrow and execute LOP swap atomically.
     * @dev msg.value is forwarded as safety deposit. Sets _ARGS_HAS_TARGET bit and calls LOP.fillOrder.
     * @param order The LOP order to fill
     * @param sig The order signature (r, vs packed)
     * @param fillAmount The amount to fill
     * @param takerTraits Taker traits for the fill
     * @param args Additional arguments for the fill
     */
    function deploySrc(
        IOrderMixin.Order calldata order,
        bytes32 sig,
        uint256 fillAmount,
        TakerTraits takerTraits,
        bytes calldata args
    ) external payable onlyOwner {
        // Set _ARGS_HAS_TARGET bit (1 << 251) to enable postInteraction
        takerTraits = TakerTraits.wrap(TakerTraits.unwrap(takerTraits) | uint256(1 << 251));
        
        // Forward msg.value as safety deposit and args to LOP
        bytes memory argsWithTarget = abi.encodePacked(address(this), args);
        
        // Call LOP fillOrder which will trigger postInteraction -> createSrcEscrow
        (bool success, bytes memory result) = address(_LOP).call{value: msg.value}(
            abi.encodeCall(_LOP.fillOrderArgs, (order, sig, fillAmount, takerTraits, argsWithTarget))
        );
        
        if (!success) {
            RevertReasonForwarder.reRevert();
        }
    }

    /**
     * @notice Deploy destination escrow.
     * @dev Mirrors ResolverExample.deployDst functionality.
     * @param dstImmutables The immutables for the destination escrow
     * @param srcCancellationTimestamp The source chain cancellation timestamp
     */
    function deployDst(
        IBaseEscrow.Immutables calldata dstImmutables, 
        uint256 srcCancellationTimestamp
    ) external payable onlyOwner {
        _FACTORY.createDstEscrow{value: msg.value}(dstImmutables, srcCancellationTimestamp);
    }

    /**
     * @notice Emergency function for arbitrary calls.
     * @dev Owner-gated for emergency situations.
     * @param targets Array of target addresses
     * @param arguments Array of call data
     */
    function arbitraryCalls(address[] calldata targets, bytes[] calldata arguments) external onlyOwner {
        uint256 length = targets.length;
        if (targets.length != arguments.length) revert LengthMismatch();
        for (uint256 i = 0; i < length; ++i) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success,) = targets[i].call(arguments[i]);
            if (!success) RevertReasonForwarder.reRevert();
        }
    }
}
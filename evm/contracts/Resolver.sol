// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IOrderMixin } from "@1inch/limit-order-protocol-contract/contracts/interfaces/IOrderMixin.sol";
import { TakerTraits, TakerTraitsLib } from "@1inch/limit-order-protocol-contract/contracts/libraries/TakerTraitsLib.sol";
import { RevertReasonForwarder } from "@1inch/solidity-utils/contracts/libraries/RevertReasonForwarder.sol";
import { Address, AddressLib } from "@1inch/solidity-utils/contracts/libraries/AddressLib.sol";

import { IBaseEscrow } from "./interfaces/IBaseEscrow.sol";
import { IEscrowFactory } from "./interfaces/IEscrowFactory.sol";
import { Timelocks, TimelocksLib } from "./libraries/TimelocksLib.sol";

/**
 * @title Production Resolver contract for Fusion+ cross-chain swaps
 * @notice Integrates with 1inch LOP to atomically execute swaps and deploy escrows
 * @dev Replaces ResolverExample with production-ready LOP integration
 * @custom:security-contact security@1inch.io
 */
contract Resolver is Ownable {
    using TakerTraitsLib for TakerTraits;
    using AddressLib for Address;

    IEscrowFactory private immutable _FACTORY;
    IOrderMixin private immutable _LOP;

    error InsufficientSafetyDeposit();
    error LengthMismatch();

    /**
     * @notice Emitted when a source escrow is deployed via LOP integration
     * @param orderHash The hash of the LOP order
     * @param escrowAddr The address of the deployed escrow
     * @param fillAmount The amount filled in the order
     * @param safetyDeposit The safety deposit sent with the escrow
     */
    event SrcEscrowDeployed(
        bytes32 indexed orderHash,
        address indexed escrowAddr,
        uint256 fillAmount,
        uint256 safetyDeposit
    );

    constructor(IEscrowFactory factory, IOrderMixin lop, address initialOwner) Ownable(initialOwner) {
        _FACTORY = factory;
        _LOP = lop;
    }

    receive() external payable {} // solhint-disable-line no-empty-blocks

    /**
     * @notice Deploys source escrow via LOP order filling
     * @dev Forwards msg.value as safety deposit, sets _ARGS_HAS_TARGET bit, calls LOP.fillOrder
     * @param order The LOP order to fill
     * @param r The r component of the order signature
     * @param vs The vs component of the order signature
     * @param fillAmount The amount to fill from the order
     * @param args Additional arguments for the order fill
     */
    function deploySrc(
        IOrderMixin.Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 fillAmount,
        bytes calldata args
    ) external payable onlyOwner {
        // Validate safety deposit is provided
        if (msg.value == 0) revert InsufficientSafetyDeposit();

        // Decode parameters from args
        bytes32 hashlock = bytes32(args[:32]);
        Timelocks timelocks = abi.decode(args[32:], (Timelocks));
        
        // Create immutables for escrow deployment  
        IBaseEscrow.Immutables memory immutables = IBaseEscrow.Immutables({
            orderHash: _LOP.hashOrder(order),
            hashlock: hashlock,
            maker: order.maker,
            taker: order.receiver.get() == address(0) ? order.maker : order.receiver,
            token: order.makerAsset,
            amount: fillAmount,
            safetyDeposit: msg.value,
            timelocks: TimelocksLib.setDeployedAt(timelocks, block.timestamp)
        });

        // Pre-compute escrow address and send safety deposit
        address computedEscrow = _FACTORY.addressOfEscrowSrc(immutables);
        (bool success,) = computedEscrow.call{value: msg.value}("");
        if (!success) revert IBaseEscrow.NativeTokenSendingFailure();

        // Set _ARGS_HAS_TARGET bit (1 << 251) to enable postInteraction
        TakerTraits takerTraits = TakerTraits.wrap(uint256(1 << 251));
        
        // Encode postInteraction call to createSrcEscrow
        bytes memory postInteractionData = abi.encodeWithSelector(
            _FACTORY.createSrcEscrow.selector,
            abi.encode(immutables)
        );
        
        // Combine target address and postInteraction data for LOP args
        bytes memory lopArgs = abi.encodePacked(address(_FACTORY), postInteractionData);

        // Fill order with postInteraction
        _LOP.fillOrderArgs(order, r, vs, fillAmount, takerTraits, lopArgs);

        emit SrcEscrowDeployed(immutables.orderHash, computedEscrow, fillAmount, msg.value);
    }

    /**
     * @notice Deploys destination escrow (mirrors ResolverExample functionality)
     * @param dstImmutables The immutables for the destination escrow
     * @param srcCancellationTimestamp The cancellation timestamp from source chain
     */
    function deployDst(
        IBaseEscrow.Immutables calldata dstImmutables, 
        uint256 srcCancellationTimestamp
    ) external payable onlyOwner {
        _FACTORY.createDstEscrow{value: msg.value}(dstImmutables, srcCancellationTimestamp);
    }

    /**
     * @notice Emergency function for arbitrary calls (retained from ResolverExample)
     * @param targets Array of contract addresses to call
     * @param arguments Array of calldata for each target
     */
    function arbitraryCalls(
        address[] calldata targets, 
        bytes[] calldata arguments
    ) external onlyOwner {
        uint256 length = targets.length;
        if (targets.length != arguments.length) revert LengthMismatch();
        
        for (uint256 i = 0; i < length; ++i) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success,) = targets[i].call(arguments[i]);
            if (!success) RevertReasonForwarder.reRevert();
        }
    }
}
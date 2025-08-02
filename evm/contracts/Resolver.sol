// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol";

import {IOrderMixin} from "@1inch/limit-order-protocol-contract/contracts/interfaces/IOrderMixin.sol";
import {TakerTraits} from "@1inch/limit-order-protocol-contract/contracts/libraries/TakerTraitsLib.sol";

import {IResolverExample} from "./interfaces/IResolverExample.sol";
import {RevertReasonForwarder} from "./libraries/RevertReasonForwarder.sol";
import {IEscrowFactory} from "./interfaces/IEscrowFactory.sol";
import {IBaseEscrow} from "./interfaces/IBaseEscrow.sol";
import {TimelocksLib, Timelocks} from "./libraries/TimelocksLib.sol";
import {Address} from "@1inch/solidity-utils/contracts/libraries/AddressLib.sol";
import {IEscrow} from "./interfaces/IEscrow.sol";
import {ImmutablesLib} from "./libraries/ImmutablesLib.sol";

/**
 * @title Sample implementation of a Resolver contract for cross-chain swap.
 * @dev It is important when deploying an escrow on the source chain to send the safety deposit and deploy the escrow in the same
 * transaction, since the address of the escrow depends on the block.timestamp.
 * You can find sample code for this in the {ResolverExample-deploySrc}.
 *
 * @custom:security-contact security@1inch.io
 */
contract Resolver is Ownable {
    using ImmutablesLib for IBaseEscrow.Immutables;
    using TimelocksLib for Timelocks;

    error InvalidLength();
    error LengthMismatch();

    IEscrowFactory private immutable _FACTORY;
    IOrderMixin private immutable _LOP;

 constructor(IEscrowFactory factory, IOrderMixin lop, address initialOwner) Ownable(initialOwner) {
        console.log("Resolver: Constructor called");
        console.log("Resolver: Factory address:", address(factory));
        console.log("Resolver: LOP address:", address(lop));
        console.log("Resolver: Initial owner:", initialOwner);
        _FACTORY = factory;
        _LOP = lop;
        console.log("Resolver: Constructor completed");
    }

    receive() external payable {
        console.log("Resolver: Received", msg.value, "wei from", msg.sender);
    } // solhint-disable-line no-empty-blocks

    /**
     * @notice See {IResolverExample-deploySrc}.
     */
    function deploySrc(
        IBaseEscrow.Immutables calldata immutables,
        IOrderMixin.Order calldata order,
        bytes32 r,
        bytes32 vs,
        uint256 amount,
        TakerTraits takerTraits,
        bytes calldata args
    ) external payable onlyOwner {
        console.log("Resolver: deploySrc called by", msg.sender);
        console.log("Resolver: Safety deposit amount:", immutables.safetyDeposit);
        console.log("Resolver: Order maker address");
        console.log("Resolver: Order taker asset address");
        console.log("Resolver: Amount:", amount);
        console.log("Resolver: Block timestamp:", block.timestamp);
        
        IBaseEscrow.Immutables memory immutablesMem = immutables;
        immutablesMem.timelocks = TimelocksLib.setDeployedAt(immutables.timelocks, block.timestamp);
        console.log("Resolver: Updated timelocks with deployment timestamp");
        
        // Log all immutables fields
        console.log("Resolver: Immutables debug:");
        console.log("orderHash:", uint256(immutablesMem.orderHash));
        console.log("hashlock:", uint256(immutablesMem.hashlock));
        console.log("maker:", uint256(Address.unwrap(immutablesMem.maker)));
        console.log("taker:", uint256(Address.unwrap(immutablesMem.taker)));
        console.log("token:", uint256(Address.unwrap(immutablesMem.token)));
        console.log("amount:", immutablesMem.amount);
        console.log("safetyDeposit:", immutablesMem.safetyDeposit);
        console.log("timelocks:", uint256(Timelocks.unwrap(immutablesMem.timelocks)));
        
        address computed = _FACTORY.addressOfEscrowSrc(immutablesMem);
        console.log("Resolver: Computed escrow address:", computed);
        
        console.log("Resolver: Sending safety deposit to computed address");
        (bool success,) = address(computed).call{ value: immutablesMem.safetyDeposit }("");
        if (!success) {
            console.log("Resolver: Failed to send safety deposit");
            revert IBaseEscrow.NativeTokenSendingFailure();
        }
        console.log("Resolver: Safety deposit sent successfully");

        // _ARGS_HAS_TARGET = 1 << 251
        takerTraits = TakerTraits.wrap(TakerTraits.unwrap(takerTraits) | uint256(1 << 251));
        console.log("Resolver: Updated taker traits with target flag");
        
        bytes memory argsMem = abi.encodePacked(computed, args);
        console.log("Resolver: Encoded args with computed address");
        
        console.log("Resolver: Calling LOP fillOrderArgs");
        _LOP.fillOrderArgs(order, r, vs, amount, takerTraits, argsMem);
        console.log("Resolver: deploySrc completed successfully");
    }
    
    /**
     * @notice See {IResolverExample-deployDst}.
     */
    function deployDst(IBaseEscrow.Immutables calldata dstImmutables, uint256 srcCancellationTimestamp) external onlyOwner payable {
    
        _FACTORY.createDstEscrow{value: msg.value}(dstImmutables, srcCancellationTimestamp);
    }

    function withdraw(IEscrow escrow, bytes32 secret, IBaseEscrow.Immutables calldata immutables) external {

        escrow.withdraw(secret, immutables);
    }

    function cancel(IEscrow escrow, IBaseEscrow.Immutables calldata immutables) external {
    
        escrow.cancel(immutables);
    }

    /**
     * @notice See {IResolverExample-arbitraryCalls}.
     */
    function arbitraryCalls(address[] calldata targets, bytes[] calldata arguments) external onlyOwner {
    
        uint256 length = targets.length;
        if (targets.length != arguments.length) {
            revert LengthMismatch();
        }
        
        for (uint256 i = 0; i < length; ++i) {
           
            
            // solhint-disable-next-line avoid-low-level-calls
            (bool success,) = targets[i].call(arguments[i]);
            if (!success) {
                RevertReasonForwarder.reRevert();
            }
        }
    }
}

// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IOrderMixin } from "@1inch/limit-order-protocol-contract/contracts/interfaces/IOrderMixin.sol";

/**
 * @title Resolver Validation Extension placeholder
 * @notice Simple placeholder for ResolverValidationExtension since the original doesn't exist in available packages
 */
contract ResolverValidationExtension {
    IERC20 public immutable feeToken;
    IERC20 public immutable accessToken;
    address public immutable owner;

    constructor(IERC20 _feeToken, IERC20 _accessToken, address _owner) {
        feeToken = _feeToken;
        accessToken = _accessToken;
        owner = _owner;
    }

    function _postInteraction(
        IOrderMixin.Order calldata order,
        bytes calldata extension,
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 takingAmount,
        uint256 remainingMakingAmount,
        bytes calldata extraData
    ) internal virtual {
        // Placeholder implementation
    }
} 
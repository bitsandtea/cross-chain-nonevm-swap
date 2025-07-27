// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title CoreToken
 * @notice Core ERC20 token for cross-chain escrow functionality
 * @dev Mints total supply to deployer
 */
contract CoreToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000 * 10**18; // 1 million tokens

    constructor() ERC20("CoreToken", "CORE") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
} 
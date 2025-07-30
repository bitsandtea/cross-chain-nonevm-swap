// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title OneInchToken
 * @notice 1INCH token for cross-chain escrow functionality
 * @dev Mints total supply to deployer
 */
contract OneInchToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_500_000_000 * 10**18; // 1.5 billion tokens (1INCH total supply)

    constructor() ERC20("1inch", "1INCH") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
} 
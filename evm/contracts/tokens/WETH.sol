// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title WrappedEther
 * @notice WETH token for cross-chain escrow functionality
 * @dev Mints total supply to deployer
 */
contract WrappedEther is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 120_000_000 * 10**18; // 120 million tokens (approximate WETH supply)

    constructor() ERC20("Wrapped Ether", "WETH") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
} 
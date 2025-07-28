// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title USDCoin
 * @notice USDC stablecoin for cross-chain escrow functionality
 * @dev Mints total supply to deployer
 */
contract USDCoin is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10**6; // 1 billion USDC (6 decimals)

    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    function decimals() public view virtual override returns (uint8) {
        return 6;
    }
} 
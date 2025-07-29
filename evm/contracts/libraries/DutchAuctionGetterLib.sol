// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

/**
 * @title Dutch Auction Getter Library
 * @notice Pure library for calculating taking amounts in Dutch auctions
 * @custom:security-contact security@1inch.io
 */
library DutchAuctionGetterLib {
    error InvalidTimestamp();
    error InvalidDuration();

    /**
     * @notice Calculates the taking amount for a Dutch auction at current timestamp
     * @param startRate The starting rate (taking amount per making amount)
     * @param endRate The ending rate (taking amount per making amount)
     * @param startTs The auction start timestamp
     * @param duration The auction duration in seconds
     * @return takingAmount The calculated taking amount
     */
    function getTakingAmount(
        uint256 startRate,
        uint256 endRate,
        uint256 startTs,
        uint256 duration
    ) internal view returns (uint256 takingAmount) {
        if (block.timestamp < startTs) revert InvalidTimestamp();
        if (duration == 0) revert InvalidDuration();
        
        uint256 elapsed = block.timestamp - startTs;
        
        if (elapsed >= duration) {
            return endRate;
        }
        
        // Linear interpolation: rate = startRate + (endRate - startRate) * elapsed / duration
        if (endRate > startRate) {
            return startRate + (endRate - startRate) * elapsed / duration;
        } else {
            return startRate - (startRate - endRate) * elapsed / duration;
        }
    }
}
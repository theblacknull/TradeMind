// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library MathLib {
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function calculateLTV(uint256 collateralValue, uint256 borrowValue) internal pure returns (uint256) {
        if (collateralValue == 0) return type(uint256).max;
        return (borrowValue * 1e18) / collateralValue;
    }

    function calculateAMMOutput(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256) {
        require(amountIn > 0, "MathLib: INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "MathLib: INSUFFICIENT_LIQUIDITY");
        uint256 amountInWithFee = amountIn * 997; // 0.3% fee
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        return numerator / denominator;
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../libraries/MathLib.sol";

contract TMNSwapRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Pool {
        uint256 reserveA;
        uint256 reserveB;
    }

    mapping(address => mapping(address => Pool)) public pools;

    event LiquidityAdded(address tokenA, address tokenB, uint256 amountA, uint256 amountB);
    event Swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    constructor() Ownable(msg.sender) {}

    function addLiquidity(address tokenA, address tokenB, uint256 amountA, uint256 amountB) external onlyOwner {
        require(tokenA != tokenB, "Identical tokens");
        require(amountA > 0 && amountB > 0, "Amounts > 0");

        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        pools[tokenA][tokenB].reserveA += amountA;
        pools[tokenA][tokenB].reserveB += amountB;
        
        pools[tokenB][tokenA].reserveA += amountB;
        pools[tokenB][tokenA].reserveB += amountA;

        emit LiquidityAdded(tokenA, tokenB, amountA, amountB);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn) external nonReentrant returns (uint256 amountOut) {
        require(tokenIn != tokenOut, "Identical tokens");
        require(amountIn > 0, "Amount > 0");

        Pool storage pool = pools[tokenIn][tokenOut];
        require(pool.reserveA > 0 && pool.reserveB > 0, "No liquidity");

        amountOut = MathLib.calculateAMMOutput(amountIn, pool.reserveA, pool.reserveB);
        require(amountOut > 0, "Insufficient output");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        
        pool.reserveA += amountIn;
        pool.reserveB -= amountOut;

        pools[tokenOut][tokenIn].reserveA -= amountOut;
        pools[tokenOut][tokenIn].reserveB += amountIn;

        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        
        emit Swap(tokenIn, tokenOut, amountIn, amountOut);
        return amountOut;
    }

    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        Pool memory pool = pools[tokenIn][tokenOut];
        return MathLib.calculateAMMOutput(amountIn, pool.reserveA, pool.reserveB);
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract TMNLendingPool is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable lendingAsset;
    IERC20 public immutable collateralAsset;

    struct UserPosition {
        uint256 depositAmount;
        uint256 borrowAmount;
    }

    mapping(address => UserPosition) public positions;
    
    uint256 public totalDeposits;
    uint256 public totalBorrows;
    
    uint256 public constant COLLATERAL_FACTOR = 75; // 75% LTV
    uint256 public constant LIQUIDATION_THRESHOLD = 85;
    uint256 public constant LIQUIDATION_PENALTY = 10;

    event Deposited(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event Liquidated(address indexed borrower, address indexed liquidator, uint256 amount);

    constructor(IERC20 _lendingAsset, IERC20 _collateralAsset) Ownable(msg.sender) {
        lendingAsset = _lendingAsset;
        collateralAsset = _collateralAsset;
    }

    function getUtilizationRate() public view returns (uint256) {
        if (totalDeposits == 0) return 0;
        return (totalBorrows * 1e18) / totalDeposits;
    }

    function getBorrowRate() public view returns (uint256) {
        uint256 utilization = getUtilizationRate();
        return 200 + ((utilization * 1000) / 1e18); 
    }

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount > 0");
        lendingAsset.safeTransferFrom(msg.sender, address(this), amount);
        
        positions[msg.sender].depositAmount += amount;
        totalDeposits += amount;
        
        emit Deposited(msg.sender, amount);
    }

    function borrow(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount > 0");
        require(lendingAsset.balanceOf(address(this)) >= amount, "Insufficient liquidity");

        uint256 collateralBalance = collateralAsset.balanceOf(msg.sender);
        uint256 maxBorrow = (collateralBalance * COLLATERAL_FACTOR) / 100;
        require(positions[msg.sender].borrowAmount + amount <= maxBorrow, "Exceeds LTV");

        positions[msg.sender].borrowAmount += amount;
        totalBorrows += amount;
        lendingAsset.safeTransfer(msg.sender, amount);

        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external nonReentrant {
        require(positions[msg.sender].borrowAmount >= amount, "Repaying too much");
        
        lendingAsset.safeTransferFrom(msg.sender, address(this), amount);
        positions[msg.sender].borrowAmount -= amount;
        totalBorrows -= amount;

        emit Repaid(msg.sender, amount);
    }

    function liquidate(address borrower, uint256 repayAmount) external nonReentrant whenNotPaused {
        uint256 collateralBalance = collateralAsset.balanceOf(borrower);
        uint256 maxBorrow = (collateralBalance * COLLATERAL_FACTOR) / 100;
        
        require(positions[borrower].borrowAmount > maxBorrow, "Position is healthy");
        
        lendingAsset.safeTransferFrom(msg.sender, address(this), repayAmount);
        
        uint256 collateralToSeize = (repayAmount * (100 + LIQUIDATION_PENALTY)) / 100;
        collateralAsset.safeTransfer(msg.sender, collateralToSeize);

        positions[borrower].borrowAmount -= repayAmount;
        totalBorrows -= repayAmount;

        emit Liquidated(borrower, msg.sender, repayAmount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract TMNYieldVault is ERC4626, Ownable, Pausable {
    address public strategyManager;
    address public feeRecipient;
    
    uint256 public performanceFee = 1000; // 10%
    uint256 public highWaterMark = 1e18; 
    uint256 public totalHarvested;

    event YieldHarvested(uint256 amount, uint256 newTotalAssets);
    event FeeCharged(uint256 feeAmount);

    constructor(IERC20 _asset, address _feeRecipient)
        ERC4626(_asset)
        ERC20("TradeMind Yield Vault", "tmVault")
        Ownable(msg.sender)
    {
        require(_feeRecipient != address(0), "Invalid fee recipient");
        feeRecipient = _feeRecipient;
    }

    modifier onlyStrategy() {
        require(msg.sender == strategyManager, "Caller is not strategy");
        _;
    }

    function harvestYield(uint256 amount) external onlyStrategy whenNotPaused {
        require(amount > 0, "Amount > 0");
        
        uint256 assetsBefore = totalAssets();
        IERC20(asset()).transferFrom(msg.sender, address(this), amount);
        uint256 assetsAfter = totalAssets();
        
        uint256 profit = assetsAfter - assetsBefore;
        uint256 currentSharePrice = (assetsAfter * 1e18) / totalSupply();

        if (currentSharePrice > highWaterMark) {
            uint256 fee = (profit * performanceFee) / 10000;
            if (fee > 0) {
                IERC20(asset()).transfer(feeRecipient, fee);
                emit FeeCharged(fee);
            }
            highWaterMark = currentSharePrice;
        }

        totalHarvested += amount;
        emit YieldHarvested(amount, assetsAfter);
    }

    function setStrategyManager(address _manager) external onlyOwner {
        require(_manager != address(0), "Invalid address");
        strategyManager = _manager;
    }

    function emergencyShutdown() external onlyOwner {
        _pause();
    }

    function deposit(uint256 assets, address receiver) public override whenNotPaused returns (uint256) {
        return super.deposit(assets, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override whenNotPaused returns (uint256) {
        return super.withdraw(assets, receiver, owner);
    }
}
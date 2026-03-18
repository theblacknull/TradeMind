// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract TMNDToken is ERC20, ERC20Burnable, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant TAX_MANAGER_ROLE = keccak256("TAX_MANAGER_ROLE");

    uint256 public buyTax = 200; // 2%
    uint256 public sellTax = 300; // 3%
    
    address public treasury;
    mapping(address => bool) public isExcludedFromTax;
    mapping(address => uint256) public lastTransferTimestamp;
    
    uint256 public transferCooldown = 30 seconds;
    bool public antiBotEnabled = true;

    uint256 public constant MAX_SUPPLY = 100_000_000 * 1e18;
    uint256 public totalBurned;

    event TaxUpdated(uint256 buyTax, uint256 sellTax);
    event TreasuryUpdated(address newTreasury);

    constructor(address _treasury) ERC20("TradeMind", "TMND") {
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(TAX_MANAGER_ROLE, msg.sender);

        isExcludedFromTax[msg.sender] = true;
        isExcludedFromTax[_treasury] = true;
        isExcludedFromTax[address(this)] = true;

        _mint(msg.sender, MAX_SUPPLY);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + amount <= MAX_SUPPLY, "Max supply exceeded");
        _mint(to, amount);
    }

    function burn(uint256 amount) public override {
        super.burn(amount);
        totalBurned += amount;
    }

    function setTaxes(uint256 _buyTax, uint256 _sellTax) external onlyRole(TAX_MANAGER_ROLE) {
        require(_buyTax <= 1000 && _sellTax <= 1000, "Tax too high");
        buyTax = _buyTax;
        sellTax = _sellTax;
        emit TaxUpdated(_buyTax, _sellTax);
    }

    function _update(address from, address to, uint256 value) internal override whenNotPaused {
        if (from == address(0) || to == address(0) || isExcludedFromTax[from] || isExcludedFromTax[to]) {
            super._update(from, to, value);
            return;
        }

        if (antiBotEnabled) {
            require(block.timestamp >= lastTransferTimestamp[from] + transferCooldown, "Anti-bot active");
            lastTransferTimestamp[from] = block.timestamp;
        }

        uint256 taxAmount = (value * sellTax) / 10000;
        uint256 amountAfterTax = value - taxAmount;

        super._update(from, treasury, taxAmount);
        super._update(from, to, amountAfterTax);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}
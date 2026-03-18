// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/core/TMNDToken.sol";
import "../src/core/TMNLendingPool.sol";
import "../src/core/TMNSwapRouter.sol";
import "../src/core/TMNYieldVault.sol";

contract DeployTradeMind is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // Mock USDC Address (Replace with real USDC on your network)
        address usdc = vm.envAddress("USDC_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Token
        TMNDToken token = new TMNDToken(deployer);

        // 2. Deploy Swap Router
        TMNSwapRouter router = new TMNSwapRouter();

        // 3. Deploy Yield Vault (Deposits USDC)
        TMNYieldVault vault = new TMNYieldVault(IERC20(usdc), deployer);

        // 4. Deploy Lending Pool (Lends USDC, Accepts TMND as collateral)
        TMNLendingPool lendingPool = new TMNLendingPool(IERC20(usdc), IERC20(address(token)));

        // --- Hierarchy Setup ---
        
        // Set the AI Backend as the Strategy Manager for the Vault
        address aiBackend = vm.envAddress("AI_BACKEND_ADDRESS");
        vault.setStrategyManager(aiBackend);

        vm.stopBroadcast();
    }
}
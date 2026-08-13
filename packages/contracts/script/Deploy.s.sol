// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ActionProofGuard } from "../src/ActionProofGuard.sol";
import { DemoCounter } from "../src/DemoCounter.sol";
import { DemoToken } from "../src/DemoToken.sol";
import { ReentrantTarget } from "../src/ReentrantTarget.sol";

interface VmScript {
    function envOr(string calldata name, bool defaultValue) external returns (bool value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Readiness-first deployment script. It simulates by default and refuses unlisted chains.
contract Deploy {
    uint256 private constant GALILEO_CHAIN_ID = 16602;
    uint256 private constant MAINNET_CHAIN_ID = 16661;
    VmScript private constant vm =
        VmScript(address(uint160(uint256(keccak256("hevm cheat code")))));

    error MissingAuthorizedVerifier();
    error MissingDeployerPrivateKey();
    error MainnetBroadcastNotAuthorized();
    error UnexpectedChain(uint256 expected, uint256 actual);
    error UnlistedChain(uint256 chainId);

    event DeploymentReadiness(
        uint256 indexed chainId, address indexed verifier, bool dryRun, bool deployDemos
    );
    event DeploymentComplete(
        address indexed guard,
        address demoCounter,
        address demoToken,
        address reentrantTarget,
        bool dryRun
    );

    function run()
        external
        returns (
            ActionProofGuard guard,
            DemoCounter demoCounter,
            DemoToken demoToken,
            ReentrantTarget reentrantTarget
        )
    {
        address verifier = vm.envOr("AUTHORIZED_VERIFIER", address(0));
        if (verifier == address(0)) revert MissingAuthorizedVerifier();

        bool dryRun = vm.envOr("DRY_RUN", true);
        bool deployDemos = vm.envOr("DEPLOY_DEMOS", false);
        bool allowUnlistedChain = vm.envOr("ALLOW_UNLISTED_CHAIN", false);
        bool allowMainnetBroadcast = vm.envOr("ALLOW_MAINNET_BROADCAST", false);
        uint256 expectedChainId = vm.envOr("EXPECTED_CHAIN_ID", block.chainid);

        if (expectedChainId != block.chainid) {
            revert UnexpectedChain(expectedChainId, block.chainid);
        }
        if (
            !allowUnlistedChain && block.chainid != GALILEO_CHAIN_ID
                && block.chainid != MAINNET_CHAIN_ID
        ) {
            revert UnlistedChain(block.chainid);
        }

        uint256 deployerPrivateKey;
        if (!dryRun) {
            if (block.chainid == MAINNET_CHAIN_ID && !allowMainnetBroadcast) {
                revert MainnetBroadcastNotAuthorized();
            }
            deployerPrivateKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
            if (deployerPrivateKey == 0) revert MissingDeployerPrivateKey();
            vm.startBroadcast(deployerPrivateKey);
        }

        emit DeploymentReadiness(block.chainid, verifier, dryRun, deployDemos);

        guard = new ActionProofGuard(verifier);
        if (deployDemos) {
            demoCounter = new DemoCounter();
            demoToken = new DemoToken(guard.owner(), 1_000_000 ether);
            reentrantTarget = new ReentrantTarget(address(guard));
        }

        if (!dryRun) vm.stopBroadcast();

        emit DeploymentComplete(
            address(guard),
            address(demoCounter),
            address(demoToken),
            address(reentrantTarget),
            dryRun
        );
    }
}

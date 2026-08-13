// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Test/demo target that attempts to call a guard again during guarded execution.
contract ReentrantTarget {
    address public immutable guard;
    bytes private _reentryPayload;

    constructor(address guardAddress) {
        guard = guardAddress;
    }

    function setReentryPayload(bytes calldata payload) external {
        _reentryPayload = payload;
    }

    function triggerReentry() external payable {
        (bool success, bytes memory result) = guard.call(_reentryPayload);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address caller) external;
    function deal(address account, uint256 newBalance) external;
    function warp(uint256 newTimestamp) external;
    function chainId(uint256 newChainId) external;
    function assume(bool condition) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error AssertionFailed();
    error AssertionEqUint256(uint256 left, uint256 right);
    error AssertionEqAddress(address left, address right);
    error AssertionEqBytes32(bytes32 left, bytes32 right);
    error AssertionEqBool(bool left, bool right);

    function assertTrue(bool condition) internal pure {
        if (!condition) revert AssertionFailed();
    }

    function assertFalse(bool condition) internal pure {
        if (condition) revert AssertionFailed();
    }

    function assertEq(uint256 left, uint256 right) internal pure {
        if (left != right) revert AssertionEqUint256(left, right);
    }

    function assertEq(address left, address right) internal pure {
        if (left != right) revert AssertionEqAddress(left, right);
    }

    function assertEq(bytes32 left, bytes32 right) internal pure {
        if (left != right) revert AssertionEqBytes32(left, right);
    }

    function assertEq(bool left, bool right) internal pure {
        if (left != right) revert AssertionEqBool(left, right);
    }

    function bound(uint256 value, uint256 minimum, uint256 maximum)
        internal
        pure
        returns (uint256)
    {
        if (minimum > maximum) revert AssertionFailed();
        if (minimum == maximum) return minimum;
        return minimum + (value % (maximum - minimum + 1));
    }
}

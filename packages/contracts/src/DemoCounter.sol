// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract DemoCounter {
    error ForcedFailure(uint256 code);

    uint256 public number;
    uint256 public callCount;
    uint256 public totalValueReceived;
    address public lastCaller;

    event NumberChanged(address indexed caller, uint256 number, uint256 value);

    function setNumber(uint256 newNumber) external payable returns (uint256) {
        number = newNumber;
        callCount += 1;
        totalValueReceived += msg.value;
        lastCaller = msg.sender;
        emit NumberChanged(msg.sender, newNumber, msg.value);
        return newNumber;
    }

    function increment() external returns (uint256) {
        number += 1;
        callCount += 1;
        lastCaller = msg.sender;
        emit NumberChanged(msg.sender, number, 0);
        return number;
    }

    function fail(uint256 code) external pure {
        revert ForcedFailure(code);
    }
}

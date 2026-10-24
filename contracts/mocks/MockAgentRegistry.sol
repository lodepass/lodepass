// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Test registry: balanceOf > 0 means the wallet holds an Agent ID.
contract MockAgentRegistry {
    mapping(address => uint256) public balanceOf;

    function set(address wallet, uint256 v) external {
        balanceOf[wallet] = v;
    }
}

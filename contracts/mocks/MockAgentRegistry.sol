// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Registry tiruan untuk tes: balanceOf > 0 = pemegang Agent ID.
contract MockAgentRegistry {
    mapping(address => uint256) public balanceOf;

    function set(address wallet, uint256 v) external {
        balanceOf[wallet] = v;
    }
}

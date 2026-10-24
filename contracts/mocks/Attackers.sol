// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ILodepass {
    function mint(uint256 quantity) external payable;
    function redeem(uint256 units) external;
    function claim(uint256 tokenId) external;
    function earned(address who) external view returns (uint256);
    function balanceOf(address who) external view returns (uint256);
}

interface ILodeMarket {
    function buy(uint256 tokenId) external payable;
}

/// @dev Attacker 1: tries to mint again inside the ERC721 receive callback.
contract ReenterMint {
    ILodepass public target;
    uint256 public attempts;
    uint256 public maxAttempts = 3;

    constructor(address t) {
        target = ILodepass(t);
    }

    function attack(uint256 qty) external payable {
        target.mint{value: msg.value}(qty);
    }

    receive() external payable {}

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (attempts < maxAttempts) {
            attempts++;
            // coba mint lagi di dalam callback (reentrancy)
            try target.mint{value: 0}(1) {} catch {}
        }
        return this.onERC721Received.selector;
    }
}

/// @dev Attacker 2: tries to drain the pool by re-entering redeem while receiving BNB.
contract ReenterRedeem {
    ILodepass public target;
    uint256 public attempts;

    constructor(address t) {
        target = ILodepass(t);
    }

    function claimToken(uint256 tokenId) external {
        target.claim(tokenId);
    }

    function attack(uint256 units) external {
        target.redeem(units);
    }

    function earnedNow() external view returns (uint256) {
        return target.earned(address(this));
    }

    receive() external payable {
        if (attempts < 3) {
            attempts++;
            uint256 e = target.earned(address(this));
            if (e > 0) {
                try target.redeem(e) {} catch {}
            }
        }
    }
}

/// @dev Attacker 3: buys a piece then tries to buy again inside the callback.
contract ReenterBuy {
    ILodeMarket public market;
    uint256 public attempts;
    uint256 public tokenId;

    constructor(address m) {
        market = ILodeMarket(m);
    }

    function attack(uint256 id, uint256 price) external payable {
        tokenId = id;
        market.buy{value: price}(id);
    }

    receive() external payable {}

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (attempts < 2) {
            attempts++;
            try market.buy{value: 0}(tokenId) {} catch {}
        }
        return this.onERC721Received.selector;
    }
}

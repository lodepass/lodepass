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

/// @dev Penyerang 1: mencoba mint ulang saat menerima callback ERC721.
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

/// @dev Penyerang 2: mencoba menarik pool lewat redeem berulang saat menerima BNB.
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

/// @dev Penyerang 3: membeli keping lalu mencoba beli lagi di callback.
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

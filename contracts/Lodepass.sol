// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

interface IAgentRegistry {
    function balanceOf(address wallet) external view returns (uint256);
}

/// @title Lodepass
/// @notice On-chain mining pass for holders of a Binance Agent ID (.ai).
///         mint -> mine (on-chain yield) -> forge (3 pieces into 1 higher tier) -> claim.
///         Tanpa owner/pause/withdraw/setPrice: semua aturan dikunci di field immutable saat deploy.
///         Art 100% on-chain (SVG dari tokenId) + royalty ERC-2981 2,5%.
contract Lodepass is ERC721, IERC2981 {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 3333;
    uint256 public constant MAX_PER_WALLET = 5;
    uint256 public constant FREE_PER_WALLET = 1;
    /// @dev how many wallets may claim the free piece (set at deploy)
    uint256 public constant FORGE_COST = 3;
    uint256 public constant ROYALTY_BPS = 250; // 2.5% - the lowest rate marketplaces commonly honour

    IAgentRegistry public immutable agentRegistry;
    address payable public immutable treasury;
    uint256 public immutable priceWei;
    uint256 public immutable forgeFeeWei;
    /// @dev free pieces available across the whole collection (first N wallets)
    uint256 public immutable freeQuota;
    /// @dev price of 1 mining unit (1e18) in wei - the value floor, locked at deploy
    uint256 public immutable unitPriceWei;
    uint256 public immutable startTime;

    /// @dev BNB pool used to redeem mining units; the only funds this contract ever holds
    uint256 public rewardPool;

    uint256 public totalMinted;
    uint256 public totalBurned;
    /// @dev how many wallets already took their free piece
    uint256 public freeClaimers;

    mapping(address => uint256) public mintedBy;
    mapping(address => uint256) public freeUsed;

    mapping(uint256 => uint256) public forgedTier;
    mapping(uint256 => bool) public isForged;
    mapping(uint256 => uint256) public lastClaim;
    mapping(address => uint256) public earned;

    event Minted(address indexed minter, uint256 indexed tokenId, string tier, bool free);
    event Forged(address indexed owner, uint256[3] burned, uint256 indexed newTokenId, string tier);
    event Claimed(address indexed owner, uint256 indexed tokenId, uint256 amount);
    event RewardsFunded(address indexed from, uint256 amount, uint256 poolAfter);
    event Redeemed(address indexed owner, uint256 units, uint256 paidWei);

    error NotOpen();
    error NotAgent();
    error SoldOut();
    error WalletLimit();
    error BadQuantity();
    error WrongPayment();
    error TransferFailed();
    error NotOwner();
    error DuplicateToken();
    error NotEnoughEarned();
    error PoolTooSmall();

    constructor(
        address registry_,
        address payable treasury_,
        uint256 priceWei_,
        uint256 forgeFeeWei_,
        uint256 freeQuota_,
        uint256 unitPriceWei_,
        uint256 startTime_
    ) ERC721("Lodepass", "LODE") {
        require(registry_ != address(0) && treasury_ != address(0), "addr");
        agentRegistry = IAgentRegistry(registry_);
        treasury = treasury_;
        priceWei = priceWei_;
        forgeFeeWei = forgeFeeWei_;
        freeQuota = freeQuota_;
        unitPriceWei = unitPriceWei_;
        startTime = startTime_;
    }

    // ------------------------------------------------------------------ mint
    function mint(uint256 quantity) external payable {
        if (block.timestamp < startTime) revert NotOpen();
        if (quantity == 0 || quantity > MAX_PER_WALLET) revert BadQuantity();
        // Gate: Binance Agent ID (.ai) holders only, read from the on-chain registry.
        if (agentRegistry.balanceOf(msg.sender) == 0) revert NotAgent();
        if (mintedBy[msg.sender] + quantity > MAX_PER_WALLET) revert WalletLimit();
        if (totalMinted + quantity > MAX_SUPPLY) revert SoldOut();

        uint256 freeLeft = FREE_PER_WALLET - freeUsed[msg.sender];
        uint256 freeQty = quantity < freeLeft ? quantity : freeLeft;
        // free tier is capped collection-wide: first `freeQuota` wallets only
        uint256 quotaLeft = freeQuota > freeClaimers ? freeQuota - freeClaimers : 0;
        if (freeQty > quotaLeft) freeQty = quotaLeft;
        if (freeQty > 0 && freeUsed[msg.sender] == 0) freeClaimers += 1;
        uint256 paidQty = quantity - freeQty;
        if (msg.value != paidQty * priceWei) revert WrongPayment();

        freeUsed[msg.sender] += freeQty;
        mintedBy[msg.sender] += quantity;

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = ++totalMinted;
            bool isFree = i < freeQty;
            lastClaim[tokenId] = block.timestamp;
            _safeMint(msg.sender, tokenId);
            emit Minted(msg.sender, tokenId, tierName(tokenId), isFree);
        }

        _forward(msg.value);
    }

    // ------------------------------------------------------------------ forge: 3 pieces -> 1 higher tier
    function forge(uint256[3] calldata ids) external payable returns (uint256 newTokenId) {
        if (ids[0] == ids[1] || ids[1] == ids[2] || ids[0] == ids[2]) revert DuplicateToken();
        if (totalMinted + 1 > MAX_SUPPLY) revert SoldOut();
        if (msg.value != forgeFeeWei) revert WrongPayment();

        uint256 best;
        for (uint256 i = 0; i < 3; i++) {
            if (ownerOf(ids[i]) != msg.sender) revert NotOwner();
            uint256 t = tierOf(ids[i]);
            if (t > best) best = t;
        }

        // settle unclaimed yield first, then burn the pieces
        for (uint256 i = 0; i < 3; i++) {
            earned[msg.sender] += _pending(ids[i]);
            delete lastClaim[ids[i]];
            _burn(ids[i]);
        }
        totalBurned += 3;

        newTokenId = ++totalMinted;
        uint256 newTier = best + 1 > 3 ? 3 : best + 1;
        forgedTier[newTokenId] = newTier;
        isForged[newTokenId] = true;
        lastClaim[newTokenId] = block.timestamp;
        _safeMint(msg.sender, newTokenId);

        emit Forged(msg.sender, ids, newTokenId, tierName(newTokenId));
        _forward(msg.value);
    }

    function _forward(uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = treasury.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ------------------------------------------------------------------ mine / claim
    /// @dev mining rate per day (1e18 units): tier 0..3
    function rateOf(uint256 tokenId) public view returns (uint256) {
        uint8 t = tierOf(tokenId);
        if (t == 0) return 1e18;
        if (t == 1) return 3e18;
        if (t == 2) return 8e18;
        return 20e18;
    }

    function _pending(uint256 tokenId) internal view returns (uint256) {
        if (_ownerOf(tokenId) == address(0)) return 0;
        uint256 since = lastClaim[tokenId];
        if (since == 0) return 0;
        return (rateOf(tokenId) * (block.timestamp - since)) / 1 days;
    }

    function pending(uint256 tokenId) public view returns (uint256) {
        return _pending(tokenId);
    }

    function claim(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotOwner();
        uint256 amount = _pending(tokenId);
        lastClaim[tokenId] = block.timestamp;
        earned[msg.sender] += amount;
        emit Claimed(msg.sender, tokenId, amount);
    }

    // ------------------------------------------------------------------ tukar hasil tambang jadi BNB
    /// @notice anyone can top up the pool (treasury does it from mint proceeds)
    function fundRewards() external payable {
        require(msg.value > 0, "zero");
        rewardPool += msg.value;
        emit RewardsFunded(msg.sender, msg.value, rewardPool);
    }

    /// @notice how much BNB a number of units is worth
    function quoteRedeem(uint256 units) public view returns (uint256) {
        return (units * unitPriceWei) / 1e18;
    }

    /// @notice swap mined units for BNB out of the pool
    function redeem(uint256 units) external {
        if (units == 0 || earned[msg.sender] < units) revert NotEnoughEarned();
        uint256 amount = quoteRedeem(units);
        if (amount > rewardPool) revert PoolTooSmall();
        earned[msg.sender] -= units;
        rewardPool -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Redeemed(msg.sender, units, amount);
    }

    // ------------------------------------------------------------------ royalty (ERC-2981)
    function royaltyInfo(uint256, uint256 salePrice) external view override returns (address, uint256) {
        return (treasury, (salePrice * ROYALTY_BPS) / 10_000);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }

    // ------------------------------------------------------------------ tier
    /// @dev 0 Common (60%) / 1 Uncommon (25%) / 2 Rare (12%) / 3 Legendary (3%)
    function tierOf(uint256 tokenId) public view returns (uint8) {
        if (isForged[tokenId]) return uint8(forgedTier[tokenId]);
        uint256 h = uint256(keccak256(abi.encodePacked(tokenId))) % 100;
        if (h < 60) return 0;
        if (h < 85) return 1;
        if (h < 97) return 2;
        return 3;
    }

    function tierName(uint256 tokenId) public view returns (string memory) {
        uint8 t = tierOf(tokenId);
        if (t == 0) return "Common";
        if (t == 1) return "Uncommon";
        if (t == 2) return "Rare";
        return "Legendary";
    }

    // ------------------------------------------------------------------ art on-chain
    struct Palette {
        string bg0;
        string bg1;
        string accent;
        string ink;
        string gemLight;
        string gemDark;
    }

    function _palette(uint256 tokenId) internal view returns (Palette memory p) {
        uint8 t = tierOf(tokenId);
        if (t == 0) {
            p = Palette("#070a0d", "#121a22", "#7f95a8", "#c9d6e2", "#8aa3b8", "#2b3947");
        } else if (t == 1) {
            p = Palette("#04120c", "#0e2a1b", "#48d18a", "#d6f5e4", "#6ee7a8", "#14503a");
        } else if (t == 2) {
            p = Palette("#0a0718", "#1d1440", "#a78bfa", "#ece6ff", "#c4b5fd", "#3b2a7a");
        } else {
            p = Palette("#120b02", "#2e1d05", "#f5c76a", "#fff4d6", "#ffe9a8", "#7a5518");
        }
    }

    function _gem(uint256 tokenId) internal view returns (string memory) {
        Palette memory p = _palette(tokenId);
        uint8 t = tierOf(tokenId);

        string memory extras = "";
        if (t >= 1) {
            extras = string.concat(
                extras,
                '<polygon points="200,120 269,160 269,240 200,280 131,240 131,160" fill="none" stroke="',
                p.accent,
                '" stroke-width="1.2" opacity="0.55"/>'
            );
        }
        if (t >= 2) {
            extras = string.concat(
                extras,
                '<g stroke="', p.accent, '" stroke-width="1.4" opacity="0.5">',
                '<line x1="200" y1="96" x2="200" y2="112"/><line x1="290" y1="148" x2="272" y2="157"/>',
                '<line x1="290" y1="252" x2="272" y2="243"/><line x1="200" y1="304" x2="200" y2="288"/>',
                '<line x1="110" y1="252" x2="128" y2="243"/><line x1="110" y1="148" x2="128" y2="157"/>',
                "</g>"
            );
        }
        if (t == 3) {
            string memory rays = "";
            for (uint256 i = 0; i < 12; i++) {
                rays = string.concat(
                    rays,
                    '<line x1="200" y1="70" x2="200" y2="92" stroke="',
                    p.accent,
                    '" stroke-width="2" opacity="0.7" transform="rotate(',
                    (i * 30).toString(),
                    ' 200 200)"/>'
                );
            }
            extras = string.concat(extras, rays);
        }

        return string.concat(
            '<circle cx="200" cy="200" r="118" fill="', p.accent, '" opacity="0.13" filter="url(#blur)"/>',
            '<polygon points="200,84 300,142 300,258 200,316 100,258 100,142" fill="', p.gemDark, '"/>',
            '<polygon points="200,84 300,142 200,200 100,142" fill="', p.gemLight, '" opacity="0.92"/>',
            '<polygon points="200,200 300,142 300,258 200,316" fill="', p.gemDark, '" opacity="0.95"/>',
            '<polygon points="200,200 100,142 100,258 200,316" fill="', p.gemLight, '" opacity="0.35"/>',
            '<g stroke="', p.accent, '" stroke-width="1" opacity="0.35">',
            '<line x1="200" y1="200" x2="200" y2="84"/><line x1="200" y1="200" x2="300" y2="142"/>',
            '<line x1="200" y1="200" x2="100" y2="142"/></g>',
            '<polygon points="200,84 300,142 300,258 200,316 100,258 100,142" fill="none" stroke="',
            p.accent,
            '" stroke-width="2.2"/>',
            extras
        );
    }

    function _strata(uint256 tokenId) internal view returns (string memory) {
        Palette memory p = _palette(tokenId);
        uint256 seed = uint256(keccak256(abi.encodePacked("strata", tokenId)));
        string memory out = "";
        for (uint256 i = 0; i < 4; i++) {
            uint256 y = 330 + i * 16 + ((seed >> (i * 5)) & 0x07);
            out = string.concat(
                out,
                '<path d="M -20 ',
                y.toString(),
                " Q 120 ",
                (y - 26).toString(),
                " 220 ",
                y.toString(),
                " T 420 ",
                (y + 6).toString(),
                '" stroke="',
                p.accent,
                '" stroke-width="1" fill="none" opacity="0.28"/>'
            );
        }
        return out;
    }

    function _frame(uint256 tokenId) internal view returns (string memory) {
        Palette memory p = _palette(tokenId);
        return string.concat(
            '<g stroke="',
            p.accent,
            '" stroke-width="1.4" opacity="0.75" fill="none">',
            '<path d="M 26 62 L 26 26 L 62 26"/><path d="M 338 26 L 374 26 L 374 62"/>',
            '<path d="M 26 338 L 26 374 L 62 374"/><path d="M 374 338 L 374 374 L 338 374"/>',
            "</g>"
        );
    }

    function _upper(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x61 && b[i] <= 0x7A) b[i] = bytes1(uint8(b[i]) - 32);
        }
        return string(b);
    }

    function svgOf(uint256 tokenId) public view returns (string memory) {
        Palette memory p = _palette(tokenId);
        string memory rate = (rateOf(tokenId) / 1e18).toString();
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">',
            "<defs>",
            '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0%" stop-color="',
            p.bg1,
            '"/><stop offset="100%" stop-color="',
            p.bg0,
            '"/>',
            "</linearGradient>",
            '<filter id="blur"><feGaussianBlur stdDeviation="18"/></filter>',
            '<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3"/>',
            '<feColorMatrix type="saturate" values="0"/></filter>',
            "</defs>",
            '<rect width="400" height="400" fill="url(#bg)"/>',
            '<rect width="400" height="400" filter="url(#grain)" opacity="0.05"/>',
            _strata(tokenId),
            _gem(tokenId),
            _frame(tokenId),
            '<rect x="20" y="20" width="360" height="360" fill="none" stroke="',
            p.accent,
            '" stroke-width="0.8" opacity="0.22"/>',
            '<text x="40" y="52" fill="',
            p.ink,
            '" font-family="monospace" font-size="12" letter-spacing="6" opacity="0.85">LODEPASS</text>',
            '<text x="360" y="52" fill="',
            p.accent,
            '" font-family="monospace" font-size="11" letter-spacing="3" text-anchor="end">S1 - BNB</text>',
            '<text x="200" y="212" fill="',
            p.ink,
            '" font-family="monospace" font-size="42" font-weight="bold" text-anchor="middle">',
            tokenId.toString(),
            "</text>",
            '<text x="200" y="236" fill="',
            p.ink,
            '" font-family="monospace" font-size="9" letter-spacing="2" text-anchor="middle" opacity="0.55">EDITION ',
            tokenId.toString(),
            " / 3333</text>",
            '<text x="200" y="352" fill="',
            p.accent,
            '" font-family="monospace" font-size="15" letter-spacing="7" text-anchor="middle">',
            _upper(tierName(tokenId)),
            "</text>",
            '<text x="200" y="372" fill="',
            p.ink,
            '" font-family="monospace" font-size="10.5" letter-spacing="3" text-anchor="middle" opacity="0.9">',
            rate,
            " LODE / DAY",
            "</text>",
            "</svg>"
        );
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory json = string.concat(
            '{"name":"Lodepass #',
            tokenId.toString(),
            '","description":"Mining pass for holders of a Binance Agent ID (.ai). Art, rarity and yield are generated on-chain. Hold to mine, forge 3 into a higher tier.",',
            '"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svgOf(tokenId))),
            '","attributes":[{"trait_type":"Tier","value":"',
            tierName(tokenId),
            '"},{"trait_type":"Rate","value":',
            (rateOf(tokenId) / 1e18).toString(),
            '},{"trait_type":"Forged","value":"',
            isForged[tokenId] ? "yes" : "no",
            '"},{"trait_type":"Token","value":',
            tokenId.toString(),
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}

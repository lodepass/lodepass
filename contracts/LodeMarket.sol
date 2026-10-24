// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title LodeMarket
/// @notice Pasar sekunder Lodepass: list / cancel / buy. Fee 2% ke treasury, semuanya immutable.
///         Tanpa owner, tanpa pause, tanpa withdraw: fee langsung diteruskan ke treasury saat penjualan.
contract LodeMarket {
    uint256 public constant FEE_BPS = 200; // 2%

    IERC721 public immutable collection;
    address payable public immutable treasury;

    struct Listing {
        address seller;
        uint96 price;
        uint64 expiry;
    }

    mapping(uint256 => Listing) public listing;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price, uint64 expiry);
    event Cancelled(uint256 indexed tokenId, address indexed seller);
    event Sold(uint256 indexed tokenId, address indexed buyer, address indexed seller, uint256 price, uint256 fee);

    error NotOwner();
    error NotApproved();
    error BadPrice();
    error BadExpiry();
    error NotListed();
    error Expired();
    error WrongPayment();
    error BuyerIsSeller();
    error TransferFailed();

    constructor(address collection_, address payable treasury_) {
        require(collection_ != address(0) && treasury_ != address(0), "addr");
        collection = IERC721(collection_);
        treasury = treasury_;
    }

    function list(uint256 tokenId, uint256 price, uint64 durationDays) external {
        if (collection.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (price == 0) revert BadPrice();
        if (durationDays == 0 || durationDays > 365) revert BadExpiry();
        // NFT harus di-approve ke pasar ini dulu (per-token atau setApprovalForAll)
        if (
            collection.getApproved(tokenId) != address(this) &&
            !collection.isApprovedForAll(msg.sender, address(this))
        ) revert NotApproved();

        uint64 expiry = uint64(block.timestamp) + durationDays * 1 days;
        listing[tokenId] = Listing(msg.sender, uint96(price), expiry);
        emit Listed(tokenId, msg.sender, price, expiry);
    }

    function cancel(uint256 tokenId) external {
        Listing memory l = listing[tokenId];
        if (l.seller != msg.sender) revert NotOwner();
        delete listing[tokenId];
        emit Cancelled(tokenId, msg.sender);
    }

    function buy(uint256 tokenId) external payable {
        Listing memory l = listing[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (l.expiry != 0 && block.timestamp > l.expiry) revert Expired();
        if (msg.sender == l.seller) revert BuyerIsSeller();
        if (msg.value != l.price) revert WrongPayment();

        delete listing[tokenId];

        uint256 fee = (uint256(l.price) * FEE_BPS) / 10_000;
        uint256 toSeller = uint256(l.price) - fee;

        collection.safeTransferFrom(l.seller, msg.sender, tokenId);

        if (fee > 0) {
            (bool ok1,) = treasury.call{value: fee}("");
            if (!ok1) revert TransferFailed();
        }
        (bool ok2,) = payable(l.seller).call{value: toSeller}("");
        if (!ok2) revert TransferFailed();

        emit Sold(tokenId, msg.sender, l.seller, l.price, fee);
    }

    /// @notice harga total yang harus dikirim pembeli untuk sebuah keping
    function quote(uint256 tokenId) external view returns (uint256 price, uint256 fee, address seller, uint64 expiry) {
        Listing memory l = listing[tokenId];
        price = l.price;
        fee = (uint256(l.price) * FEE_BPS) / 10_000;
        seller = l.seller;
        expiry = l.expiry;
    }
}

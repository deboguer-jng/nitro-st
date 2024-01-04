// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/tokens/ERC20/IERC20.sol";

import "./Dependencies/CheckContract.sol";
import "./Interfaces/IUToken.sol";

contract UToken is CheckContract, Ownable, IUToken {

	address public immutable troveManagerAddress;
	address public immutable redemptionManagerAddress;
	IStabilityPoolManager public immutable stabilityPoolManager;
	address public immutable borrowerOperationsAddress;

	mapping(address => bool) public emergencyStopMintingCollateral;

	event EmergencyStopMintingCollateral(address _asset, bool state);
	event SwapMint(address _asset, address _account, uint256 _amount);
	event SwapRedeem(address _asset, uint256 _amount);

	mapping(IERC20 => bool) public allowedSwapMintTokens;
	mapping(IERC20 => bool) public allowedSwapRedeemTokens;

	constructor(
		address _troveManagerAddress,
		address _redemptionManagerAddress,
		address _stabilityPoolManagerAddress,
		address _borrowerOperationsAddress
	) UERC20Permit("U BTC", "uBTC", 8, 0x3c2269811836af69497E5F486A85D7316753cf62) {
		checkContract(_troveManagerAddress);
		checkContract(_stabilityPoolManagerAddress);
		checkContract(_borrowerOperationsAddress);
		checkContract(_redemptionManagerAddress);

		troveManagerAddress = _troveManagerAddress;
		emit TroveManagerAddressChanged(_troveManagerAddress);

		redemptionManagerAddress = _redemptionManagerAddress;

		stabilityPoolManager = IStabilityPoolManager(_stabilityPoolManagerAddress);
		emit StabilityPoolAddressChanged(_stabilityPoolManagerAddress);

		borrowerOperationsAddress = _borrowerOperationsAddress;
		emit BorrowerOperationsAddressChanged(_borrowerOperationsAddress);
	}

	// --- Functions for intra-You calls ---

	//
	function emergencyStopMinting(address _asset, bool status) external override onlyOwner {
		emergencyStopMintingCollateral[_asset] = status;
		emit EmergencyStopMintingCollateral(_asset, status);
	}

	function allowSwapMint(IERC20 _asset, bool status) external onlyOwner {
		allowedSwapMintTokens[_asset] = status;
	}

	function allowSwapRedeem(IERC20 _asset, bool status) external onlyOwner {
		allowedSwapRedeemTokens[_asset] = status;
	}

	function mint(address _asset, address _account, uint256 _amount) external override {
		_requireCallerIsBorrowerOperations();
		require(!emergencyStopMintingCollateral[_asset], "Mint is blocked on this collateral");

		_mint(_account, _amount);
	}

	function swapMint(IERC20 _asset, address _account, uint256 _amount) external {
		require(allowedSwapMintTokens[_asset], "Minting not allowed on this asset");
		require(_asset.transferFrom(msg.sender, _amount));
		_mint(_account, _amount);
		emit SwapMint(_asset, _account, _amount);
	}

	function swapRedeem(address _asset, uint256 _amount) external {
		require(allowedSwapRedeemTokens[_asset], "Redemption not allowed on this asset");
		require(_asset.transfer(msg.sender, _amount));
		_burn(msg.sender, _amount);
		emit SwapRedeem(_asset, _amount);
	}

	function burn(address _account, uint256 _amount) external override {
		_requireCallerIsBOorTroveMorSP();
		_burn(_account, _amount);
	}

	function sendToPool(
		address _sender,
		address _poolAddress,
		uint256 _amount
	) external override {
		_requireCallerIsStabilityPool();
		_transfer(_sender, _poolAddress, _amount);
	}

	function returnFromPool(
		address _poolAddress,
		address _receiver,
		uint256 _amount
	) external override {
		_requireCallerIsTroveMorSP();
		_transfer(_poolAddress, _receiver, _amount);
	}

	// --- External functions ---

	function transfer(address recipient, uint256 amount) public override returns (bool) {
		_requireValidRecipient(recipient);
		return super.transfer(recipient, amount);
	}

	function transferFrom(
		address sender,
		address recipient,
		uint256 amount
	) public override returns (bool) {
		_requireValidRecipient(recipient);
		return super.transferFrom(sender, recipient, amount);
	}

	// --- 'require' functions ---

	function _requireValidRecipient(address _recipient) internal view {
		require(
			_recipient != address(0) && _recipient != address(this),
			"U: Cannot transfer tokens directly to the U token contract or the zero address"
		);
		require(
			!stabilityPoolManager.isStabilityPool(_recipient) &&
				_recipient != troveManagerAddress &&
				_recipient != redemptionManagerAddress &&
				_recipient != borrowerOperationsAddress,
			"U: Cannot transfer tokens directly to the StabilityPool, TroveManager, RedemptionManager or BorrowerOps"
		);
	}

	function _requireCallerIsBorrowerOperations() internal view {
		require(
			msg.sender == borrowerOperationsAddress,
			"UToken: Caller is not BorrowerOperations"
		);
	}

	function _requireCallerIsBOorTroveMorSP() internal view {
		require(
			msg.sender == borrowerOperationsAddress ||
				msg.sender == redemptionManagerAddress ||
				stabilityPoolManager.isStabilityPool(msg.sender),
			"U: Caller is neither BorrowerOperations nor RedemptionManager nor StabilityPool"
		);
	}

	function _requireCallerIsStabilityPool() internal view {
		require(
			stabilityPoolManager.isStabilityPool(msg.sender),
			"U: Caller is not the StabilityPool"
		);
	}

	function _requireCallerIsTroveMorSP() internal view {
		require(
			msg.sender == troveManagerAddress || stabilityPoolManager.isStabilityPool(msg.sender),
			"U: Caller is neither TroveManager nor StabilityPool"
		);
	}
}

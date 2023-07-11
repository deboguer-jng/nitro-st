// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./Interfaces/IDefaultPool.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/SafetyTransfer.sol";
import "./Dependencies/ArbitroveBase.sol";

/*
 * The Default Pool holds the ETH and U debt (but not U tokens) from liquidations that have been redistributed
 * to active troves but not yet "applied", i.e. not yet recorded on a recipient active trove's struct.
 *
 * When a trove makes an operation that applies its pending ETH and U debt, its pending ETH and U debt is moved
 * from the Default Pool to the Active Pool.
 */
contract DefaultPool is OwnableUpgradeable, CheckContract, ArbitroveBase, IDefaultPool {
	using SafeMathUpgradeable for uint256;
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "DefaultPool";

	address constant ETH_REF_ADDRESS = address(0);

	address public troveManagerAddress;
	address public redemptionManagerAddress;
	address public activePoolAddress;

	bool public isInitialized;

	mapping(address => uint256) internal assetsBalance;
	mapping(address => uint256) internal UDebts; // debt

	// --- Dependency setters ---

	function setAddresses(
		address _troveManagerAddress,
		address _redemptionManagerAddress,
		address _activePoolAddress,
		address _wstETHAddress
	) external initializer {
		require(!isInitialized, "Already initialized");
		checkContract(_troveManagerAddress);
		checkContract(_activePoolAddress);
		checkContract(_redemptionManagerAddress);
		checkContract(_wstETHAddress);
		isInitialized = true;

		__Ownable_init();

		troveManagerAddress = _troveManagerAddress;
		redemptionManagerAddress = _redemptionManagerAddress;
		activePoolAddress = _activePoolAddress;
		wstETH = _wstETHAddress;

		emit TroveManagerAddressChanged(_troveManagerAddress);
		emit ActivePoolAddressChanged(_activePoolAddress);

		renounceOwnership();
	}

	// --- Getters for public variables. Required by IPool interface ---

	/*
	 * Returns the ETH state variable.
	 *
	 * Not necessarily equal to the the contract's raw ETH balance - ether can be forcibly sent to contracts.
	 */
	function getAssetBalance(
		address _asset
	) external view override onlyWstETH(_asset) returns (uint256) {
		return assetsBalance[_asset];
	}

	function getUDebt(
		address _asset
	) external view override onlyWstETH(_asset) returns (uint256) {
		return UDebts[_asset];
	}

	// --- Pool functionality ---

	function sendAssetToActivePool(
		address _asset,
		uint256 _amount
	) external override onlyWstETH(_asset) callerIsTroveManager {
		address activePool = activePoolAddress; // cache to save an SLOAD

		uint256 safetyTransferAmount = SafetyTransfer.decimalsCorrection(_asset, _amount);
		if (safetyTransferAmount == 0) return;

		assetsBalance[_asset] = assetsBalance[_asset].sub(_amount);

		if (_asset != ETH_REF_ADDRESS) {
			IERC20Upgradeable(_asset).safeTransfer(activePool, safetyTransferAmount);
			IDeposit(activePool).receivedERC20(_asset, _amount);
		} else {
			(bool success, ) = activePool.call{ value: _amount }("");
			require(success, "DefaultPool: sending ETH failed");
		}

		emit DefaultPoolAssetBalanceUpdated(_asset, assetsBalance[_asset]);
		emit AssetSent(activePool, _asset, safetyTransferAmount);
	}

	function increaseUDebt(
		address _asset,
		uint256 _amount
	) external override onlyWstETH(_asset) callerIsTroveManager {
		UDebts[_asset] = UDebts[_asset].add(_amount);
		emit DefaultPoolUDebtUpdated(_asset, UDebts[_asset]);
	}

	function decreaseUDebt(
		address _asset,
		uint256 _amount
	) external override onlyWstETH(_asset) callerIsTroveManager {
		UDebts[_asset] = UDebts[_asset].sub(_amount);
		emit DefaultPoolUDebtUpdated(_asset, UDebts[_asset]);
	}

	// --- 'require' functions ---

	modifier callerIsActivePool() {
		require(msg.sender == activePoolAddress, "DefaultPool: Caller is not the ActivePool");
		_;
	}

	modifier callerIsTroveManager() {
		require(
			msg.sender == troveManagerAddress || msg.sender == redemptionManagerAddress,
			"DefaultPool: Caller is not the TroveManager nor RedemptionManager"
		);
		_;
	}

	function receivedERC20(
		address _asset,
		uint256 _amount
	) external override onlyWstETH(_asset) callerIsActivePool {
		require(_asset != ETH_REF_ADDRESS, "ETH Cannot use this functions");

		assetsBalance[_asset] = assetsBalance[_asset].add(_amount);
		emit DefaultPoolAssetBalanceUpdated(_asset, assetsBalance[_asset]);
	}

	// --- Fallback function ---

	receive() external payable callerIsActivePool {
		assetsBalance[ETH_REF_ADDRESS] = assetsBalance[ETH_REF_ADDRESS].add(msg.value);
		emit DefaultPoolAssetBalanceUpdated(ETH_REF_ADDRESS, assetsBalance[ETH_REF_ADDRESS]);
	}
}

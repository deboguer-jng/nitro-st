// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "../Dependencies/BaseMath.sol";
import "../Dependencies/CheckContract.sol";
import "../Dependencies/VestaMath.sol";
import "../Interfaces/IYOUStaking.sol";
import "../Interfaces/IDeposit.sol";
import "../Dependencies/SafetyTransfer.sol";

contract YOUStaking is
	IYOUStaking,
	PausableUpgradeable,
	OwnableUpgradeable,
	CheckContract,
	BaseMath,
	ReentrancyGuardUpgradeable
{
	using SafeMathUpgradeable for uint256;
	using SafeERC20Upgradeable for IERC20Upgradeable;

	bool public isInitialized;

	// --- Data ---
	string public constant NAME = "YOUStaking";
	address constant ETH_REF_ADDRESS = address(0);

	mapping(address => uint256) public stakes;
	uint256 public totalYOUStaked;

	mapping(address => uint256) public F_ASSETS; // Running sum of ETH fees per-YOU-staked
	uint256 public F_U; // Running sum of YOU fees per-YOU-staked

	// User snapshots of F_ETH and F_U, taken at the point at which their latest deposit was made
	mapping(address => Snapshot) public snapshots;

	struct Snapshot {
		mapping(address => uint256) F_ASSET_Snapshot;
		uint256 F_U_Snapshot;
	}

	address[] ASSET_TYPE;
	mapping(address => bool) isAssetTracked;
	mapping(address => uint256) public sentToTreasuryTracker;

	IERC20Upgradeable public override youToken;
	IERC20Upgradeable public uToken;

	address public troveManagerAddress;
	address public borrowerOperationsAddress;
	address public activePoolAddress;
	address public treasury;

	// --- Functions ---
	function setAddresses(
		address _youTokenAddress,
		address _uTokenAddress,
		address _troveManagerAddress,
		address _borrowerOperationsAddress,
		address _activePoolAddress,
		address _treasury
	) external override initializer {
		require(!isInitialized, "Already Initialized");
		require(_treasury != address(0), "Invalid Treausry Address");
		checkContract(_youTokenAddress);
		checkContract(_uTokenAddress);
		checkContract(_troveManagerAddress);
		checkContract(_borrowerOperationsAddress);
		checkContract(_activePoolAddress);
		isInitialized = true;

		__Pausable_init();
		__ReentrancyGuard_init();
		__Ownable_init();
		_pause();

		youToken = IERC20Upgradeable(_youTokenAddress);
		uToken = IERC20Upgradeable(_uTokenAddress);
		troveManagerAddress = _troveManagerAddress;
		borrowerOperationsAddress = _borrowerOperationsAddress;
		activePoolAddress = _activePoolAddress;
		treasury = _treasury;

		isAssetTracked[ETH_REF_ADDRESS] = true;
		ASSET_TYPE.push(ETH_REF_ADDRESS);

		emit YOUTokenAddressSet(_youTokenAddress);
		emit YOUTokenAddressSet(_uTokenAddress);
		emit TroveManagerAddressSet(_troveManagerAddress);
		emit BorrowerOperationsAddressSet(_borrowerOperationsAddress);
		emit ActivePoolAddressSet(_activePoolAddress);
	}

	// If caller has a pre-existing stake, send any accumulated ETH and U gains to them.
	function stake(uint256 _YOUamount) external override nonReentrant whenNotPaused {
		require(_YOUamount > 0);

		uint256 currentStake = stakes[msg.sender];

		uint256 assetLength = ASSET_TYPE.length;
		uint256 AssetGain;
		address asset;

		for (uint256 i = 0; i < assetLength; i++) {
			asset = ASSET_TYPE[i];

			if (currentStake != 0) {
				AssetGain = _getPendingAssetGain(asset, msg.sender);

				if (i == 0) {
					uint256 UGain = _getPendingUGain(msg.sender);
					uToken.transfer(msg.sender, UGain);

					emit StakingGainsUWithdrawn(msg.sender, UGain);
				}

				_sendAssetGainToUser(asset, AssetGain);
				emit StakingGainsAssetWithdrawn(msg.sender, asset, AssetGain);
			}

			_updateUserSnapshots(asset, msg.sender);
		}

		uint256 newStake = currentStake.add(_YOUamount);

		// Increase user’s stake and total YOU staked
		stakes[msg.sender] = newStake;
		totalYOUStaked = totalYOUStaked.add(_YOUamount);
		emit TotalYOUStakedUpdated(totalYOUStaked);

		// Transfer YOU from caller to this contract
		youToken.transferFrom(msg.sender, address(this), _YOUamount);

		emit StakeChanged(msg.sender, newStake);
	}

	// Unstake the YOU and send the it back to the caller, along with their accumulated U & ETH gains.
	// If requested amount > stake, send their entire stake.
	function unstake(uint256 _YOUamount) external override nonReentrant {
		uint256 currentStake = stakes[msg.sender];
		_requireUserHasStake(currentStake);

		uint256 assetLength = ASSET_TYPE.length;
		uint256 AssetGain;
		address asset;

		for (uint256 i = 0; i < assetLength; i++) {
			asset = ASSET_TYPE[i];

			// Grab any accumulated ETH and U gains from the current stake
			AssetGain = _getPendingAssetGain(asset, msg.sender);

			if (i == 0) {
				uint256 UGain = _getPendingUGain(msg.sender);
				uToken.transfer(msg.sender, UGain);
				emit StakingGainsUWithdrawn(msg.sender, UGain);
			}

			_updateUserSnapshots(asset, msg.sender);
			emit StakingGainsAssetWithdrawn(msg.sender, asset, AssetGain);

			_sendAssetGainToUser(asset, AssetGain);
		}

		if (_YOUamount > 0) {
			uint256 YOUToWithdraw = VestaMath._min(_YOUamount, currentStake);

			uint256 newStake = currentStake.sub(YOUToWithdraw);

			// Decrease user's stake and total YOU staked
			stakes[msg.sender] = newStake;
			totalYOUStaked = totalYOUStaked.sub(YOUToWithdraw);
			emit TotalYOUStakedUpdated(totalYOUStaked);

			// Transfer unstaked YOU to user
			youToken.transfer(msg.sender, YOUToWithdraw);

			emit StakeChanged(msg.sender, newStake);
		}
	}

	function pause() public onlyOwner {
		_pause();
	}

	function unpause() public onlyOwner {
		_unpause();
	}

	function changeTreasuryAddress(address _treasury) public onlyOwner {
		treasury = _treasury;
		emit TreasuryAddressChanged(_treasury);
	}

	// --- Reward-per-unit-staked increase functions. Called by Vesta core contracts ---

	function increaseF_Asset(
		address _asset,
		uint256 _AssetFee
	) external override callerIsTroveManager {
		if (paused()) {
			sendToTreasury(_asset, _AssetFee);
			return;
		}

		if (!isAssetTracked[_asset]) {
			isAssetTracked[_asset] = true;
			ASSET_TYPE.push(_asset);
		}

		uint256 AssetFeePerYOUStaked;

		if (totalYOUStaked > 0) {
			AssetFeePerYOUStaked = _AssetFee.mul(DECIMAL_PRECISION).div(totalYOUStaked);
		}

		F_ASSETS[_asset] = F_ASSETS[_asset].add(AssetFeePerYOUStaked);
		emit F_AssetUpdated(_asset, F_ASSETS[_asset]);
	}

	function increaseF_U(uint256 _UFee) external override callerIsBorrowerOperations {
		if (paused()) {
			sendToTreasury(address(uToken), _UFee);
			return;
		}

		uint256 UFeePerYOUStaked;

		if (totalYOUStaked > 0) {
			UFeePerYOUStaked = _UFee.mul(DECIMAL_PRECISION).div(totalYOUStaked);
		}

		F_U = F_U.add(UFeePerYOUStaked);
		emit F_UUpdated(F_U);
	}

	function sendToTreasury(address _asset, uint256 _amount) internal {
		_sendAsset(treasury, _asset, _amount);
		sentToTreasuryTracker[_asset] += _amount;

		emit SentToTreasury(_asset, _amount);
	}

	// --- Pending reward functions ---

	function getPendingAssetGain(
		address _asset,
		address _user
	) external view override returns (uint256) {
		return _getPendingAssetGain(_asset, _user);
	}

	function _getPendingAssetGain(
		address _asset,
		address _user
	) internal view returns (uint256) {
		uint256 F_ASSET_Snapshot = snapshots[_user].F_ASSET_Snapshot[_asset];
		uint256 AssetGain = stakes[_user].mul(F_ASSETS[_asset].sub(F_ASSET_Snapshot)).div(
			DECIMAL_PRECISION
		);
		return AssetGain;
	}

	function getPendingUGain(address _user) external view override returns (uint256) {
		return _getPendingUGain(_user);
	}

	function _getPendingUGain(address _user) internal view returns (uint256) {
		uint256 F_U_Snapshot = snapshots[_user].F_U_Snapshot;
		uint256 UGain = stakes[_user].mul(F_U.sub(F_U_Snapshot)).div(DECIMAL_PRECISION);
		return UGain;
	}

	// --- Internal helper functions ---

	function _updateUserSnapshots(address _asset, address _user) internal {
		snapshots[_user].F_ASSET_Snapshot[_asset] = F_ASSETS[_asset];
		snapshots[_user].F_U_Snapshot = F_U;
		emit StakerSnapshotsUpdated(_user, F_ASSETS[_asset], F_U);
	}

	function _sendAssetGainToUser(address _asset, uint256 _assetGain) internal {
		_assetGain = SafetyTransfer.decimalsCorrection(_asset, _assetGain);
		_sendAsset(msg.sender, _asset, _assetGain);
		emit AssetSent(_asset, msg.sender, _assetGain);
	}

	function _sendAsset(address _sendTo, address _asset, uint256 _amount) internal {
		if (_asset == ETH_REF_ADDRESS) {
			(bool success, ) = _sendTo.call{ value: _amount }("");
			require(success, "YOUStaking: Failed to send accumulated AssetGain");
		} else {
			IERC20Upgradeable(_asset).safeTransfer(_sendTo, _amount);
		}
	}

	// --- 'require' functions ---

	modifier callerIsTroveManager() {
		require(msg.sender == troveManagerAddress, "YOUStaking: caller is not TroveM");
		_;
	}

	modifier callerIsBorrowerOperations() {
		require(msg.sender == borrowerOperationsAddress, "YOUStaking: caller is not BorrowerOps");
		_;
	}

	modifier callerIsActivePool() {
		require(msg.sender == activePoolAddress, "YOUStaking: caller is not ActivePool");
		_;
	}

	function _requireUserHasStake(uint256 currentStake) internal pure {
		require(currentStake > 0, "YOUStaking: User must have a non-zero stake");
	}

	receive() external payable callerIsActivePool {}
}

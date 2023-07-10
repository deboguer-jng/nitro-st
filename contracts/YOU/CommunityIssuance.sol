// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "../Interfaces/IStabilityPoolManager.sol";
import "../Interfaces/ICommunityIssuance.sol";
import "../Dependencies/BaseMath.sol";
import "../Dependencies/VestaMath.sol";
import "../Dependencies/CheckContract.sol";

contract CommunityIssuance is ICommunityIssuance, OwnableUpgradeable, CheckContract, BaseMath {
	using SafeMathUpgradeable for uint256;
	using SafeERC20Upgradeable for IERC20Upgradeable;

	string public constant NAME = "CommunityIssuance";
	uint256 public constant DISTRIBUTION_DURATION = 7 days / 60;
	uint256 public constant SECONDS_IN_ONE_MINUTE = 60;

	IERC20Upgradeable public youToken;
	IStabilityPoolManager public stabilityPoolManager;

	mapping(address => uint256) public totalYOUIssued;
	mapping(address => uint256) public lastUpdateTime;
	mapping(address => uint256) public YOUSupplyCaps;
	mapping(address => uint256) public youDistributionsByPool;

	address public adminContract;

	bool public isInitialized;

	modifier activeStabilityPoolOnly(address _pool) {
		require(lastUpdateTime[_pool] != 0, "CommunityIssuance: Pool needs to be added first.");
		_;
	}

	modifier isController() {
		require(msg.sender == owner() || msg.sender == adminContract, "Invalid Permission");
		_;
	}

	modifier isStabilityPool(address _pool) {
		require(
			stabilityPoolManager.isStabilityPool(_pool),
			"CommunityIssuance: caller is not SP"
		);
		_;
	}

	modifier onlyStabilityPool() {
		require(
			stabilityPoolManager.isStabilityPool(msg.sender),
			"CommunityIssuance: caller is not SP"
		);
		_;
	}

	// --- Functions ---
	function setAddresses(
		address _youTokenAddress,
		address _stabilityPoolManagerAddress,
		address _adminContract
	) external override initializer {
		require(!isInitialized, "Already initialized");
		checkContract(_youTokenAddress);
		checkContract(_stabilityPoolManagerAddress);
		checkContract(_adminContract);
		isInitialized = true;
		__Ownable_init();

		adminContract = _adminContract;

		youToken = IERC20Upgradeable(_youTokenAddress);
		stabilityPoolManager = IStabilityPoolManager(_stabilityPoolManagerAddress);

		emit YOUTokenAddressSet(_youTokenAddress);
		emit StabilityPoolAddressSet(_stabilityPoolManagerAddress);
	}

	function setAdminContract(address _admin) external onlyOwner {
		require(_admin != address(0));
		adminContract = _admin;
	}

	function addFundToStabilityPool(
		address _pool,
		uint256 _assignedSupply
	) external override isController {
		_addFundToStabilityPoolFrom(_pool, _assignedSupply, msg.sender);
	}

	function removeFundFromStabilityPool(
		address _pool,
		uint256 _fundToRemove
	) external onlyOwner activeStabilityPoolOnly(_pool) {
		uint256 newCap = YOUSupplyCaps[_pool].sub(_fundToRemove);
		require(
			totalYOUIssued[_pool] <= newCap,
			"CommunityIssuance: Stability Pool doesn't have enough supply."
		);

		YOUSupplyCaps[_pool] -= _fundToRemove;

		if (totalYOUIssued[_pool] == YOUSupplyCaps[_pool]) {
			disableStabilityPool(_pool);
		}

		youToken.safeTransfer(msg.sender, _fundToRemove);
	}

	function addFundToStabilityPoolFrom(
		address _pool,
		uint256 _assignedSupply,
		address _spender
	) external override isController {
		_addFundToStabilityPoolFrom(_pool, _assignedSupply, _spender);
	}

	function _addFundToStabilityPoolFrom(
		address _pool,
		uint256 _assignedSupply,
		address _spender
	) internal {
		require(
			stabilityPoolManager.isStabilityPool(_pool),
			"CommunityIssuance: Invalid Stability Pool"
		);

		if (lastUpdateTime[_pool] == 0) {
			lastUpdateTime[_pool] = block.timestamp;
		}

		YOUSupplyCaps[_pool] += _assignedSupply;
		youToken.safeTransferFrom(_spender, address(this), _assignedSupply);
	}

	function transferFundToAnotherStabilityPool(
		address _target,
		address _receiver,
		uint256 _quantity
	)
		external
		override
		onlyOwner
		activeStabilityPoolOnly(_target)
		activeStabilityPoolOnly(_receiver)
	{
		uint256 newCap = YOUSupplyCaps[_target].sub(_quantity);
		require(
			totalYOUIssued[_target] <= newCap,
			"CommunityIssuance: Stability Pool doesn't have enough supply."
		);

		YOUSupplyCaps[_target] -= _quantity;
		YOUSupplyCaps[_receiver] += _quantity;

		if (totalYOUIssued[_target] == YOUSupplyCaps[_target]) {
			disableStabilityPool(_target);
		}
	}

	function disableStabilityPool(address _pool) internal {
		lastUpdateTime[_pool] = 0;
		YOUSupplyCaps[_pool] = 0;
		totalYOUIssued[_pool] = 0;
	}

	function issueYOU() external override onlyStabilityPool returns (uint256) {
		return _issueYOU(msg.sender);
	}

	function _issueYOU(address _pool) internal isStabilityPool(_pool) returns (uint256) {
		uint256 maxPoolSupply = YOUSupplyCaps[_pool];

		if (totalYOUIssued[_pool] >= maxPoolSupply) return 0;

		uint256 issuance = _getLastUpdateTokenDistribution(_pool);
		uint256 totalIssuance = issuance.add(totalYOUIssued[_pool]);

		if (totalIssuance > maxPoolSupply) {
			issuance = maxPoolSupply.sub(totalYOUIssued[_pool]);
			totalIssuance = maxPoolSupply;
		}

		lastUpdateTime[_pool] = block.timestamp;
		totalYOUIssued[_pool] = totalIssuance;
		emit TotalYOUIssuedUpdated(_pool, totalIssuance);

		return issuance;
	}

	function _getLastUpdateTokenDistribution(
		address stabilityPool
	) internal view returns (uint256) {
		require(lastUpdateTime[stabilityPool] != 0, "Stability pool hasn't been assigned");
		uint256 timePassed = block.timestamp.sub(lastUpdateTime[stabilityPool]).div(
			SECONDS_IN_ONE_MINUTE
		);
		uint256 totalDistribuedSinceBeginning = youDistributionsByPool[stabilityPool].mul(
			timePassed
		);

		return totalDistribuedSinceBeginning;
	}

	function sendYOU(address _account, uint256 _YOUamount) external override onlyStabilityPool {
		uint256 balanceYOU = youToken.balanceOf(address(this));
		uint256 safeAmount = balanceYOU >= _YOUamount ? _YOUamount : balanceYOU;

		if (safeAmount == 0) {
			return;
		}

		youToken.transfer(_account, safeAmount);
	}

	function setWeeklyYouDistribution(
		address _stabilityPool,
		uint256 _weeklyReward
	) external isController isStabilityPool(_stabilityPool) {
		youDistributionsByPool[_stabilityPool] = _weeklyReward.div(DISTRIBUTION_DURATION);
	}
}

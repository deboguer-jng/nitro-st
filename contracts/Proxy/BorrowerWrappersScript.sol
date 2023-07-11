// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "../Dependencies/VestaMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../Interfaces/IBorrowerOperations.sol";
import "../Interfaces/ITroveManager.sol";
import "../Interfaces/IStabilityPoolManager.sol";
import "../Interfaces/IPriceFeed.sol";
import "../Interfaces/IYOUStaking.sol";
import "./BorrowerOperationsScript.sol";
import "./ETHTransferScript.sol";
import "./YOUStakingScript.sol";

contract BorrowerWrappersScript is
	BorrowerOperationsScript,
	ETHTransferScript,
	YOUStakingScript
{
	using SafeMathUpgradeable for uint256;

	struct Local_var {
		address _asset;
		uint256 _maxFee;
		address _upperHint;
		address _lowerHint;
		uint256 netYOUmount;
	}

	string public constant NAME = "BorrowerWrappersScript";

	ITroveManager immutable troveManager;
	IStabilityPoolManager immutable stabilityPoolManager;
	IPriceFeed immutable priceFeed;
	IERC20 immutable uToken;
	IERC20 immutable youToken;

	constructor(
		address _borrowerOperationsAddress,
		address _troveManagerAddress,
		address _YOUStakingAddress
	)
		BorrowerOperationsScript(IBorrowerOperations(_borrowerOperationsAddress))
		YOUStakingScript(_YOUStakingAddress)
	{
		checkContract(_troveManagerAddress);
		ITroveManager troveManagerCached = ITroveManager(_troveManagerAddress);
		troveManager = troveManagerCached;

		IStabilityPoolManager stabilityPoolCached = troveManagerCached.stabilityPoolManager();
		checkContract(address(stabilityPoolCached));
		stabilityPoolManager = stabilityPoolCached;

		IPriceFeed priceFeedCached = troveManagerCached.vestaParams().priceFeed();
		checkContract(address(priceFeedCached));
		priceFeed = priceFeedCached;

		address uTokenCached = address(troveManagerCached.uToken());
		checkContract(uTokenCached);
		uToken = IERC20(uTokenCached);

		address youTokenCached = address(IYOUStaking(_YOUStakingAddress).youToken());
		checkContract(youTokenCached);
		youToken = IERC20(youTokenCached);

		IYOUStaking youStakingCached = troveManagerCached.youStaking();
		require(
			_YOUStakingAddress == address(youStakingCached),
			"BorrowerWrappersScript: Wrong YOUStaking address"
		);
	}

	function claimCollateralAndOpenTrove(
		address _asset,
		uint256 _maxFee,
		uint256 _YOUmount,
		address _upperHint,
		address _lowerHint
	) external payable {
		uint256 balanceBefore = address(this).balance;

		// Claim collateral
		borrowerOperations.claimCollateral(_asset);

		uint256 balanceAfter = address(this).balance;

		// already checked in CollSurplusPool
		assert(balanceAfter > balanceBefore);

		uint256 totalCollateral = balanceAfter.sub(balanceBefore).add(msg.value);

		// Open trove with obtained collateral, plus collateral sent by user
		borrowerOperations.openTrove{ value: _asset == address(0) ? totalCollateral : 0 }(
			_asset,
			totalCollateral,
			_maxFee,
			_YOUmount,
			_upperHint,
			_lowerHint
		);
	}

	function claimSPRewardsAndRecycle(
		address _asset,
		uint256 _maxFee,
		address _upperHint,
		address _lowerHint
	) external {
		Local_var memory vars = Local_var(_asset, _maxFee, _upperHint, _lowerHint, 0);
		uint256 collBalanceBefore = address(this).balance;
		uint256 YOUBalanceBefore = youToken.balanceOf(address(this));

		// Claim rewards
		stabilityPoolManager.getAssetStabilityPool(vars._asset).withdrawFromSP(0);

		uint256 collBalanceAfter = address(this).balance;
		uint256 YOUBalanceAfter = youToken.balanceOf(address(this));
		uint256 claimedCollateral = collBalanceAfter.sub(collBalanceBefore);

		// Add claimed ETH to trove, get more U and stake it into the Stability Pool
		if (claimedCollateral > 0) {
			_requireUserHasTrove(vars._asset, address(this));
			vars.netYOUmount = _getNetYOUmount(vars._asset, claimedCollateral);
			borrowerOperations.adjustTrove{
				value: vars._asset == address(0) ? claimedCollateral : 0
			}(
				vars._asset,
				claimedCollateral,
				vars._maxFee,
				0,
				vars.netYOUmount,
				true,
				vars._upperHint,
				vars._lowerHint
			);
			// Provide withdrawn U to Stability Pool
			if (vars.netYOUmount > 0) {
				stabilityPoolManager.getAssetStabilityPool(_asset).provideToSP(vars.netYOUmount);
			}
		}

		// Stake claimed YOU
		uint256 claimedYOU = YOUBalanceAfter.sub(YOUBalanceBefore);
		if (claimedYOU > 0) {
			youStaking.stake(claimedYOU);
		}
	}

	function claimStakingGainsAndRecycle(
		address _asset,
		uint256 _maxFee,
		address _upperHint,
		address _lowerHint
	) external {
		Local_var memory vars = Local_var(_asset, _maxFee, _upperHint, _lowerHint, 0);

		uint256 collBalanceBefore = address(this).balance;
		uint256 UBalanceBefore = uToken.balanceOf(address(this));
		uint256 YOUBalanceBefore = youToken.balanceOf(address(this));

		// Claim gains
		youStaking.unstake(0);

		uint256 gainedCollateral = address(this).balance.sub(collBalanceBefore); // stack too deep issues :'(
		uint256 gainedU = uToken.balanceOf(address(this)).sub(UBalanceBefore);

		// Top up trove and get more U, keeping ICR constant
		if (gainedCollateral > 0) {
			_requireUserHasTrove(vars._asset, address(this));
			vars.netYOUmount = _getNetYOUmount(vars._asset, gainedCollateral);
			borrowerOperations.adjustTrove{
				value: vars._asset == address(0) ? gainedCollateral : 0
			}(
				vars._asset,
				gainedCollateral,
				vars._maxFee,
				0,
				vars.netYOUmount,
				true,
				vars._upperHint,
				vars._lowerHint
			);
		}

		uint256 totalU = gainedU.add(vars.netYOUmount);
		if (totalU > 0) {
			stabilityPoolManager.getAssetStabilityPool(_asset).provideToSP(totalU);

			// Providing to Stability Pool also triggers YOU claim, so stake it if any
			uint256 YOUBalanceAfter = youToken.balanceOf(address(this));
			uint256 claimedYOU = YOUBalanceAfter.sub(YOUBalanceBefore);
			if (claimedYOU > 0) {
				youStaking.stake(claimedYOU);
			}
		}
	}

	function _getNetYOUmount(address _asset, uint256 _collateral) internal returns (uint256) {
		uint256 price = priceFeed.fetchPrice(_asset);
		uint256 ICR = troveManager.getCurrentICR(_asset, address(this), price);

		uint256 YOUmount = _collateral.mul(price).div(ICR);
		uint256 borrowingRate = troveManager.getBorrowingRateWithDecay(_asset);
		uint256 netDebt = YOUmount.mul(VestaMath.DECIMAL_PRECISION).div(
			VestaMath.DECIMAL_PRECISION.add(borrowingRate)
		);

		return netDebt;
	}

	function _requireUserHasTrove(address _asset, address _depositor) internal view {
		require(
			troveManager.getTroveStatus(_asset, _depositor) == 1,
			"BorrowerWrappersScript: caller must have an active trove"
		);
	}
}

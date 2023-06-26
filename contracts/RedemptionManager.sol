// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "./Interfaces/IRedemptionManager.sol";
import "./TroveManager.sol";
import "./Dependencies/VestaBase.sol";
import "./Dependencies/CheckContract.sol";

contract RedemptionManager is VestaBase, CheckContract, IRedemptionManager {
	using SafeMathUpgradeable for uint256;

	TroveManager public troveManager;

	bool public isRedemptionWhitelisted;

	mapping(address => bool) public redemptionWhitelist;

	/*
	 * BETA: 18 digit decimal. Parameter by which to divide the redeemed fraction, in order to calc the new base rate from a redemption.
	 * Corresponds to (1 / ALPHA) in the white paper.
	 */
	uint256 public constant BETA = 2;

	constructor(TroveManager _troveManager) {
		troveManager = _troveManager;
	}

	// --- Redemption functions ---
	// Redeem as much collateral as possible from _borrower's Trove in exchange for VST up to _maxVSTamount
	function _redeemCollateralFromTrove(
		address _asset,
		ContractsCache memory _contractsCache,
		address _borrower,
		uint256 _maxVSTamount,
		uint256 _price,
		address _upperPartialRedemptionHint,
		address _lowerPartialRedemptionHint,
		uint256 _partialRedemptionHintNICR
	) internal returns (SingleRedemptionValues memory singleRedemption) {
		LocalVariables_AssetBorrowerPrice memory vars = LocalVariables_AssetBorrowerPrice(
			_asset,
			_borrower,
			_price
		);
		TroveManager.Trove memory trove = troveManager.getTrove(vars._borrower, vars._asset);
		// Determine the remaining amount (lot) to be redeemed, capped by the entire debt of the Trove minus the liquidation reserve
		singleRedemption.VSTLot = VestaMath._min(
			_maxVSTamount,
			trove.debt.sub(vestaParams.VST_GAS_COMPENSATION(_asset))
		);
		// Get the ETHLot of equivalent value in USD
		singleRedemption.ETHLot = singleRedemption.VSTLot.mul(DECIMAL_PRECISION).div(_price);
		// Decrease the debt and collateral of the current Trove according to the VST lot and corresponding ETH to send
		uint256 newDebt = trove.debt.sub(singleRedemption.VSTLot);
		uint256 newColl = trove.coll.sub(singleRedemption.ETHLot);
		if (newDebt == vestaParams.VST_GAS_COMPENSATION(_asset)) {
			// No debt left in the Trove (except for the liquidation reserve), therefore the trove gets closed
			troveManager.removeStake(vars._asset, vars._borrower);
			troveManager.closeTroveByRedemption(vars._asset, vars._borrower);
			_redeemCloseTrove(
				vars._asset,
				_contractsCache,
				vars._borrower,
				vestaParams.VST_GAS_COMPENSATION(vars._asset),
				newColl
			);
			emit TroveUpdated(
				vars._asset,
				vars._borrower,
				0,
				0,
				0,
				TroveManagerOperation.redeemCollateral
			);
		} else {
			uint256 newNICR = VestaMath._computeNominalCR(newColl, newDebt);
			/*
			 * If the provided hint is out of date, we bail since trying to reinsert without a good hint will almost
			 * certainly result in running out of gas.
			 *
			 * If the resultant net debt of the partial is less than the minimum, net debt we bail.
			 */
			if (
				newNICR != _partialRedemptionHintNICR ||
				_getNetDebt(vars._asset, newDebt) < vestaParams.MIN_NET_DEBT(vars._asset)
			) {
				singleRedemption.cancelledPartial = true;
				return singleRedemption;
			}
			_contractsCache.sortedTroves.reInsert(
				vars._asset,
				vars._borrower,
				newNICR,
				_upperPartialRedemptionHint,
				_lowerPartialRedemptionHint
			);
			trove.debt = newDebt;
			trove.coll = newColl;
			troveManager.setTrove(vars._borrower, vars._asset, trove);
			troveManager.updateStakeAndTotalStakes(vars._asset, vars._borrower);

			trove = troveManager.getTrove(vars._borrower, vars._asset);

			emit TroveUpdated(
				vars._asset,
				vars._borrower,
				newDebt,
				newColl,
				trove.stake,
				TroveManagerOperation.redeemCollateral
			);
		}
		return singleRedemption;
	}

	/*
	 * Called when a full redemption occurs, and closes the trove.
	 * The redeemer swaps (debt - liquidation reserve) VST for (debt - liquidation reserve) worth of ETH, so the VST liquidation reserve left corresponds to the remaining debt.
	 * In order to close the trove, the VST liquidation reserve is burned, and the corresponding debt is removed from the active pool.
	 * The debt recorded on the trove's struct is zero'd elswhere, in _closeTrove.
	 * Any surplus ETH left in the trove, is sent to the Coll surplus pool, and can be later claimed by the borrower.
	 */
	function _redeemCloseTrove(
		address _asset,
		ContractsCache memory _contractsCache,
		address _borrower,
		uint256 _VST,
		uint256 _ETH
	) internal {
		_contractsCache.vstToken.burn(troveManager.gasPoolAddress(), _VST);
		// Update Active Pool VST, and send ETH to account
		_contractsCache.activePool.decreaseVSTDebt(_asset, _VST);
		// send ETH from Active Pool to CollSurplus Pool
		_contractsCache.collSurplusPool.accountSurplus(_asset, _borrower, _ETH);
		_contractsCache.activePool.sendAsset(
			_asset,
			address(_contractsCache.collSurplusPool),
			_ETH
		);
	}

	function _isValidFirstRedemptionHint(
		address _asset,
		ISortedTroves _sortedTroves,
		address _firstRedemptionHint,
		uint256 _price
	) internal view returns (bool) {
		if (
			_firstRedemptionHint == address(0) ||
			!_sortedTroves.contains(_asset, _firstRedemptionHint) ||
			troveManager.getCurrentICR(_asset, _firstRedemptionHint, _price) <
			vestaParams.MCR(_asset)
		) {
			return false;
		}
		address nextTrove = _sortedTroves.getNext(_asset, _firstRedemptionHint);
		return
			nextTrove == address(0) ||
			troveManager.getCurrentICR(_asset, nextTrove, _price) < vestaParams.MCR(_asset);
	}

	function _requireTCRoverMCR(address _asset, uint256 _price) internal view {
		require(_getTCR(_asset, _price) >= vestaParams.MCR(_asset), "TroveManager: !TCR < MCR");
	}

	function _requireValidMaxFeePercentage(
		address _asset,
		uint256 _maxFeePercentage
	) internal view {
		require(
			_maxFeePercentage >= vestaParams.REDEMPTION_FEE_FLOOR(_asset) &&
				_maxFeePercentage <= DECIMAL_PRECISION,
			"Max fee percent must be between 0.5% and 100%"
		);
	}

	function _requireAmountGreaterThanZero(uint256 _amount) internal pure {
		require(_amount > 0, "TroveManager: !_amount");
	}

	function _requireVSTBalanceCoversRedemption(
		IVSTToken _vstToken,
		address _redeemer,
		uint256 _amount
	) internal view {
		require(
			_vstToken.balanceOf(_redeemer) >= _amount,
			"TroveManager: Too much redemption amount"
		);
	}

	function setRedemptionWhitelistStatus(bool _status) external onlyOwner {
		isRedemptionWhitelisted = _status;
	}

	function addUserToWhitelistRedemption(address _user) external onlyOwner {
		redemptionWhitelist[_user] = true;
	}

	function removeUserFromWhitelistRedemption(address _user) external onlyOwner {
		delete redemptionWhitelist[_user];
	}

	struct RedeemCollateralVars {
		address currentBorrower;
		address nextUserToCheck;
	}

	function _calcRedemptionRate(
		address _asset,
		uint256 _baseRate
	) internal view returns (uint256) {
		return
			VestaMath._min(
				vestaParams.REDEMPTION_FEE_FLOOR(_asset).add(_baseRate),
				DECIMAL_PRECISION
			);
	}

	function getRedemptionRateWithDecay(address _asset) public view override returns (uint256) {
		_isWstETH(_asset);
		return _calcRedemptionRate(_asset, troveManager.calcDecayedBaseRate(_asset));
	}

	function getRedemptionRate(address _asset) public view override returns (uint256) {
		_isWstETH(_asset);
		return _calcRedemptionRate(_asset, troveManager.baseRate(_asset));
	}

	function _calcRedemptionFee(
		uint256 _redemptionRate,
		uint256 _assetDraw
	) internal pure returns (uint256) {
		uint256 redemptionFee = _redemptionRate.mul(_assetDraw).div(DECIMAL_PRECISION);
		require(redemptionFee < _assetDraw, "TroveManager: Too much fee");
		return redemptionFee;
	}

	function getRedemptionFeeWithDecay(
		address _asset,
		uint256 _assetDraw
	) external view override returns (uint256) {
		_isWstETH(_asset);
		return _calcRedemptionFee(getRedemptionRateWithDecay(_asset), _assetDraw);
	}

	function _getRedemptionFee(
		address _asset,
		uint256 _assetDraw
	) internal view returns (uint256) {
		return _calcRedemptionFee(getRedemptionRate(_asset), _assetDraw);
	}

	function _updateBaseRateFromRedemption(
		address _asset,
		uint256 _ETHDrawn,
		uint256 _price,
		uint256 _totalVSTSupply
	) internal returns (uint256) {
		uint256 decayedBaseRate = troveManager.calcDecayedBaseRate(_asset);

		uint256 redeemedVSTFraction = _ETHDrawn.mul(_price).div(_totalVSTSupply);

		uint256 newBaseRate = decayedBaseRate.add(redeemedVSTFraction.div(BETA));
		newBaseRate = VestaMath._min(newBaseRate, DECIMAL_PRECISION);
		assert(newBaseRate > 0);

		troveManager.updateBaseRateAndLastFeeOpTime(_asset, newBaseRate);

		return newBaseRate;
	}

	/* Send _VSTamount VST to the system and redeem the corresponding amount of collateral from as many Troves as are needed to fill the redemption
	 * request.  Applies pending rewards to a Trove before reducing its debt and coll.
	 *
	 * Note that if _amount is very large, this function can run out of gas, specially if traversed troves are small. This can be easily avoided by
	 * splitting the total _amount in appropriate chunks and calling the function multiple times.
	 *
	 * Param `_maxIterations` can also be provided, so the loop through Troves is capped (if it’s zero, it will be ignored).This makes it easier to
	 * avoid OOG for the frontend, as only knowing approximately the average cost of an iteration is enough, without needing to know the “topology”
	 * of the trove list. It also avoids the need to set the cap in stone in the contract, nor doing gas calculations, as both gas price and opcode
	 * costs can vary.
	 *
	 * All Troves that are redeemed from -- with the likely exception of the last one -- will end up with no debt left, therefore they will be closed.
	 * If the last Trove does have some remaining debt, it has a finite ICR, and the reinsertion could be anywhere in the list, therefore it requires a hint.
	 * A frontend should use getRedemptionHints() to calculate what the ICR of this Trove will be after redemption, and pass a hint for its position
	 * in the sortedTroves list along with the ICR value that the hint was found for.
	 *
	 * If another transaction modifies the list between calling getRedemptionHints() and passing the hints to redeemCollateral(), it
	 * is very likely that the last (partially) redeemed Trove would end up with a different ICR than what the hint is for. In this case the
	 * redemption will stop after the last completely redeemed Trove and the sender will keep the remaining VST amount, which they can attempt
	 * to redeem later.
	 */
	function redeemCollateral(
		address _asset,
		uint256 _VSTamount,
		address _firstRedemptionHint,
		address _upperPartialRedemptionHint,
		address _lowerPartialRedemptionHint,
		uint256 _partialRedemptionHintNICR,
		uint256 _maxIterations,
		uint256 _maxFeePercentage
	) external override {
		_isWstETH(_asset);
		if (isRedemptionWhitelisted) {
			require(redemptionWhitelist[msg.sender], "Not whitelisted for Redemption");
		}
		require(
			block.timestamp >= vestaParams.redemptionBlock(_asset),
			"TroveManager: Redemption is blocked"
		);
		RedeemCollateralVars memory vars;
		ContractsCache memory contractsCache = ContractsCache(
			vestaParams.activePool(),
			vestaParams.defaultPool(),
			troveManager.vstToken(),
			troveManager.vstaStaking(),
			troveManager.sortedTroves(),
			troveManager.collSurplusPool(),
			troveManager.gasPoolAddress()
		);
		RedemptionTotals memory totals;
		_requireValidMaxFeePercentage(_asset, _maxFeePercentage);
		totals.price = vestaParams.priceFeed().fetchPrice(_asset);
		_requireTCRoverMCR(_asset, totals.price);
		_requireAmountGreaterThanZero(_VSTamount);
		_requireVSTBalanceCoversRedemption(contractsCache.vstToken, msg.sender, _VSTamount);
		totals.totalVSTSupplyAtStart = getEntireSystemDebt(_asset);
		totals.remainingVST = _VSTamount;
		if (
			_isValidFirstRedemptionHint(
				_asset,
				contractsCache.sortedTroves,
				_firstRedemptionHint,
				totals.price
			)
		) {
			vars.currentBorrower = _firstRedemptionHint;
		} else {
			vars.currentBorrower = contractsCache.sortedTroves.getLast(_asset);
			// Find the first trove with ICR >= MCR
			while (
				vars.currentBorrower != address(0) &&
				troveManager.getCurrentICR(_asset, vars.currentBorrower, totals.price) <
				vestaParams.MCR(_asset)
			) {
				vars.currentBorrower = contractsCache.sortedTroves.getPrev(
					_asset,
					vars.currentBorrower
				);
			}
		}
		// Loop through the Troves starting from the one with lowest collateral ratio until _amount of VST is exchanged for collateral
		if (_maxIterations == 0) {
			_maxIterations = type(uint256).max;
		}
		while (
			vars.currentBorrower != address(0) && totals.remainingVST > 0 && _maxIterations > 0
		) {
			_maxIterations--;
			// Save the address of the Trove preceding the current one, before potentially modifying the list
			vars.nextUserToCheck = contractsCache.sortedTroves.getPrev(_asset, vars.currentBorrower);
			troveManager.applyPendingRewardsForRedemption(
				_asset,
				contractsCache.activePool,
				contractsCache.defaultPool,
				vars.currentBorrower
			);
			SingleRedemptionValues memory singleRedemption = _redeemCollateralFromTrove(
				_asset,
				contractsCache,
				vars.currentBorrower,
				totals.remainingVST,
				totals.price,
				_upperPartialRedemptionHint,
				_lowerPartialRedemptionHint,
				_partialRedemptionHintNICR
			);
			if (singleRedemption.cancelledPartial) break; // Partial redemption was cancelled (out-of-date hint, or new net debt < minimum), therefore we could not redeem from the last Trove
			totals.totalVSTToRedeem = totals.totalVSTToRedeem.add(singleRedemption.VSTLot);
			totals.totalAssetDrawn = totals.totalAssetDrawn.add(singleRedemption.ETHLot);
			totals.remainingVST = totals.remainingVST.sub(singleRedemption.VSTLot);
			vars.currentBorrower = vars.nextUserToCheck;
		}
		require(totals.totalAssetDrawn > 0, "TroveManager: Unable to redeem");
		// Decay the baseRate due to time passed, and then increase it according to the size of this redemption.
		// Use the saved total VST supply value, from before it was reduced by the redemption.
		_updateBaseRateFromRedemption(
			_asset,
			totals.totalAssetDrawn,
			totals.price,
			totals.totalVSTSupplyAtStart
		);
		// Calculate the ETH fee
		totals.ETHFee = _getRedemptionFee(_asset, totals.totalAssetDrawn);
		_requireUserAcceptsFee(totals.ETHFee, totals.totalAssetDrawn, _maxFeePercentage);
		// Send the ETH fee to the VSTA staking contract
		contractsCache.activePool.sendAsset(
			_asset,
			address(contractsCache.vstaStaking),
			totals.ETHFee
		);
		contractsCache.vstaStaking.increaseF_Asset(_asset, totals.ETHFee);
		totals.ETHToSendToRedeemer = totals.totalAssetDrawn.sub(totals.ETHFee);
		emit Redemption(
			_asset,
			_VSTamount,
			totals.totalVSTToRedeem,
			totals.totalAssetDrawn,
			totals.ETHFee
		);
		// Burn the total VST that is cancelled with debt, and send the redeemed ETH to msg.sender
		contractsCache.vstToken.burn(msg.sender, totals.totalVSTToRedeem);
		// Update Active Pool VST, and send ETH to account
		contractsCache.activePool.decreaseVSTDebt(_asset, totals.totalVSTToRedeem);
		contractsCache.activePool.sendAsset(_asset, msg.sender, totals.ETHToSendToRedeemer);
	}
}

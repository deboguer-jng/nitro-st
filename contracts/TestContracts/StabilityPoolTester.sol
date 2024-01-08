// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;
import "../StabilityPool.sol";

abstract contract StabilityPoolTester is StabilityPool {
	using SafeMathUpgradeable for uint256;

	function unprotectedPayable() external payable {
		assetBalance = assetBalance + msg.value;
	}

	function setCurrentScale(uint128 _currentScale) external {
		currentScale = _currentScale;
	}

	function setTotalDeposits(uint256 _totalUDeposits) external {
		totalUDeposits = _totalUDeposits;
	}
}

// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;
import "../ActivePool.sol";

contract ActivePoolTester is ActivePool {

	function unprotectedIncreaseUDebt(address _asset, uint256 _amount) external {
		UDebts[_asset] = UDebts[_asset] + _amount;
	}

	function unprotectedPayable(address _asset, uint256 amount) external payable {
		amount = _asset == address(0) ? msg.value : amount;
		assetsBalance[_asset] = assetsBalance[_asset] + msg.value;
	}
}

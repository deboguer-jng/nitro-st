// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "../Dependencies/CheckContract.sol";
import "../Interfaces/IYOUStaking.sol";

contract YOUStakingScript is CheckContract {
	IYOUStaking immutable youStaking;

	constructor(address _YOUStakingAddress) {
		checkContract(_YOUStakingAddress);
		youStaking = IYOUStaking(_YOUStakingAddress);
	}

	function stake(uint256 _YOUamount) external {
		youStaking.stake(_YOUamount);
	}
}

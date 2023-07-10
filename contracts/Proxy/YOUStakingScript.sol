// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "../Dependencies/CheckContract.sol";
import "../Interfaces/IYOUStaking.sol";

contract YOUStakingScript is CheckContract {
	IYOUStaking immutable vstaStaking;

	constructor(address _YOUStakingAddress) {
		checkContract(_YOUStakingAddress);
		vstaStaking = IYOUStaking(_YOUStakingAddress);
	}

	function stake(uint256 _YOUamount) external {
		vstaStaking.stake(_YOUamount);
	}
}

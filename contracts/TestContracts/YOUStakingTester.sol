// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "../YOU/YOUStaking.sol";

contract YOUStakingTester is YOUStaking {
	function requireCallerIsTroveManager() external view callerIsTroveManager {}
}

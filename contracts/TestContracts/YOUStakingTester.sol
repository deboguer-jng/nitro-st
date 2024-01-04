// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;
import "../YOU/YOUStaking.sol";

contract YOUStakingTester is YOUStaking {
	function requireCallerIsTroveManager() external view callerIsTroveManager {}
}

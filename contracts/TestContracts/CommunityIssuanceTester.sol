// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;
import "../YOU/CommunityIssuance.sol";

contract CommunityIssuanceTester is CommunityIssuance {

	function obtainYOU(uint256 _amount) external {
		youToken.transfer(msg.sender, _amount);
	}

	function getLastUpdateTokenDistribution(
		address stabilityPool
	) external view returns (uint256) {
		return _getLastUpdateTokenDistribution(stabilityPool);
	}

	function unprotectedIssueYOU(address stabilityPool) external returns (uint256) {
		return _issueYOU(stabilityPool);
	}
}

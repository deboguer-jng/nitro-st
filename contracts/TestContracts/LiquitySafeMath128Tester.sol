// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;
import "../Dependencies/YouSafeMath128.sol";

/* Tester contract for math functions in YouSafeMath128.sol library. */

contract YouSafeMath128Tester {
	using YouSafeMath128 for uint128;

	function add(uint128 a, uint128 b) external pure returns (uint128) {
		return a.add(b);
	}

	function sub(uint128 a, uint128 b) external pure returns (uint128) {
		return a.sub(b);
	}
}

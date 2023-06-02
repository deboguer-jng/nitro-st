// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

contract ArbitroveBase {
	address public contractOwner;
	// address public wstETH = 0x5979D7b546E38E414F7E9822514be443A4800529;
	address public wstETH = 0x69C735ce75B3Dec7c1Cdf21306628A6eb1b81346;

  constructor() {
    contractOwner = msg.sender;
  }
	
	modifier onlyContractOwner() {
		require(msg.sender == contractOwner, "invalid permission");
		_;
	}

	modifier onlyWstETH(address _asset) {
		require(wstETH == _asset || _asset == address(0), "only wstETH collateral is enabled");
		_;
	}

	function setWstETH(address _wstETH) external onlyContractOwner {
		require(_wstETH != address(0), "invalid wstETH address");
		wstETH = _wstETH;
	}
}
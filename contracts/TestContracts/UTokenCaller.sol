// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "../Interfaces/IUToken.sol";

contract UTokenCaller {
	IUToken U;

	function setU(IUToken _U) external {
		U = _U;
	}

	function UMint(address _asset, address _account, uint256 _amount) external {
		U.mint(_asset, _account, _amount);
	}

	function UBurn(address _account, uint256 _amount) external {
		U.burn(_account, _amount);
	}

	function USendToPool(address _sender, address _poolAddress, uint256 _amount) external {
		U.sendToPool(_sender, _poolAddress, _amount);
	}

	function UReturnFromPool(address _poolAddress, address _receiver, uint256 _amount) external {
		U.returnFromPool(_poolAddress, _receiver, _amount);
	}
}

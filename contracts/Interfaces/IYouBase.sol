// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "./IYOUParameters.sol";

interface IYouBase {
	event VaultParametersBaseChanged(address indexed newAddress);

	function youParams() external view returns (IYOUParameters);
}

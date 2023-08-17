pragma solidity ^0.8.10;

import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";

import "./Dependencies/CheckContract.sol";
import "./Dependencies/ArbitroveBase.sol";

import "./Interfaces/IStabilityPoolManager.sol";
import "./Interfaces/IYOUParameters.sol";
import "./Interfaces/IStabilityPool.sol";
import "./Interfaces/ICommunityIssuance.sol";

contract AdminContract is ProxyAdmin, ArbitroveBase {
	string public constant NAME = "AdminContract";

	bytes32 public constant STABILITY_POOL_NAME_BYTES =
		0x4172626974726f76652073746162696c69747920706f6f6c2077737465746820;
	bool public isInitialized;

	IYOUParameters private youParameters;
	IStabilityPoolManager private stabilityPoolManager;
	ICommunityIssuance private communityIssuance;

	address borrowerOperationsAddress;
	address troveManagerAddress;
	address uTokenAddress;
	address sortedTrovesAddress;

	function setAddresses(
		address _paramaters,
		address _stabilityPoolManager,
		address _borrowerOperationsAddress,
		address _troveManagerAddress,
		address _uTokenAddress,
		address _sortedTrovesAddress,
		address _communityIssuanceAddress,
		address _wstETHAddress
	) external onlyOwner {
		require(!isInitialized);
		CheckContract(_paramaters);
		CheckContract(_stabilityPoolManager);
		CheckContract(_borrowerOperationsAddress);
		CheckContract(_troveManagerAddress);
		CheckContract(_uTokenAddress);
		CheckContract(_sortedTrovesAddress);
		CheckContract(_communityIssuanceAddress);
		CheckContract(_wstETHAddress);
		isInitialized = true;

		borrowerOperationsAddress = _borrowerOperationsAddress;
		troveManagerAddress = _troveManagerAddress;
		uTokenAddress = _uTokenAddress;
		sortedTrovesAddress = _sortedTrovesAddress;
		communityIssuance = ICommunityIssuance(_communityIssuanceAddress);
		wstETH = _wstETHAddress;

		youParameters = IYOUParameters(_paramaters);
		stabilityPoolManager = IStabilityPoolManager(_stabilityPoolManager);
	}

	//Needs to approve Community Issuance to use this fonction.
	function addNewCollateral(
		address _asset,
		address _stabilityPoolImplementation,
		address _chainlinkOracle,
		bytes32 _tellorId,
		uint256 assignedToken,
		uint256 _tokenPerWeekDistributed,
		uint256 redemptionLockInDay
	) external onlyOwner onlyWstETH(_asset) {
		require(
			stabilityPoolManager.unsafeGetAssetStabilityPool(_asset) == address(0),
			"This collateral already exists"
		);
		require(
			IStabilityPool(_stabilityPoolImplementation).getNameBytes() == STABILITY_POOL_NAME_BYTES,
			"Invalid Stability pool"
		);

		youParameters.priceFeed().addOracle(_asset, _chainlinkOracle, _tellorId);
		youParameters.setAsDefaultWithRemptionBlock(_asset, redemptionLockInDay);

		address clonedStabilityPool = ClonesUpgradeable.clone(_stabilityPoolImplementation);
		require(clonedStabilityPool != address(0), "Failed to clone contract");

		TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
			clonedStabilityPool,
			address(this),
			abi.encodeWithSignature(
				"setAddresses(address,address,address,address,address,address,address,uint256)",
				_asset,
				borrowerOperationsAddress,
				troveManagerAddress,
				uTokenAddress,
				sortedTrovesAddress,
				address(communityIssuance),
				address(youParameters),
				1000
			)
		);

		address proxyAddress = address(proxy);
		stabilityPoolManager.addStabilityPool(_asset, proxyAddress);
		communityIssuance.addFundToStabilityPoolFrom(proxyAddress, assignedToken, msg.sender);
		communityIssuance.setWeeklyYouDistribution(proxyAddress, _tokenPerWeekDistributed);
	}
}

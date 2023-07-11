const SortedTroves = artifacts.require("./SortedTroves.sol")
const TroveManager = artifacts.require("./TroveManager.sol")
const PriceFeedTestnet = artifacts.require("./PriceFeedTestnet.sol")
const UToken = artifacts.require("./UToken.sol")
const ActivePool = artifacts.require("./ActivePool.sol")
const DefaultPool = artifacts.require("./DefaultPool.sol")
const StabilityPool = artifacts.require("./StabilityPool.sol")
const StabilityPoolManager = artifacts.require("./StabilityPoolManager.sol")
const AdminContract = artifacts.require("./AdminContract.sol")
const GasPool = artifacts.require("./GasPool.sol")
const CollSurplusPool = artifacts.require("./CollSurplusPool.sol")
const FunctionCaller = artifacts.require("./TestContracts/FunctionCaller.sol")
const BorrowerOperations = artifacts.require("./BorrowerOperations.sol")
const HintHelpers = artifacts.require("./HintHelpers.sol")
const VestaParameters = artifacts.require("./VestaParameters.sol")
const LockedYOU = artifacts.require("./LockedYOU.sol")

const YOUStaking = artifacts.require("./YOUStaking.sol")
const CommunityIssuance = artifacts.require("./CommunityIssuance.sol")

const YOUTokenTester = artifacts.require("./YOUTokenTester.sol")
const CommunityIssuanceTester = artifacts.require("./CommunityIssuanceTester.sol")
const StabilityPoolTester = artifacts.require("./StabilityPoolTester.sol")
const ActivePoolTester = artifacts.require("./ActivePoolTester.sol")
const DefaultPoolTester = artifacts.require("./DefaultPoolTester.sol")
const VestaMathTester = artifacts.require("./VestaMathTester.sol")
const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const UTokenTester = artifacts.require("./UTokenTester.sol")
const ERC20Test = artifacts.require("./ERC20Test.sol")

// Proxy scripts
const BorrowerOperationsScript = artifacts.require("BorrowerOperationsScript")
const BorrowerWrappersScript = artifacts.require("BorrowerWrappersScript")
const TroveManagerScript = artifacts.require("TroveManagerScript")
const StabilityPoolScript = artifacts.require("StabilityPoolScript")
const TokenScript = artifacts.require("TokenScript")
const YOUStakingScript = artifacts.require("YOUStakingScript")
const { messagePrefix } = require("@ethersproject/hash")
const {
	buildUserProxies,
	BorrowerOperationsProxy,
	BorrowerWrappersProxy,
	TroveManagerProxy,
	StabilityPoolProxy,
	SortedTrovesProxy,
	TokenProxy,
	YOUStakingProxy,
} = require("../utils/proxyHelpers.js")

/* "Liquity core" consists of all contracts in the core Liquity system.

YOU contracts consist of only those contracts related to the YOU Token:

-the YOU token
-the Lockup factory and lockup contracts
-the YOUStaking contract
-the CommunityIssuance contract 
*/

const testHelpers = require("./testHelpers.js")

const th = testHelpers.TestHelper
const dec = th.dec

const ZERO_ADDRESS = "0x" + "0".repeat(40)
const maxBytes32 = "0x" + "f".repeat(64)

let erc20

class DeploymentHelper {
	static async deployLiquityCore() {
		return this.deployLiquityCoreHardhat()
	}

	static async deployLiquityCoreHardhat() {
		const priceFeedTestnet = await PriceFeedTestnet.new()
		const sortedTroves = await SortedTroves.new()
		const troveManager = await TroveManager.new()
		const activePool = await ActivePool.new()
		const stabilityPoolTemplate = await StabilityPool.new()
		const stabilityPoolTemplateV2 = await StabilityPool.new()
		const stabilityPoolManager = await StabilityPoolManager.new()
		const vestaParameters = await VestaParameters.new()
		const gasPool = await GasPool.new()
		const defaultPool = await DefaultPool.new()
		const collSurplusPool = await CollSurplusPool.new()
		const functionCaller = await FunctionCaller.new()
		const borrowerOperations = await BorrowerOperations.new()
		const hintHelpers = await HintHelpers.new()
		const uToken = await UToken.new(
			troveManager.address,
			stabilityPoolManager.address,
			borrowerOperations.address
		)
		erc20 = erc20 ? erc20 : await ERC20Test.new()
		const adminContract = await AdminContract.new()

		UToken.setAsDeployed(uToken)
		DefaultPool.setAsDeployed(defaultPool)
		PriceFeedTestnet.setAsDeployed(priceFeedTestnet)
		SortedTroves.setAsDeployed(sortedTroves)
		TroveManager.setAsDeployed(troveManager)
		ActivePool.setAsDeployed(activePool)
		StabilityPool.setAsDeployed(stabilityPoolTemplate)
		StabilityPool.setAsDeployed(stabilityPoolTemplateV2)
		GasPool.setAsDeployed(gasPool)
		CollSurplusPool.setAsDeployed(collSurplusPool)
		FunctionCaller.setAsDeployed(functionCaller)
		BorrowerOperations.setAsDeployed(borrowerOperations)
		HintHelpers.setAsDeployed(hintHelpers)
		VestaParameters.setAsDeployed(vestaParameters)
		ERC20Test.setAsDeployed(erc20)
		AdminContract.setAsDeployed(adminContract)

		await erc20.setDecimals(8)

		await adminContract.setWstETH(erc20.address)
		await activePool.setWstETH(erc20.address)
		await borrowerOperations.setWstETH(erc20.address)
		await collSurplusPool.setWstETH(erc20.address)
		await defaultPool.setWstETH(erc20.address)
		await hintHelpers.setWstETH(erc20.address)
		await sortedTroves.setWstETH(erc20.address)
		await stabilityPoolTemplate.setWstETH(erc20.address)
		await stabilityPoolTemplateV2.setWstETH(erc20.address)
		await troveManager.setWstETH(erc20.address)
		await vestaParameters.setWstETH(erc20.address)

		const coreContracts = {
			priceFeedTestnet,
			uToken,
			sortedTroves,
			troveManager,
			activePool,
			stabilityPoolTemplate,
			stabilityPoolTemplateV2,
			stabilityPoolManager,
			vestaParameters,
			gasPool,
			defaultPool,
			collSurplusPool,
			functionCaller,
			borrowerOperations,
			hintHelpers,
			erc20,
			adminContract,
		}
		return coreContracts
	}

	static async deployTesterContractsHardhat() {
		const testerContracts = {}

		// Contract without testers (yet)
		testerContracts.erc20 = erc20 ? erc20 : await ERC20Test.new()
		testerContracts.priceFeedTestnet = await PriceFeedTestnet.new()
		testerContracts.sortedTroves = await SortedTroves.new()
		// Actual tester contracts
		testerContracts.communityIssuance = await CommunityIssuanceTester.new()
		testerContracts.activePool = await ActivePoolTester.new()
		testerContracts.defaultPool = await DefaultPoolTester.new()
		testerContracts.stabilityPoolTemplate = await StabilityPoolTester.new()
		testerContracts.stabilityPoolManager = await StabilityPoolManager.new()
		testerContracts.vestaParameters = await VestaParameters.new()
		testerContracts.gasPool = await GasPool.new()
		testerContracts.collSurplusPool = await CollSurplusPool.new()
		testerContracts.math = await VestaMathTester.new()
		testerContracts.borrowerOperations = await BorrowerOperationsTester.new()
		testerContracts.troveManager = await TroveManagerTester.new()
		testerContracts.functionCaller = await FunctionCaller.new()
		testerContracts.hintHelpers = await HintHelpers.new()
		testerContracts.uToken = await UTokenTester.new(
			testerContracts.troveManager.address,
			testerContracts.stabilityPoolManager.address,
			testerContracts.borrowerOperations.address
		)
		testerContracts.adminContract = await AdminContract.new()

		await testerContracts.adminContract.setWstETH(testerContracts.erc20.address)
		await testerContracts.activePool.setWstETH(testerContracts.erc20.address)
		await testerContracts.borrowerOperations.setWstETH(testerContracts.erc20.address)
		await testerContracts.collSurplusPool.setWstETH(testerContracts.erc20.address)
		await testerContracts.defaultPool.setWstETH(testerContracts.erc20.address)
		await testerContracts.hintHelpers.setWstETH(testerContracts.erc20.address)
		await testerContracts.sortedTroves.setWstETH(testerContracts.erc20.address)
		await testerContracts.stabilityPoolTemplate.setWstETH(testerContracts.erc20.address)
		await testerContracts.stabilityPoolManager.setWstETH(testerContracts.erc20.address)
		await testerContracts.troveManager.setWstETH(testerContracts.erc20.address)
		await testerContracts.vestaParameters.setWstETH(testerContracts.erc20.address)

		return testerContracts
	}

	static async deployYOUContractsHardhat(treasury) {
		const youStaking = await YOUStaking.new()
		const communityIssuance = await CommunityIssuanceTester.new()
		const lockedYOU = await LockedYOU.new()

		YOUStaking.setAsDeployed(youStaking)
		CommunityIssuanceTester.setAsDeployed(communityIssuance)
		LockedYOU.setAsDeployed(lockedYOU)

		// Deploy YOU Token, passing Community Issuance and Factory addresses to the constructor
		const youToken = await YOUTokenTester.new(treasury)
		YOUTokenTester.setAsDeployed(youToken)

		const YOUContracts = {
			youStaking,
			communityIssuance,
			youToken,
			lockedYOU,
		}
		return YOUContracts
	}

	static async deployUToken(contracts) {
		contracts.uToken = await UTokenTester.new(
			contracts.troveManager.address,
			contracts.stabilityPoolManager.address,
			contracts.borrowerOperations.address
		)
		return contracts
	}

	static async deployProxyScripts(contracts, YOUContracts, owner, users) {
		const proxies = await buildUserProxies(users)

		const borrowerWrappersScript = await BorrowerWrappersScript.new(
			contracts.borrowerOperations.address,
			contracts.troveManager.address,
			YOUContracts.youStaking.address
		)
		contracts.borrowerWrappers = new BorrowerWrappersProxy(
			owner,
			proxies,
			borrowerWrappersScript.address
		)

		const borrowerOperationsScript = await BorrowerOperationsScript.new(
			contracts.borrowerOperations.address
		)
		contracts.borrowerOperations = new BorrowerOperationsProxy(
			owner,
			proxies,
			borrowerOperationsScript.address,
			contracts.borrowerOperations
		)

		const troveManagerScript = await TroveManagerScript.new(contracts.troveManager.address)
		contracts.troveManager = new TroveManagerProxy(
			owner,
			proxies,
			troveManagerScript.address,
			contracts.troveManager
		)

		const stabilityPoolScript = await StabilityPoolScript.new(
			contracts.stabilityPoolTemplate.address
		)
		contracts.stabilityPool = new StabilityPoolProxy(
			owner,
			proxies,
			stabilityPoolScript.address,
			contracts.stabilityPool
		)

		contracts.sortedTroves = new SortedTrovesProxy(owner, proxies, contracts.sortedTroves)

		const uTokenScript = await TokenScript.new(contracts.uToken.address)
		contracts.uToken = new TokenProxy(owner, proxies, uTokenScript.address, contracts.uToken)

		const youTokenScript = await TokenScript.new(YOUContracts.youToken.address)
		YOUContracts.youToken = new TokenProxy(
			owner,
			proxies,
			youTokenScript.address,
			YOUContracts.youToken
		)

		const youStakingScript = await YOUStakingScript.new(YOUContracts.youStaking.address)
		YOUContracts.youStaking = new YOUStakingProxy(
			owner,
			proxies,
			youStakingScript.address,
			YOUContracts.youStaking
		)
	}

	// Connect contracts to their dependencies
	static async connectCoreContracts(contracts, YOUContracts) {
		// set TroveManager addr in SortedTroves
		await contracts.sortedTroves.setParams(
			contracts.troveManager.address,
			contracts.borrowerOperations.address
		)

		// set contract addresses in the FunctionCaller
		await contracts.functionCaller.setTroveManagerAddress(contracts.troveManager.address)
		await contracts.functionCaller.setSortedTrovesAddress(contracts.sortedTroves.address)

		await contracts.vestaParameters.setAddresses(
			contracts.activePool.address,
			contracts.defaultPool.address,
			contracts.priceFeedTestnet.address,
			contracts.adminContract.address
		)

		// set contracts in the Trove Manager
		await contracts.troveManager.setAddresses(
			contracts.borrowerOperations.address,
			contracts.stabilityPoolManager.address,
			contracts.gasPool.address,
			contracts.collSurplusPool.address,
			contracts.uToken.address,
			contracts.sortedTroves.address,
			YOUContracts.youStaking.address,
			contracts.vestaParameters.address
		)

		// set contracts in BorrowerOperations
		await contracts.borrowerOperations.setAddresses(
			contracts.troveManager.address,
			contracts.stabilityPoolManager.address,
			contracts.gasPool.address,
			contracts.collSurplusPool.address,
			contracts.sortedTroves.address,
			contracts.uToken.address,
			YOUContracts.youStaking.address,
			contracts.vestaParameters.address
		)

		await contracts.stabilityPoolManager.setAddresses(contracts.adminContract.address)

		await contracts.adminContract.setAddresses(
			contracts.vestaParameters.address,
			contracts.stabilityPoolManager.address,
			contracts.borrowerOperations.address,
			contracts.troveManager.address,
			contracts.uToken.address,
			contracts.sortedTroves.address,
			YOUContracts.communityIssuance.address
		)

		await contracts.activePool.setAddresses(
			contracts.borrowerOperations.address,
			contracts.troveManager.address,
			contracts.stabilityPoolManager.address,
			contracts.defaultPool.address,
			contracts.collSurplusPool.address
		)

		await contracts.defaultPool.setAddresses(
			contracts.troveManager.address,
			contracts.activePool.address
		)

		await contracts.collSurplusPool.setAddresses(
			contracts.borrowerOperations.address,
			contracts.troveManager.address,
			contracts.activePool.address
		)

		// set contracts in HintHelpers
		await contracts.hintHelpers.setAddresses(
			contracts.sortedTroves.address,
			contracts.troveManager.address,
			contracts.vestaParameters.address
		)
	}

	static async connectYOUContractsToCore(
		YOUContracts,
		coreContracts,
		skipPool = false,
		liquitySettings = true
	) {
		const treasurySig = await YOUContracts.youToken.treasury()

		await YOUContracts.youStaking.setAddresses(
			YOUContracts.youToken.address,
			coreContracts.uToken.address,
			coreContracts.troveManager.address,
			coreContracts.borrowerOperations.address,
			coreContracts.activePool.address,
			treasurySig
		)

		await YOUContracts.youStaking.unpause()

		await YOUContracts.communityIssuance.setAddresses(
			YOUContracts.youToken.address,
			coreContracts.stabilityPoolManager.address,
			coreContracts.adminContract.address
		)

		await YOUContracts.lockedYOU.setAddresses(YOUContracts.youToken.address)

		if (skipPool) {
			return
		}

		if ((await coreContracts.adminContract.owner()) != treasurySig)
			await coreContracts.adminContract.transferOwnership(treasurySig)

		await YOUContracts.youToken.approve(
			YOUContracts.communityIssuance.address,
			ethers.constants.MaxUint256,
			{ from: treasurySig }
		)

		const supply = dec(32000000, 18)
		const weeklyReward = dec(32000000 / 4, 18)

		await coreContracts.adminContract.addNewCollateral(
			ZERO_ADDRESS,
			coreContracts.stabilityPoolTemplate.address,
			ZERO_ADDRESS,
			ZERO_ADDRESS,
			supply,
			weeklyReward,
			0,
			{ from: treasurySig }
		)
		await YOUContracts.youToken.unprotectedMint(treasurySig, supply)
		await coreContracts.adminContract.addNewCollateral(
			coreContracts.erc20.address,
			coreContracts.stabilityPoolTemplate.address,
			ZERO_ADDRESS,
			ZERO_ADDRESS,
			supply,
			weeklyReward,
			0,
			{ from: treasurySig }
		)

		if (!liquitySettings) return

		//Set Liquity Configs (since the tests have been designed with it)
		await coreContracts.vestaParameters.setCollateralParameters(
			ZERO_ADDRESS,
			"1100000000000000000",
			"1500000000000000000",
			dec(200, 18),
			dec(1800, 18),
			200,
			50,
			500,
			50
		)

		await coreContracts.vestaParameters.setCollateralParameters(
			coreContracts.erc20.address,
			"1100000000000000000",
			"1500000000000000000",
			dec(200, 18),
			dec(1800, 18),
			200,
			50,
			500,
			50
		)
	}
}
module.exports = DeploymentHelper

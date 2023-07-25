const deploymentHelper = require("../../utils/deploymentHelpers.js")
const StabilityPool = artifacts.require("StabilityPool.sol")
const testHelpers = require("../../utils/testHelpers.js")
const th = testHelpers.TestHelper

contract(
	"Deployment script - Sets correct contract addresses dependencies after deployment",
	async accounts => {
		const [owner] = accounts
		const ZERO_ADDRESS = th.ZERO_ADDRESS

		const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

		let priceFeed
		let vstToken
		let sortedTroves
		let troveManager
		let activePool
		let stabilityPool
		let stabilityPoolManager
		let defaultPool
		let functionCaller
		let borrowerOperations
		let youStaking
		let youToken
		let communityIssuance
		let vestaParameters

		before(async () => {
			const coreContracts = await deploymentHelper.deployLiquityCore()
			const YOUContracts = await deploymentHelper.deployYOUContractsHardhat(accounts[0])

			priceFeed = coreContracts.priceFeedTestnet
			vstToken = coreContracts.vstToken
			sortedTroves = coreContracts.sortedTroves
			troveManager = coreContracts.troveManager
			activePool = coreContracts.activePool
			stabilityPoolManager = coreContracts.stabilityPoolManager
			defaultPool = coreContracts.defaultPool
			functionCaller = coreContracts.functionCaller
			borrowerOperations = coreContracts.borrowerOperations
			vestaParameters = coreContracts.vestaParameters

			youStaking = YOUContracts.youStaking
			youToken = YOUContracts.youToken
			communityIssuance = YOUContracts.communityIssuance

			await deploymentHelper.connectCoreContracts(coreContracts, YOUContracts)
			await deploymentHelper.connectYOUContractsToCore(YOUContracts, coreContracts)
			stabilityPool = await StabilityPool.at(
				await coreContracts.stabilityPoolManager.getAssetStabilityPool(coreContracts.erc20.address)
			)
		})

		it("Check if correct Addresses in Vault Parameters", async () => {
			assert.equal(priceFeed.address, await vestaParameters.priceFeed())
			assert.equal(activePool.address, await vestaParameters.activePool())
			assert.equal(defaultPool.address, await vestaParameters.defaultPool())
		})

		it("Sets the correct vestaParams address in TroveManager", async () => {
			assert.equal(vestaParameters.address, await troveManager.vestaParams())
		})

		it("Sets the correct UToken address in TroveManager", async () => {
			const UTokenAddress = vstToken.address

			const recordedClvTokenAddress = await troveManager.vstToken()

			assert.equal(UTokenAddress, recordedClvTokenAddress)
		})

		it("Sets the correct SortedTroves address in TroveManager", async () => {
			const sortedTrovesAddress = sortedTroves.address

			const recordedSortedTrovesAddress = await troveManager.sortedTroves()

			assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
		})

		it("Sets the correct BorrowerOperations address in TroveManager", async () => {
			const borrowerOperationsAddress = borrowerOperations.address

			const recordedBorrowerOperationsAddress = await troveManager.borrowerOperationsAddress()

			assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
		})

		it("Sets the correct StabilityPool address in TroveManager", async () => {
			assert.equal(stabilityPoolManager.address, await troveManager.stabilityPoolManager())
		})

		it("Sets the correct YOUStaking address in TroveManager", async () => {
			const YOUStakingAddress = youStaking.address

			const recordedYOUStakingAddress = await troveManager.youStaking()
			assert.equal(YOUStakingAddress, recordedYOUStakingAddress)
		})

		// Active Pool
		it("Sets the correct StabilityPool address in ActivePool", async () => {
			assert.equal(stabilityPoolManager.address, await activePool.stabilityPoolManager())
		})

		it("Sets the correct DefaultPool address in ActivePool", async () => {
			const defaultPoolAddress = defaultPool.address

			const recordedDefaultPoolAddress = await activePool.defaultPool()

			assert.equal(defaultPoolAddress, recordedDefaultPoolAddress)
		})

		it("Sets the correct BorrowerOperations address in ActivePool", async () => {
			const borrowerOperationsAddress = borrowerOperations.address

			const recordedBorrowerOperationsAddress = await activePool.borrowerOperationsAddress()

			assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
		})

		it("Sets the correct TroveManager address in ActivePool", async () => {
			const troveManagerAddress = troveManager.address

			const recordedTroveManagerAddress = await activePool.troveManagerAddress()
			assert.equal(troveManagerAddress, recordedTroveManagerAddress)
		})

		// Stability Pool
		it("Sets the correct BorrowerOperations address in StabilityPool", async () => {
			const borrowerOperationsAddress = borrowerOperations.address

			const recordedBorrowerOperationsAddress = await stabilityPool.borrowerOperations()

			assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
		})

		it("Sets the correct UToken address in StabilityPool", async () => {
			const UTokenAddress = vstToken.address

			const recordedClvTokenAddress = await stabilityPool.vstToken()

			assert.equal(UTokenAddress, recordedClvTokenAddress)
		})

		it("Sets the correct TroveManager address in StabilityPool", async () => {
			const troveManagerAddress = troveManager.address

			const recordedTroveManagerAddress = await stabilityPool.troveManager()
			assert.equal(troveManagerAddress, recordedTroveManagerAddress)
		})

		// Default Pool

		it("Sets the correct TroveManager address in DefaultPool", async () => {
			const troveManagerAddress = troveManager.address

			const recordedTroveManagerAddress = await defaultPool.troveManagerAddress()
			assert.equal(troveManagerAddress, recordedTroveManagerAddress)
		})

		it("Sets the correct ActivePool address in DefaultPool", async () => {
			const activePoolAddress = activePool.address

			const recordedActivePoolAddress = await defaultPool.activePoolAddress()
			assert.equal(activePoolAddress, recordedActivePoolAddress)
		})

		it("Sets the correct TroveManager address in SortedTroves", async () => {
			const borrowerOperationsAddress = borrowerOperations.address

			const recordedBorrowerOperationsAddress = await sortedTroves.borrowerOperationsAddress()
			assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
		})

		it("Sets the correct BorrowerOperations address in SortedTroves", async () => {
			const troveManagerAddress = troveManager.address

			const recordedTroveManagerAddress = await sortedTroves.troveManager()
			assert.equal(troveManagerAddress, recordedTroveManagerAddress)
		})

		//--- BorrowerOperations ---

		it("Sets the correct VestaParameters address in BorrowerOperations", async () => {
			assert.equal(vestaParameters.address, await borrowerOperations.vestaParams())
		})

		// TroveManager in BO
		it("Sets the correct TroveManager address in BorrowerOperations", async () => {
			const troveManagerAddress = troveManager.address

			const recordedTroveManagerAddress = await borrowerOperations.troveManager()
			assert.equal(troveManagerAddress, recordedTroveManagerAddress)
		})

		// setSortedTroves in BO
		it("Sets the correct SortedTroves address in BorrowerOperations", async () => {
			const sortedTrovesAddress = sortedTroves.address

			const recordedSortedTrovesAddress = await borrowerOperations.sortedTroves()
			assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
		})

		// YOU Staking in BO
		it("Sets the correct YOUStaking address in BorrowerOperations", async () => {
			const YOUStakingAddress = youStaking.address

			const recordedYOUStakingAddress = await borrowerOperations.YOUStakingAddress()
			assert.equal(YOUStakingAddress, recordedYOUStakingAddress)
		})

		// --- YOU Staking ---

		// Sets YOUToken in YOUStaking
		it("Sets the correct YOUToken address in YOUStaking", async () => {
			const YOUTokenAddress = youToken.address

			const recordedYOUTokenAddress = await youStaking.youToken()
			assert.equal(YOUTokenAddress, recordedYOUTokenAddress)
		})

		// Sets ActivePool in YOUStaking
		it("Sets the correct ActivePool address in YOUStaking", async () => {
			const activePoolAddress = activePool.address

			const recordedActivePoolAddress = await youStaking.activePoolAddress()
			assert.equal(activePoolAddress, recordedActivePoolAddress)
		})

		// Sets UToken in YOUStaking
		it("Sets the correct ActivePool address in YOUStaking", async () => {
			const UTokenAddress = vstToken.address

			const recordedUTokenAddress = await youStaking.vstToken()
			assert.equal(UTokenAddress, recordedUTokenAddress)
		})

		// Sets TroveManager in YOUStaking
		it("Sets the correct ActivePool address in YOUStaking", async () => {
			const troveManagerAddress = troveManager.address

			const recordedTroveManagerAddress = await youStaking.troveManagerAddress()
			assert.equal(troveManagerAddress, recordedTroveManagerAddress)
		})

		// Sets BorrowerOperations in YOUStaking
		it("Sets the correct BorrowerOperations address in YOUStaking", async () => {
			const borrowerOperationsAddress = borrowerOperations.address

			const recordedBorrowerOperationsAddress = await youStaking.borrowerOperationsAddress()
			assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
		})

		// ---  YOUToken ---

		// --- CI ---
		// Sets YOUToken in CommunityIssuance
		it("Sets the correct YOUToken address in CommunityIssuance", async () => {
			const YOUTokenAddress = youToken.address

			const recordedYOUTokenAddress = await communityIssuance.youToken()
			assert.equal(YOUTokenAddress, recordedYOUTokenAddress)
		})

		it("Sets the correct StabilityPool address in CommunityIssuance", async () => {
			assert.equal(
				stabilityPoolManager.address,
				await communityIssuance.stabilityPoolManager()
			)
		})
	}
)

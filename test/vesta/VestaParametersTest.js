const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract("VestaParameters", async accounts => {
	const ZERO_ADDRESS = th.ZERO_ADDRESS
	const assertRevert = th.assertRevert
	const DECIMAL_PRECISION = toBN(dec(1, 18))
	const [owner, user, A, C, B, multisig] = accounts

	let contracts
	let priceFeed
	let borrowerOperations
	let youParameters
	let erc20

	let MCR
	let CCR
	let GAS_COMPENSATION
	let MIN_NET_DEBT
	let PERCENT_DIVISOR
	let BORROWING_FEE_FLOOR
	let MAX_BORROWING_FEE
	let REDEMPTION_FEE_FLOOR

	const MCR_SAFETY_MAX = toBN(dec(1000, 18)).div(toBN(100))
	const MCR_SAFETY_MIN = toBN(dec(101, 18)).div(toBN(100))

	const CCR_SAFETY_MAX = toBN(dec(1000, 18)).div(toBN(100))
	const CCR_SAFETY_MIN = toBN(dec(101, 18)).div(toBN(100))

	const PERCENT_DIVISOR_SAFETY_MAX = toBN(200)
	const PERCENT_DIVISOR_SAFETY_MIN = toBN(2)

	const BORROWING_FEE_FLOOR_SAFETY_MAX = toBN(1000) //10%
	const BORROWING_FEE_FLOOR_SAFETY_MIN = toBN(0)

	const MAX_BORROWING_FEE_SAFETY_MAX = toBN(1000) //10%
	const MAX_BORROWING_FEE_SAFETY_MIN = toBN(0)

	const VSTA_GAS_COMPENSATION_SAFETY_MAX = toBN(dec(400, 18))
	const VSTA_GAS_COMPENSATION_SAFETY_MIN = toBN(dec(1, 18))

	const MIN_NET_DEBT_SAFETY_MAX = toBN(dec(1800, 18))
	const MIN_NET_DEBT_SAFETY_MIN = toBN(0)

	const REDEMPTION_FEE_FLOOR_SAFETY_MAX = toBN(1000)
	const REDEMPTION_FEE_FLOOR_SAFETY_MIN = toBN(10)

	const openTrove = async params => th.openTrove(contracts, params)

	function applyDecimalPrecision(value) {
		return DECIMAL_PRECISION.div(toBN(10000)).mul(toBN(value.toString()))
	}

	describe("You Parameters", async () => {
		beforeEach(async () => {
			contracts = await deploymentHelper.deployLiquityCore()
			contracts.troveManager = await TroveManagerTester.new()
			const VSTAContracts = await deploymentHelper.deployVSTAContractsHardhat(accounts[0])

			priceFeed = contracts.priceFeedTestnet
			troveManager = contracts.troveManager
			activePool = contracts.activePool
			defaultPool = contracts.defaultPool
			borrowerOperations = contracts.borrowerOperations
			youParameters = contracts.youParameters
			erc20 = contracts.erc20

			MCR = await youParameters.MCR_DEFAULT()
			CCR = await youParameters.CCR_DEFAULT()
			GAS_COMPENSATION = await youParameters.VST_GAS_COMPENSATION_DEFAULT()
			MIN_NET_DEBT = await youParameters.MIN_NET_DEBT_DEFAULT()
			PERCENT_DIVISOR = await youParameters.PERCENT_DIVISOR_DEFAULT()
			BORROWING_FEE_FLOOR = await youParameters.BORROWING_FEE_FLOOR_DEFAULT()
			MAX_BORROWING_FEE = await youParameters.MAX_BORROWING_FEE_DEFAULT()
			REDEMPTION_FEE_FLOOR = await youParameters.REDEMPTION_FEE_FLOOR_DEFAULT()

			let index = 0
			for (const acc of accounts) {
				await erc20.mint(acc, await web3.eth.getBalance(acc))
				index++

				if (index >= 20) break
			}

			await deploymentHelper.connectCoreContracts(contracts, VSTAContracts)
			await deploymentHelper.connectVSTAContractsToCore(VSTAContracts, contracts, false, false)
		})

		it("Formula Checks: Call every function with default value, Should match default values", async () => {
			await youParameters.setMCR(ZERO_ADDRESS, "1100000000000000000")
			await youParameters.setCCR(ZERO_ADDRESS, "1500000000000000000")
			await youParameters.setPercentDivisor(ZERO_ADDRESS, 100)
			await youParameters.setBorrowingFeeFloor(ZERO_ADDRESS, 50)
			await youParameters.setMaxBorrowingFee(ZERO_ADDRESS, 500)
			await youParameters.setVSTGasCompensation(ZERO_ADDRESS, dec(30, 18))
			await youParameters.setMinNetDebt(ZERO_ADDRESS, dec(300, 18))
			await youParameters.setRedemptionFeeFloor(ZERO_ADDRESS, 50)

			assert.equal((await youParameters.MCR(ZERO_ADDRESS)).toString(), MCR)
			assert.equal((await youParameters.CCR(ZERO_ADDRESS)).toString(), CCR)
			assert.equal(
				(await youParameters.PERCENT_DIVISOR(ZERO_ADDRESS)).toString(),
				PERCENT_DIVISOR
			)
			assert.equal(
				(await youParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)).toString(),
				BORROWING_FEE_FLOOR
			)
			assert.equal(
				(await youParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)).toString(),
				MAX_BORROWING_FEE
			)
			assert.equal(
				(await youParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)).toString(),
				GAS_COMPENSATION
			)
			assert.equal((await youParameters.MIN_NET_DEBT(ZERO_ADDRESS)).toString(), MIN_NET_DEBT)
			assert.equal(
				(await youParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)).toString(),
				REDEMPTION_FEE_FLOOR
			)
		})

		it("Try to edit Parameters has User, Revert Transactions", async () => {
			await assertRevert(youParameters.setPriceFeed(priceFeed.address, { from: user }))
			await assertRevert(youParameters.setAsDefault(ZERO_ADDRESS, { from: user }))
			await assertRevert(
				youParameters.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE_FLOOR,
					MAX_BORROWING_FEE,
					REDEMPTION_FEE_FLOOR,
					{ from: user }
				)
			)

			await assertRevert(youParameters.setMCR(ZERO_ADDRESS, MCR, { from: user }))
			await assertRevert(youParameters.setCCR(ZERO_ADDRESS, CCR, { from: user }))
			await assertRevert(
				youParameters.setVSTGasCompensation(ZERO_ADDRESS, GAS_COMPENSATION, { from: user })
			)
			await assertRevert(
				youParameters.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT, { from: user })
			)
			await assertRevert(
				youParameters.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR, { from: user })
			)
			await assertRevert(
				youParameters.setBorrowingFeeFloor(ZERO_ADDRESS, BORROWING_FEE_FLOOR, { from: user })
			)
			await assertRevert(
				youParameters.setMaxBorrowingFee(ZERO_ADDRESS, MAX_BORROWING_FEE, { from: user })
			)
			await assertRevert(
				youParameters.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR, { from: user })
			)
		})

		it("sanitizeParameters: User call sanitizeParameters on Non-Configured Collateral - Set Default Values", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS, { from: user })

			assert.equal(MCR.toString(), await youParameters.MCR(ZERO_ADDRESS))
			assert.equal(CCR.toString(), await youParameters.CCR(ZERO_ADDRESS))
			assert.equal(
				GAS_COMPENSATION.toString(),
				await youParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)
			)
			assert.equal(MIN_NET_DEBT.toString(), await youParameters.MIN_NET_DEBT(ZERO_ADDRESS))
			assert.equal(
				PERCENT_DIVISOR.toString(),
				await youParameters.PERCENT_DIVISOR(ZERO_ADDRESS)
			)
			assert.equal(
				BORROWING_FEE_FLOOR.toString(),
				await youParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)
			)
			assert.equal(
				MAX_BORROWING_FEE.toString(),
				await youParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)
			)
			assert.equal(
				REDEMPTION_FEE_FLOOR.toString(),
				await youParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)
			)
		})

		it("sanitizeParameters: User call sanitizeParamaters on Configured Collateral - Ignore it", async () => {
			const newMCR = MCR_SAFETY_MAX
			const newCCR = CCR_SAFETY_MIN
			const newGasComp = VSTA_GAS_COMPENSATION_SAFETY_MAX
			const newMinNetDebt = MIN_NET_DEBT_SAFETY_MIN
			const newPercentDivisor = PERCENT_DIVISOR_SAFETY_MAX
			const newBorrowingFeeFloor = BORROWING_FEE_FLOOR_SAFETY_MAX
			const newMaxBorrowingFee = MAX_BORROWING_FEE_SAFETY_MIN
			const newRedemptionFeeFloor = REDEMPTION_FEE_FLOOR_SAFETY_MAX

			const expectedBorrowingFeeFloor = applyDecimalPrecision(newBorrowingFeeFloor)
			const expectedMaxBorrowingFee = applyDecimalPrecision(newMaxBorrowingFee)
			const expectedRedemptionFeeFloor = applyDecimalPrecision(newRedemptionFeeFloor)

			await youParameters.setCollateralParameters(
				ZERO_ADDRESS,
				newMCR,
				newCCR,
				newGasComp,
				newMinNetDebt,
				newPercentDivisor,
				newBorrowingFeeFloor,
				newMaxBorrowingFee,
				newRedemptionFeeFloor,
				{ from: owner }
			)

			await youParameters.sanitizeParameters(ZERO_ADDRESS, { from: user })

			assert.equal(newMCR.toString(), await youParameters.MCR(ZERO_ADDRESS))
			assert.equal(newCCR.toString(), await youParameters.CCR(ZERO_ADDRESS))
			assert.equal(
				newGasComp.toString(),
				await youParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)
			)
			assert.equal(newMinNetDebt.toString(), await youParameters.MIN_NET_DEBT(ZERO_ADDRESS))
			assert.equal(
				newPercentDivisor.toString(),
				await youParameters.PERCENT_DIVISOR(ZERO_ADDRESS)
			)
			assert.equal(
				expectedBorrowingFeeFloor.toString(),
				await youParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)
			)
			assert.equal(
				expectedMaxBorrowingFee.toString(),
				await youParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)
			)
			assert.equal(
				expectedRedemptionFeeFloor.toString(),
				await youParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)
			)
		})

		it("setPriceFeed: Owner change parameter - Failing SafeCheck", async () => {
			await assertRevert(youParameters.setPriceFeed(ZERO_ADDRESS))
		})

		it("setPriceFeed: Owner change parameter - Valid Check", async () => {
			await youParameters.setPriceFeed(priceFeed.address)
		})

		it("setMCR: Owner change parameter - Failing SafeCheck", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(youParameters.setMCR(ZERO_ADDRESS, MCR_SAFETY_MIN.sub(toBN(1))))
			await assertRevert(youParameters.setMCR(ZERO_ADDRESS, MCR_SAFETY_MAX.add(toBN(1))))
		})

		it("setMCR: Owner change parameter - Valid SafeCheck", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await youParameters.setMCR(ZERO_ADDRESS, MCR_SAFETY_MIN)
			assert.equal(MCR_SAFETY_MIN.toString(), await youParameters.MCR(ZERO_ADDRESS))

			await youParameters.setMCR(ZERO_ADDRESS, MCR_SAFETY_MAX)
			assert.equal(MCR_SAFETY_MAX.toString(), await youParameters.MCR(ZERO_ADDRESS))
		})

		it("setCCR: Owner change parameter - Failing SafeCheck", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(youParameters.setCCR(ZERO_ADDRESS, CCR_SAFETY_MIN.sub(toBN(1))))
			await assertRevert(youParameters.setCCR(ZERO_ADDRESS, CCR_SAFETY_MAX.add(toBN(1))))
		})

		it("setCCR: Owner change parameter - Valid SafeCheck", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await youParameters.setCCR(ZERO_ADDRESS, CCR_SAFETY_MIN)
			assert.equal(CCR_SAFETY_MIN.toString(), await youParameters.CCR(ZERO_ADDRESS))

			await youParameters.setCCR(ZERO_ADDRESS, CCR_SAFETY_MAX)
			assert.equal(CCR_SAFETY_MAX.toString(), await youParameters.CCR(ZERO_ADDRESS))
		})

		it("setVSTGasCompensation: Owner change parameter - Failing SafeCheck", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(
				youParameters.setVSTGasCompensation(
					ZERO_ADDRESS,
					VSTA_GAS_COMPENSATION_SAFETY_MIN.sub(toBN(1))
				)
			)
			await assertRevert(
				youParameters.setVSTGasCompensation(
					ZERO_ADDRESS,
					VSTA_GAS_COMPENSATION_SAFETY_MAX.add(toBN(1))
				)
			)
		})

		it("setVSTGasCompensation: Owner change parameter - Valid SafeCheck", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await youParameters.setVSTGasCompensation(ZERO_ADDRESS, VSTA_GAS_COMPENSATION_SAFETY_MIN)
			assert.equal(
				VSTA_GAS_COMPENSATION_SAFETY_MIN.toString(),
				await youParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)
			)

			await youParameters.setVSTGasCompensation(ZERO_ADDRESS, VSTA_GAS_COMPENSATION_SAFETY_MAX)
			assert.equal(
				VSTA_GAS_COMPENSATION_SAFETY_MAX.toString(),
				await youParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)
			)
		})

		it("setMinNetDebt: Owner change parameter - Failing SafeCheck", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)
			await assertRevert(
				youParameters.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT_SAFETY_MAX.add(toBN(1)))
			)
		})

		it("setMinNetDebt: Owner change parameter - Valid SafeCheck", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await youParameters.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT_SAFETY_MIN)
			assert.equal(
				MIN_NET_DEBT_SAFETY_MIN.toString(),
				await youParameters.MIN_NET_DEBT(ZERO_ADDRESS)
			)

			await youParameters.setMinNetDebt(ZERO_ADDRESS, MIN_NET_DEBT_SAFETY_MAX)
			assert.equal(
				MIN_NET_DEBT_SAFETY_MAX.toString(),
				await youParameters.MIN_NET_DEBT(ZERO_ADDRESS)
			)
		})

		it("setPercentDivisor: Owner change parameter - Failing SafeCheck", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(
				youParameters.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MIN.sub(toBN(1)))
			)
			await assertRevert(
				youParameters.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MAX.add(toBN(1)))
			)
		})

		it("setPercentDivisor: Owner change parameter - Valid SafeCheck", async () => {
			await youParameters.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MIN)
			assert.equal(
				PERCENT_DIVISOR_SAFETY_MIN.toString(),
				await youParameters.PERCENT_DIVISOR(ZERO_ADDRESS)
			)

			await youParameters.setPercentDivisor(ZERO_ADDRESS, PERCENT_DIVISOR_SAFETY_MAX)
			assert.equal(
				PERCENT_DIVISOR_SAFETY_MAX.toString(),
				await youParameters.PERCENT_DIVISOR(ZERO_ADDRESS)
			)
		})

		it("setBorrowingFeeFloor: Owner change parameter - Failing SafeCheck", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(
				youParameters.setBorrowingFeeFloor(
					ZERO_ADDRESS,
					BORROWING_FEE_FLOOR_SAFETY_MAX.add(toBN(1))
				)
			)
		})

		it("setBorrowingFeeFloor: Owner change parameter - Valid SafeCheck", async () => {
			const expectedMin = applyDecimalPrecision(BORROWING_FEE_FLOOR_SAFETY_MIN)
			const expectedMax = applyDecimalPrecision(BORROWING_FEE_FLOOR_SAFETY_MAX)

			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await youParameters.setBorrowingFeeFloor(ZERO_ADDRESS, BORROWING_FEE_FLOOR_SAFETY_MIN)
			assert.equal(
				expectedMin.toString(),
				await youParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)
			)

			await youParameters.setMaxBorrowingFee(ZERO_ADDRESS, MAX_BORROWING_FEE_SAFETY_MAX)
			await youParameters.setBorrowingFeeFloor(ZERO_ADDRESS, BORROWING_FEE_FLOOR_SAFETY_MAX)
			assert.equal(
				expectedMax.toString(),
				await youParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)
			)
		})

		it("setMaxBorrowingFee: Owner change parameter - Failing SafeCheck", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(
				youParameters.setMaxBorrowingFee(
					ZERO_ADDRESS,
					MAX_BORROWING_FEE_SAFETY_MAX.add(toBN(1))
				)
			)
		})

		it("setMaxBorrowingFee: Owner change parameter - Valid SafeCheck", async () => {
			const expectedMin = applyDecimalPrecision(MAX_BORROWING_FEE_SAFETY_MIN)
			const expectedMax = applyDecimalPrecision(MAX_BORROWING_FEE_SAFETY_MAX)

			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await youParameters.setMaxBorrowingFee(ZERO_ADDRESS, MAX_BORROWING_FEE_SAFETY_MIN)
			assert.equal(expectedMin.toString(), await youParameters.MAX_BORROWING_FEE(ZERO_ADDRESS))

			await youParameters.setMaxBorrowingFee(ZERO_ADDRESS, MAX_BORROWING_FEE_SAFETY_MAX)
			assert.equal(expectedMax.toString(), await youParameters.MAX_BORROWING_FEE(ZERO_ADDRESS))
		})

		it("setRedemptionFeeFloor: Owner change parameter - Failing SafeCheck", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await assertRevert(
				youParameters.setRedemptionFeeFloor(
					ZERO_ADDRESS,
					REDEMPTION_FEE_FLOOR_SAFETY_MIN.sub(toBN(1))
				)
			)
			await assertRevert(
				youParameters.setRedemptionFeeFloor(
					ZERO_ADDRESS,
					REDEMPTION_FEE_FLOOR_SAFETY_MAX.add(toBN(1))
				)
			)
		})

		it("setRedemptionFeeFloor: Owner change parameter - Valid SafeCheck", async () => {
			const expectedMin = applyDecimalPrecision(REDEMPTION_FEE_FLOOR_SAFETY_MIN)
			const expectedMax = applyDecimalPrecision(REDEMPTION_FEE_FLOOR_SAFETY_MAX)

			await youParameters.sanitizeParameters(ZERO_ADDRESS)

			await youParameters.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MIN)
			assert.equal(
				expectedMin.toString(),
				await youParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)
			)

			await youParameters.setRedemptionFeeFloor(ZERO_ADDRESS, REDEMPTION_FEE_FLOOR_SAFETY_MAX)
			assert.equal(
				expectedMax.toString(),
				await youParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)
			)
		})

		it("setCollateralParameters: Owner change parameter - Failing SafeCheck", async () => {
			await assertRevert(
				youParameters.setCollateralParameters(
					ZERO_ADDRESS,
					MCR_SAFETY_MAX.add(toBN(1)),
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE_FLOOR,
					MAX_BORROWING_FEE,
					REDEMPTION_FEE_FLOOR
				)
			)

			await assertRevert(
				youParameters.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR_SAFETY_MAX.add(toBN(1)),
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE_FLOOR,
					MAX_BORROWING_FEE,
					REDEMPTION_FEE_FLOOR
				)
			)

			await assertRevert(
				youParameters.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					VSTA_GAS_COMPENSATION_SAFETY_MAX.add(toBN(1)),
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE_FLOOR,
					MAX_BORROWING_FEE,
					REDEMPTION_FEE_FLOOR
				)
			)

			await assertRevert(
				youParameters.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT_SAFETY_MAX.add(toBN(1)),
					PERCENT_DIVISOR,
					BORROWING_FEE_FLOOR,
					MAX_BORROWING_FEE,
					REDEMPTION_FEE_FLOOR
				)
			)

			await assertRevert(
				youParameters.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR_SAFETY_MAX.add(toBN(1)),
					BORROWING_FEE_FLOOR,
					MAX_BORROWING_FEE,
					REDEMPTION_FEE_FLOOR
				)
			)

			await assertRevert(
				youParameters.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE_FLOOR_SAFETY_MAX.add(toBN(1)),
					MAX_BORROWING_FEE,
					REDEMPTION_FEE_FLOOR
				)
			)

			await assertRevert(
				youParameters.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE_FLOOR,
					MAX_BORROWING_FEE_SAFETY_MAX.add(toBN(1)),
					REDEMPTION_FEE_FLOOR
				)
			)

			await assertRevert(
				youParameters.setCollateralParameters(
					ZERO_ADDRESS,
					MCR,
					CCR,
					GAS_COMPENSATION,
					MIN_NET_DEBT,
					PERCENT_DIVISOR,
					BORROWING_FEE_FLOOR,
					MAX_BORROWING_FEE,
					REDEMPTION_FEE_FLOOR_SAFETY_MAX.add(toBN(1))
				)
			)
		})

		it("setCollateralParameters: Owner change parameter - Valid SafeCheck Then Reset", async () => {
			const newMCR = MCR_SAFETY_MAX
			const newCCR = CCR_SAFETY_MIN
			const newGasComp = VSTA_GAS_COMPENSATION_SAFETY_MAX
			const newMinNetDebt = MIN_NET_DEBT_SAFETY_MAX
			const newPercentDivisor = PERCENT_DIVISOR_SAFETY_MIN
			const newBorrowingFeeFloor = BORROWING_FEE_FLOOR_SAFETY_MAX
			const newMaxBorrowingFee = MAX_BORROWING_FEE_SAFETY_MAX
			const newRedemptionFeeFloor = REDEMPTION_FEE_FLOOR_SAFETY_MIN

			const expectedBorrowingFeeFloor = applyDecimalPrecision(newBorrowingFeeFloor)
			const expectedMaxBorrowingFee = applyDecimalPrecision(newMaxBorrowingFee)
			const expectedRedemptionFeeFloor = applyDecimalPrecision(newRedemptionFeeFloor)

			await youParameters.setCollateralParameters(
				ZERO_ADDRESS,
				newMCR,
				newCCR,
				newGasComp,
				newMinNetDebt,
				newPercentDivisor,
				newBorrowingFeeFloor,
				newMaxBorrowingFee,
				newRedemptionFeeFloor,
				{ from: owner }
			)

			assert.equal(newMCR.toString(), await youParameters.MCR(ZERO_ADDRESS))
			assert.equal(newCCR.toString(), await youParameters.CCR(ZERO_ADDRESS))
			assert.equal(
				newGasComp.toString(),
				await youParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)
			)
			assert.equal(newMinNetDebt.toString(), await youParameters.MIN_NET_DEBT(ZERO_ADDRESS))
			assert.equal(
				newPercentDivisor.toString(),
				await youParameters.PERCENT_DIVISOR(ZERO_ADDRESS)
			)
			assert.equal(
				expectedBorrowingFeeFloor.toString(),
				await youParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)
			)
			assert.equal(
				expectedMaxBorrowingFee.toString(),
				await youParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)
			)
			assert.equal(
				expectedRedemptionFeeFloor.toString(),
				await youParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)
			)

			await youParameters.setAsDefault(ZERO_ADDRESS)

			assert.equal(MCR.toString(), await youParameters.MCR(ZERO_ADDRESS))
			assert.equal(CCR.toString(), await youParameters.CCR(ZERO_ADDRESS))
			assert.equal(
				GAS_COMPENSATION.toString(),
				await youParameters.VST_GAS_COMPENSATION(ZERO_ADDRESS)
			)
			assert.equal(MIN_NET_DEBT.toString(), await youParameters.MIN_NET_DEBT(ZERO_ADDRESS))
			assert.equal(
				PERCENT_DIVISOR.toString(),
				await youParameters.PERCENT_DIVISOR(ZERO_ADDRESS)
			)
			assert.equal(
				BORROWING_FEE_FLOOR.toString(),
				await youParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)
			)
			assert.equal(
				MAX_BORROWING_FEE.toString(),
				await youParameters.MAX_BORROWING_FEE(ZERO_ADDRESS)
			)
			assert.equal(
				REDEMPTION_FEE_FLOOR.toString(),
				await youParameters.REDEMPTION_FEE_FLOOR(ZERO_ADDRESS)
			)
		})

		it("openTrove(): Borrowing at zero base rate charges minimum fee with different borrowingFeeFloor", async () => {
			await youParameters.sanitizeParameters(ZERO_ADDRESS)
			await youParameters.sanitizeParameters(erc20.address)

			await youParameters.setBorrowingFeeFloor(ZERO_ADDRESS, BORROWING_FEE_FLOOR_SAFETY_MIN)
			await youParameters.setMaxBorrowingFee(erc20.address, MAX_BORROWING_FEE_SAFETY_MAX)
			await youParameters.setBorrowingFeeFloor(erc20.address, BORROWING_FEE_FLOOR_SAFETY_MAX)

			assert.equal(
				applyDecimalPrecision(BORROWING_FEE_FLOOR_SAFETY_MIN).toString(),
				await youParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS)
			)
			assert.equal(
				applyDecimalPrecision(BORROWING_FEE_FLOOR_SAFETY_MAX).toString(),
				await youParameters.BORROWING_FEE_FLOOR(erc20.address)
			)

			await openTrove({
				extraVSTAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openTrove({
				extraVSTAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})

			await openTrove({
				asset: erc20.address,
				extraVSTAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: A },
			})
			await openTrove({
				asset: erc20.address,
				extraVSTAmount: toBN(dec(5000, 18)),
				ICR: toBN(dec(2, 18)),
				extraParams: { from: B },
			})

			const USDVRequest = toBN(dec(10000, 18))
			const txC = await borrowerOperations.openTrove(
				ZERO_ADDRESS,
				0,
				th._100pct,
				USDVRequest,
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ value: dec(100, "ether"), from: C }
			)
			const txC_Asset = await borrowerOperations.openTrove(
				erc20.address,
				dec(100, "ether"),
				th._100pct,
				USDVRequest,
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				{ from: C }
			)
			const _VSTFee = toBN(th.getEventArgByName(txC, "VSTBorrowingFeePaid", "_VSTFee"))
			const _USDVFee_Asset = toBN(
				th.getEventArgByName(txC_Asset, "VSTBorrowingFeePaid", "_VSTFee")
			)

			const expectedFee = (await youParameters.BORROWING_FEE_FLOOR(ZERO_ADDRESS))
				.mul(toBN(USDVRequest))
				.div(toBN(dec(1, 18)))
			const expectedFee_Asset = (await youParameters.BORROWING_FEE_FLOOR(erc20.address))
				.mul(toBN(USDVRequest))
				.div(toBN(dec(1, 18)))
			assert.isTrue(_VSTFee.eq(expectedFee))
			assert.isTrue(_USDVFee_Asset.eq(expectedFee_Asset))
		})
	})
})


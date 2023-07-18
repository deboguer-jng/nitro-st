const { ChainlinkAggregatorV3Interface } = require("./ABIs/ChainlinkAggregatorV3Interface.js")
const { TestHelper: th, TimeValues: timeVals } = require("../utils/testHelpers.js")
const { dec } = th

const MainnetDeploymentHelper = require("../utils/mainnetDeploymentHelpers.js")
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const toBN = ethers.BigNumber.from

let mdh
let config
let deployerWallet
let gasPrice
let vestaCore
let YOUContracts
let deploymentState

let ADMIN_WALLET
let TREASURY_WALLET

async function mainnetDeploy(configParams) {
	console.log(new Date().toUTCString())

	config = configParams
	gasPrice = config.GAS_PRICE

	ADMIN_WALLET = config.vestaAddresses.ADMIN_MULTI
	TREASURY_WALLET = config.vestaAddresses.YOU_SAFE

	deployerWallet = (await ethers.getSigners())[0]
	mdh = new MainnetDeploymentHelper(config, deployerWallet)

	deploymentState = mdh.loadPreviousDeployment()

	console.log(`deployer address: ${deployerWallet.address}`)
	assert.equal(deployerWallet.address, config.vestaAddresses.DEPLOYER)

	console.log(
		`deployerETHBalance before: ${await ethers.provider.getBalance(deployerWallet.address)}`
	)

	if (config.YOU_TOKEN_ONLY) {
		console.log("INIT YOU ONLY")
		const partialContracts = await mdh.deployPartially(TREASURY_WALLET, deploymentState)

		// create vesting rule to beneficiaries
		console.log("Beneficiaries")

		if (
			(await partialContracts.YOUToken.allowance(
				deployerWallet.address,
				partialContracts.lockedYou.address
			)) == 0
		)
			await partialContracts.YOUToken.approve(
				partialContracts.lockedYou.address,
				ethers.constants.MaxUint256
			)

		for (const [wallet, amount] of Object.entries(config.beneficiaries)) {
			if (amount == 0) continue

			if (!(await partialContracts.lockedYou.isEntityExits(wallet))) {
				console.log("Beneficiary: %s for %s", wallet, amount)

				const txReceipt = await mdh.sendAndWaitForTransaction(
					partialContracts.lockedYou.addEntityVesting(wallet, dec(amount, 18))
				)

				deploymentState[wallet] = {
					amount: amount,
					txHash: txReceipt.transactionHash,
				}

				mdh.saveDeployment(deploymentState)
			}
		}

		await transferOwnership(partialContracts.lockedYou, TREASURY_WALLET)

		const balance = await partialContracts.YOUToken.balanceOf(deployerWallet.address)
		console.log(`Sending ${balance} YOU to ${TREASURY_WALLET}`)
		await partialContracts.YOUToken.transfer(TREASURY_WALLET, balance)

		console.log(
			`deployerETHBalance after: ${await ethers.provider.getBalance(deployerWallet.address)}`
		)

		return
	}

	console.log({ deploymentState })
	// Deploy core logic contracts
	vestaCore = await mdh.deployLiquityCoreMainnet(
		config.externalAddrs.TELLOR_MASTER,
		deploymentState,
		ADMIN_WALLET
	)

	await mdh.logContractObjects(vestaCore)

	// Deploy YOU Contracts
	YOUContracts = await mdh.deployYOUContractsMainnet(
		TREASURY_WALLET, // multisig YOU endowment address
		deploymentState
	)

	// Connect all core contracts up
	console.log("Connect Core Contracts up")

	await mdh.connectCoreContractsMainnet(
		vestaCore,
		YOUContracts,
		config.externalAddrs.CHAINLINK_SEQUENCER_UPTIME_FEED,
		config.externalAddrs.WST_ETH
	)

	console.log("Connect YOU Contract to Core")
	await mdh.connectYOUContractsToCoreMainnet(YOUContracts, vestaCore, TREASURY_WALLET)

	console.log("Adding Collaterals")
	const allowance = await YOUContracts.YOUToken.allowance(
		deployerWallet.address,
		YOUContracts.communityIssuance.address
	)
	if (allowance == 0)
		await YOUContracts.YOUToken.approve(
			YOUContracts.communityIssuance.address,
			ethers.constants.MaxUint256
		)

	await addWstETHCollaterals(config.externalAddrs.WST_ETH)
	// await addETHCollaterals()
	// await addBTCCollaterals()
	// await addGOHMCollaterals()

	mdh.saveDeployment(deploymentState)

	await mdh.deployMultiTroveGetterMainnet(
		vestaCore,
		deploymentState,
		config.externalAddrs.WST_ETH
	)
	await mdh.logContractObjects(YOUContracts)

	await giveContractsOwnerships()
}

async function addWstETHCollaterals(wstEthAddress) {
	if (
		(await vestaCore.stabilityPoolManager.unsafeGetAssetStabilityPool(wstEthAddress)) ==
		ZERO_ADDRESS
	) {
		console.log("Creating Collateral - WstETH")

		const txReceiptProxyWstETH = await mdh.sendAndWaitForTransaction(
			vestaCore.adminContract.addNewCollateral(
				wstEthAddress,
				vestaCore.stabilityPoolV1.address,
				config.externalAddrs.CHAINLINK_ETHUSD_PROXY,
				config.externalAddrs.TELLOR_QUERY_ID, /// tellorId
				dec(100_000, 18),
				toBN(dec(100_000, 18)).div(toBN(4)),
				config.REDEMPTION_SAFETY
			),
			{
				gasPrice,
			}
		)

		console.log({ txReceiptProxyWstETH })

		console.log({
			poolManagerPool: await vestaCore.stabilityPoolManager.unsafeGetAssetStabilityPool(
				wstEthAddress
			),
		})

		deploymentState["ProxyStabilityPoolWstETH"] = {
			address: await vestaCore.stabilityPoolManager.getAssetStabilityPool(wstEthAddress),
			txHash: txReceiptProxyWstETH.transactionHash,
		}
	}
}

async function addETHCollaterals() {
	if (
		(await vestaCore.stabilityPoolManager.unsafeGetAssetStabilityPool(ZERO_ADDRESS)) ==
		ZERO_ADDRESS
	) {
		console.log("Creating Collateral - ETH")

		const txReceiptProxyETH = await mdh.sendAndWaitForTransaction(
			vestaCore.adminContract.addNewCollateral(
				ZERO_ADDRESS,
				vestaCore.stabilityPoolV1.address,
				config.externalAddrs.CHAINLINK_ETHUSD_PROXY,
				ZERO_ADDRESS,
				dec(100_000, 18),
				toBN(dec(100_000, 18)).div(toBN(4)),
				config.REDEMPTION_SAFETY
			),
			{
				gasPrice,
			}
		)

		deploymentState["ProxyStabilityPoolETH"] = {
			address: await vestaCore.stabilityPoolManager.getAssetStabilityPool(ZERO_ADDRESS),
			txHash: txReceiptProxyETH.transactionHash,
		}
	}
}

async function addBTCCollaterals() {
	const BTCAddress = !config.IsMainnet
		? await mdh.deployMockERC20Contract(deploymentState, "renBTC", 8)
		: config.externalAddrs.REN_BTC

	if (!BTCAddress || BTCAddress == "") throw "CANNOT FIND THE renBTC Address"

	console.log((await vestaCore.priceFeed.lastGoodPrice(BTCAddress)).toString())

	if (
		(await vestaCore.stabilityPoolManager.unsafeGetAssetStabilityPool(BTCAddress)) ==
		ZERO_ADDRESS
	) {
		console.log("Creating Collateral - BTC")

		const txReceiptProxyBTC = await mdh.sendAndWaitForTransaction(
			vestaCore.adminContract.addNewCollateral(
				BTCAddress,
				vestaCore.stabilityPoolV1.address,
				config.externalAddrs.CHAINLINK_BTCUSD_PROXY,
				ZERO_ADDRESS,
				dec(30_000, 18),
				toBN(dec(30_000, 18)).div(toBN(4)),
				config.REDEMPTION_SAFETY
			)
		)

		deploymentState["ProxyStabilityPoolRenBTC"] = {
			address: await vestaCore.stabilityPoolManager.getAssetStabilityPool(BTCAddress),
			txHash: txReceiptProxyBTC.transactionHash,
		}
	}
}

async function addGOHMCollaterals() {
	const OHMAddress = !config.IsMainnet
		? await mdh.deployMockERC20Contract(deploymentState, "gOHM")
		: config.externalAddrs.GOHM

	if (!OHMAddress || OHMAddress == "") throw "CANNOT FIND THE renBTC Address"

	if (
		(await vestaCore.stabilityPoolManager.unsafeGetAssetStabilityPool(OHMAddress)) ==
		ZERO_ADDRESS
	) {
		console.log("Creating Collateral - OHM")
		let txReceiptProxyOHM

		txReceiptProxyOHM = await mdh.sendAndWaitForTransaction(
			vestaCore.adminContract.addNewCollateral(
				OHMAddress,
				vestaCore.stabilityPoolV1.address,
				config.externalAddrs.CHAINLINK_OHM_PROXY,
				config.IsMainnet ? config.externalAddrs.CHAINLINK_OHM_INDEX_PROXY : ZERO_ADDRESS,
				dec(30_000, 18),
				toBN(dec(30_000, 18)).div(toBN(4)),
				config.REDEMPTION_SAFETY
			)
		)

		deploymentState["ProxyStabilityPoolOHM"] = {
			address: await vestaCore.stabilityPoolManager.getAssetStabilityPool(OHMAddress),
			txHash: txReceiptProxyOHM.transactionHash,
		}
		//Configure Collateral;
		await mdh.sendAndWaitForTransaction(
			vestaCore.vestaParameters.setMCR(OHMAddress, config.gOHMParameters.MCR)
		)
		await mdh.sendAndWaitForTransaction(
			vestaCore.vestaParameters.setCCR(OHMAddress, config.gOHMParameters.CCR)
		)
		await mdh.sendAndWaitForTransaction(
			vestaCore.vestaParameters.setPercentDivisor(
				OHMAddress,
				config.gOHMParameters.PERCENT_DIVISOR
			)
		)
		await mdh.sendAndWaitForTransaction(
			vestaCore.vestaParameters.setBorrowingFeeFloor(
				OHMAddress,
				config.gOHMParameters.BORROWING_FEE_FLOOR
			)
		)
	}
}

async function giveContractsOwnerships() {
	await transferOwnership(vestaCore.adminContract, ADMIN_WALLET)
	await transferOwnership(vestaCore.priceFeed, ADMIN_WALLET)
	await transferOwnership(vestaCore.vestaParameters, ADMIN_WALLET)
	await transferOwnership(vestaCore.stabilityPoolManager, ADMIN_WALLET)
	await transferOwnership(vestaCore.uToken, ADMIN_WALLET)
	await transferOwnership(YOUContracts.YOUStaking, ADMIN_WALLET)

	await transferOwnership(vestaCore.lockedYou, TREASURY_WALLET)
	await transferOwnership(YOUContracts.communityIssuance, TREASURY_WALLET)
}

async function transferOwnership(contract, newOwner) {
	console.log("Transfering Ownership of", contract.address)

	if (!newOwner) throw "Transfering ownership to null address"

	if ((await contract.owner()) != newOwner) await contract.transferOwnership(newOwner)

	console.log("Transfered Ownership of", contract.address)
}

module.exports = {
	mainnetDeploy,
}

const fs = require("fs")

const ZERO_ADDRESS = "0x" + "0".repeat(40)
const maxBytes32 = "0x" + "f".repeat(64)

class MainnetDeploymentHelper {
	constructor(configParams, deployerWallet) {
		this.configParams = configParams
		this.deployerWallet = deployerWallet
		this.hre = require("hardhat")
	}

	loadPreviousDeployment() {
		let previousDeployment = {}
		if (fs.existsSync(this.configParams.OUTPUT_FILE)) {
			console.log(`Loading previous deployment...`)
			previousDeployment = require("../" + this.configParams.OUTPUT_FILE)
		}

		return previousDeployment
	}

	saveDeployment(deploymentState) {
		const deploymentStateJSON = JSON.stringify(deploymentState, null, 2)
		fs.writeFileSync(this.configParams.OUTPUT_FILE, deploymentStateJSON)
	}
	// --- Deployer methods ---

	async getFactory(name) {
		const factory = await ethers.getContractFactory(name, this.deployerWallet)
		return factory
	}

	async sendAndWaitForTransaction(txPromise) {
		const tx = await txPromise
		const minedTx = await ethers.provider.waitForTransaction(
			tx.hash,
			this.configParams.TX_CONFIRMATIONS
		)

		if (!minedTx.status) {
			throw ("Transaction Failed", txPromise)
		}

		return minedTx
	}

	async loadOrDeploy(factory, name, deploymentState, proxy, params = []) {
		try {
			if (deploymentState[name] && deploymentState[name].address) {
				console.log(
					`Using previously deployed ${name} contract at address ${deploymentState[name].address}`
				)
				return await factory.attach(deploymentState[name].address)
			}

			const contract = proxy
				? await upgrades.deployProxy(factory)
				: await factory.deploy(...params)

			await this.deployerWallet.provider.waitForTransaction(
				contract.deployTransaction.hash,
				this.configParams.TX_CONFIRMATIONS
			)

			deploymentState[name] = {
				address: contract.address,
				txHash: contract.deployTransaction.hash,
			}

			this.saveDeployment(deploymentState)

			return contract
		} catch (err) {
			console.log({ err })
		}
	}

	async deployMockERC20Contract(deploymentState, name, decimals = 18) {
		const ERC20MockFactory = await this.getFactory("ERC20Mock")
		const erc20Mock = await this.loadOrDeploy(ERC20MockFactory, name, deploymentState, false, [
			name,
			name,
			decimals,
		])

		await erc20Mock.mint(this.deployerWallet.address, "1000".concat("0".repeat(decimals)))

		return erc20Mock.address
	}

	async deployPartially(treasurySigAddress, deploymentState) {
		const YOUTokenFactory = await this.getFactory("YOUToken")
		const lockedYouFactory = await this.getFactory("LockedYOU")

		const lockedYou = await this.loadOrDeploy(lockedYouFactory, "lockedYou", deploymentState)

		// Deploy YOU Token, passing Community Issuance and Factory addresses to the constructor
		const YOUToken = await this.loadOrDeploy(
			YOUTokenFactory,
			"YOUToken",
			deploymentState,
			false,
			[treasurySigAddress]
		)

		if (!this.configParams.ETHERSCAN_BASE_URL) {
			console.log("No Etherscan Url defined, skipping verification")
		} else {
			await this.verifyContract("lockedYou", deploymentState, [treasurySigAddress])
			await this.verifyContract("YOUToken", deploymentState, [treasurySigAddress])
		}

		;(await this.isOwnershipRenounced(lockedYou)) ||
			(await this.sendAndWaitForTransaction(
				lockedYou.setAddresses(YOUToken.address, { gasPrice: this.configParams.GAS_PRICE })
			))

		const partialContracts = {
			lockedYou,
			YOUToken,
		}

		return partialContracts
	}

	async deployLiquityCoreMainnet(tellorMasterAddr, deploymentState, multisig) {
		// Get contract factories
		const priceFeedFactory = await this.getFactory("PriceFeed")
		const sortedTrovesFactory = await this.getFactory("SortedTroves")
		const troveManagerFactory = await this.getFactory("TroveManager")
		const redemptionManagerFactory = await this.getFactory("RedemptionManager")
		const activePoolFactory = await this.getFactory("ActivePool")
		const stabilityPoolFactory = await this.getFactory("StabilityPool")
		const StabilityPoolManagerFactory = await this.getFactory("StabilityPoolManager")
		const gasPoolFactory = await this.getFactory("GasPool")
		const defaultPoolFactory = await this.getFactory("DefaultPool")
		const collSurplusPoolFactory = await this.getFactory("CollSurplusPool")
		const borrowerOperationsFactory = await this.getFactory("BorrowerOperations")
		const hintHelpersFactory = await this.getFactory("HintHelpers")
		const UTokenFactory = await this.getFactory("UToken")
		const vaultParametersFactory = await this.getFactory("VestaParameters")
		const lockedYouFactory = await this.getFactory("LockedYOU")
		const adminContractFactory = await this.getFactory("AdminContract")
		const tellorCallerFactory = await this.getFactory("TellorCaller")

		// Deploy txs

		//// USE PROXY
		const priceFeed = await this.loadOrDeploy(
			priceFeedFactory,
			"priceFeed",
			deploymentState,
			true
		)
		const sortedTroves = await this.loadOrDeploy(
			sortedTrovesFactory,
			"sortedTroves",
			deploymentState,
			true
		)
		const troveManager = await this.loadOrDeploy(
			troveManagerFactory,
			"troveManager",
			deploymentState,
			true
		)
		const redemptionManager = await this.loadOrDeploy(
			redemptionManagerFactory,
			"redemptionManager",
			deploymentState,
			true
		)
		const activePool = await this.loadOrDeploy(
			activePoolFactory,
			"activePool",
			deploymentState,
			true
		)
		const stabilityPoolManager = await this.loadOrDeploy(
			StabilityPoolManagerFactory,
			"stabilityPoolManager",
			deploymentState,
			true
		)
		const defaultPool = await this.loadOrDeploy(
			defaultPoolFactory,
			"defaultPool",
			deploymentState,
			true
		)
		const collSurplusPool = await this.loadOrDeploy(
			collSurplusPoolFactory,
			"collSurplusPool",
			deploymentState,
			true
		)
		const borrowerOperations = await this.loadOrDeploy(
			borrowerOperationsFactory,
			"borrowerOperations",
			deploymentState,
			true
		)
		const hintHelpers = await this.loadOrDeploy(
			hintHelpersFactory,
			"hintHelpers",
			deploymentState,
			true
		)
		const vestaParameters = await this.loadOrDeploy(
			vaultParametersFactory,
			"vestaParameters",
			deploymentState,
			true
		)

		//// NO PROXY
		const stabilityPoolV1 = await this.loadOrDeploy(
			stabilityPoolFactory,
			"stabilityPoolV1",
			deploymentState
		)
		const gasPool = await this.loadOrDeploy(gasPoolFactory, "gasPool", deploymentState)
		const lockedYou = await this.loadOrDeploy(lockedYouFactory, "lockedYou", deploymentState)
		const adminContract = await this.loadOrDeploy(
			adminContractFactory,
			"adminContract",
			deploymentState
		)
		const tellorCaller = await this.loadOrDeploy(
			tellorCallerFactory,
			"tellorCaller",
			deploymentState,
			false,
			[tellorMasterAddr]
		)

		const UTokenParams = [
			troveManager?.address,
			redemptionManager?.address,
			stabilityPoolManager.address,
			borrowerOperations.address,
		]
		const uToken = await this.loadOrDeploy(
			UTokenFactory,
			"UToken",
			deploymentState,
			false,
			UTokenParams
		)

		if (!this.configParams.ETHERSCAN_BASE_URL) {
			console.log("No Etherscan Url defined, skipping verification")
		} else {
			await this.verifyContract("priceFeed", deploymentState)
			await this.verifyContract("sortedTroves", deploymentState)
			await this.verifyContract("troveManager", deploymentState)
			await this.verifyContract("redemptionManager", deploymentState)
			await this.verifyContract("activePool", deploymentState)
			await this.verifyContract("stabilityPoolV1", deploymentState)
			await this.verifyContract("stabilityPoolManager", deploymentState)
			await this.verifyContract("gasPool", deploymentState)
			await this.verifyContract("defaultPool", deploymentState)
			await this.verifyContract("collSurplusPool", deploymentState)
			await this.verifyContract("borrowerOperations", deploymentState)
			await this.verifyContract("hintHelpers", deploymentState)
			await this.verifyContract("UToken", deploymentState, UTokenParams)
			await this.verifyContract("vestaParameters", deploymentState)
			await this.verifyContract("lockedYou", deploymentState)
			await this.verifyContract("adminContract", deploymentState)
			await this.verifyContract("tellorCaller", deploymentState, [tellorMasterAddr])
		}

		const coreContracts = {
			priceFeed,
			uToken,
			sortedTroves,
			troveManager,
			redemptionManager,
			activePool,
			stabilityPoolManager,
			stabilityPoolV1,
			adminContract,
			gasPool,
			defaultPool,
			collSurplusPool,
			borrowerOperations,
			hintHelpers,
			vestaParameters,
			lockedYou,
			tellorCaller,
		}
		return coreContracts
	}

	async deployYOUContractsMainnet(treasurySigAddress, deploymentState) {
		const YOUStakingFactory = await this.getFactory("YOUStaking")
		const communityIssuanceFactory = await this.getFactory("CommunityIssuance")
		const YOUTokenFactory = await this.getFactory("YOUToken")

		const YOUStaking = await this.loadOrDeploy(
			YOUStakingFactory,
			"YOUStaking",
			deploymentState,
			true
		)
		const communityIssuance = await this.loadOrDeploy(
			communityIssuanceFactory,
			"communityIssuance",
			deploymentState,
			true
		)

		// Deploy YOU Token, passing Community Issuance and Factory addresses to the constructor
		const YOUToken = await this.loadOrDeploy(
			YOUTokenFactory,
			"YOUToken",
			deploymentState,
			false,
			[treasurySigAddress]
		)

		if (!this.configParams.ETHERSCAN_BASE_URL) {
			console.log("No Etherscan Url defined, skipping verification")
		} else {
			await this.verifyContract("YOUStaking", deploymentState)
			await this.verifyContract("communityIssuance", deploymentState)
			await this.verifyContract("YOUToken", deploymentState, [treasurySigAddress])
		}

		const YOUContracts = {
			YOUStaking,
			communityIssuance,
			YOUToken,
		}
		return YOUContracts
	}

	async deployMultiTroveGetterMainnet(liquityCore, deploymentState, wstEthAddress) {
		const multiTroveGetterFactory = await this.getFactory("MultiTroveGetter")
		const multiTroveGetterParams = [
			liquityCore.troveManager.address,
			liquityCore.sortedTroves.address,
			wstEthAddress,
		]
		const multiTroveGetter = await this.loadOrDeploy(
			multiTroveGetterFactory,
			"multiTroveGetter",
			deploymentState,
			false,
			multiTroveGetterParams
		)

		if (!this.configParams.ETHERSCAN_BASE_URL) {
			console.log("No Etherscan Url defined, skipping verification")
		} else {
			await this.verifyContract("multiTroveGetter", deploymentState, multiTroveGetterParams)
		}

		return multiTroveGetter
	}
	// --- Connector methods ---

	async isOwnershipRenounced(contract) {
		const isInitialized = await contract.isInitialized()
		console.log("%s Is Initalized : %s", await contract.NAME(), isInitialized)
		return isInitialized
	}
	// Connect contracts to their dependencies
	async connectCoreContractsMainnet(
		contracts,
		YOUContracts,
		chainlinkFlagAddress,
		wstEthAddress
	) {
		const gasPrice = this.configParams.GAS_PRICE

		;(await this.isOwnershipRenounced(contracts.priceFeed)) ||
			(await this.sendAndWaitForTransaction(
				contracts.priceFeed.setAddresses(
					chainlinkFlagAddress,
					contracts.adminContract.address,
					contracts.tellorCaller.address,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.sortedTroves)) ||
			(await this.sendAndWaitForTransaction(
				contracts.sortedTroves.setParams(
					contracts.troveManager.address,
					contracts.borrowerOperations.address,
					wstEthAddress,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.lockedYou)) ||
			(await this.sendAndWaitForTransaction(
				contracts.lockedYou.setAddresses(YOUContracts.YOUToken.address, { gasPrice })
			))
		;(await this.isOwnershipRenounced(contracts.vestaParameters)) ||
			(await this.sendAndWaitForTransaction(
				contracts.vestaParameters.setAddresses(
					contracts.activePool.address,
					contracts.defaultPool.address,
					contracts.priceFeed.address,
					contracts.adminContract.address,
					wstEthAddress,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.redemptionManager)) ||
			(await this.sendAndWaitForTransaction(
				contracts.redemptionManager.setAddresses(contracts.troveManager.address, { gasPrice })
			))
		;(await this.isOwnershipRenounced(contracts.troveManager)) ||
			(await this.sendAndWaitForTransaction(
				contracts.troveManager.setAddresses(
					contracts.borrowerOperations.address,
					contracts.stabilityPoolManager.address,
					contracts.gasPool.address,
					contracts.collSurplusPool.address,
					contracts.uToken.address,
					contracts.sortedTroves.address,
					YOUContracts.YOUStaking.address,
					contracts.vestaParameters.address,
					{ gasPrice }
				)
			)) ||
			(await this.sendAndWaitForTransaction(
				contracts.troveManager.setRedemptionManager(contracts.redemptionManager.address, {
					gasPrice,
				})
			))
		;(await this.isOwnershipRenounced(contracts.borrowerOperations)) ||
			(await this.sendAndWaitForTransaction(
				contracts.borrowerOperations.setAddresses(
					contracts.troveManager.address,
					contracts.stabilityPoolManager.address,
					contracts.gasPool.address,
					contracts.collSurplusPool.address,
					contracts.sortedTroves.address,
					contracts.uToken.address,
					YOUContracts.YOUStaking.address,
					contracts.vestaParameters.address,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.stabilityPoolManager)) ||
			(await this.sendAndWaitForTransaction(
				contracts.stabilityPoolManager.setAddresses(
					contracts.adminContract.address,
					wstEthAddress,
					{
						gasPrice,
					}
				)
			))
		;(await this.isOwnershipRenounced(contracts.activePool)) ||
			(await this.sendAndWaitForTransaction(
				contracts.activePool.setAddresses(
					contracts.borrowerOperations.address,
					contracts.troveManager.address,
					contracts.stabilityPoolManager.address,
					contracts.defaultPool.address,
					contracts.collSurplusPool.address,
					contracts.redemptionManager.address,
					wstEthAddress,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.defaultPool)) ||
			(await this.sendAndWaitForTransaction(
				contracts.defaultPool.setAddresses(
					contracts.troveManager.address,
					contracts.redemptionManager.address,
					contracts.activePool.address,
					wstEthAddress,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.collSurplusPool)) ||
			(await this.sendAndWaitForTransaction(
				contracts.collSurplusPool.setAddresses(
					contracts.borrowerOperations.address,
					contracts.troveManager.address,
					contracts.redemptionManager.address,
					contracts.activePool.address,
					wstEthAddress,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(contracts.adminContract)) ||
			(await this.sendAndWaitForTransaction(
				contracts.adminContract.setAddresses(
					contracts.vestaParameters.address,
					contracts.stabilityPoolManager.address,
					contracts.borrowerOperations.address,
					contracts.troveManager.address,
					contracts.uToken.address,
					contracts.sortedTroves.address,
					YOUContracts.communityIssuance.address,
					wstEthAddress,
					{ gasPrice }
				)
			))

		// set contracts in HintHelpers
		;(await this.isOwnershipRenounced(contracts.hintHelpers)) ||
			(await this.sendAndWaitForTransaction(
				contracts.hintHelpers.setAddresses(
					contracts.sortedTroves.address,
					contracts.troveManager.address,
					contracts.vestaParameters.address,
					{ gasPrice }
				)
			))
	}

	async connectYOUContractsToCoreMainnet(YOUContracts, coreContracts, treasuryAddress) {
		const gasPrice = this.configParams.GAS_PRICE
		;(await this.isOwnershipRenounced(YOUContracts.YOUStaking)) ||
			(await this.sendAndWaitForTransaction(
				YOUContracts.YOUStaking.setAddresses(
					YOUContracts.YOUToken.address,
					coreContracts.uToken.address,
					coreContracts.troveManager.address,
					coreContracts.borrowerOperations.address,
					coreContracts.activePool.address,
					treasuryAddress,
					{ gasPrice }
				)
			))
		;(await this.isOwnershipRenounced(YOUContracts.communityIssuance)) ||
			(await this.sendAndWaitForTransaction(
				YOUContracts.communityIssuance.setAddresses(
					YOUContracts.YOUToken.address,
					coreContracts.stabilityPoolManager.address,
					coreContracts.adminContract.address,
					{ gasPrice }
				)
			))
	}

	// --- Verify on Ethrescan ---
	async verifyContract(name, deploymentState, constructorArguments = []) {
		if (!deploymentState[name] || !deploymentState[name].address) {
			console.error(`  --> No deployment state for contract ${name}!!`)
			return
		}
		if (deploymentState[name].verification) {
			console.log(`Contract ${name} already verified`)
			return
		}

		try {
			await this.hre.run("verify:verify", {
				address: deploymentState[name].address,
				constructorArguments,
			})
		} catch (error) {
			// if it was already verified, it’s like a success, so let’s move forward and save it
			if (error.name != "NomicLabsHardhatPluginError") {
				console.error(`Error verifying: ${error.name}`)
				console.error(error)
				return
			}
		}

		deploymentState[
			name
		].verification = `${this.configParams.ETHERSCAN_BASE_URL}/${deploymentState[name].address}#code`

		this.saveDeployment(deploymentState)
	}

	// --- Helpers ---

	async logContractObjects(contracts) {
		console.log(`Contract objects addresses:`)
		for (const contractName of Object.keys(contracts)) {
			console.log(`${contractName}: ${contracts[contractName].address}`)
		}
	}
}

module.exports = MainnetDeploymentHelper

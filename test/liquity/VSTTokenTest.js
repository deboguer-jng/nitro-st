const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const StabilityPool = artifacts.require("./StabilityPool.sol")

const { expectRevert } = require("@openzeppelin/test-helpers")

const { keccak256 } = require("@ethersproject/keccak256")
const { defaultAbiCoder } = require("@ethersproject/abi")
const { toUtf8Bytes } = require("@ethersproject/strings")
const { pack } = require("@ethersproject/solidity")
const { hexlify } = require("@ethersproject/bytes")
const { ecsign } = require("ethereumjs-util")

const { toBN, assertRevert, assertAssert, dec, ZERO_ADDRESS } = testHelpers.TestHelper

const sign = (digest, privateKey) => {
	return ecsign(Buffer.from(digest.slice(2), "hex"), Buffer.from(privateKey.slice(2), "hex"))
}

const PERMIT_TYPEHASH = keccak256(
	toUtf8Bytes(
		"Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
	)
)

// Returns the EIP712 hash which should be signed by the user
// in order to make a call to `permit`
const getPermitDigest = (domain, owner, spender, value, nonce, deadline) => {
	return keccak256(
		pack(
			["bytes1", "bytes1", "bytes32", "bytes32"],
			[
				"0x19",
				"0x01",
				domain,
				keccak256(
					defaultAbiCoder.encode(
						["bytes32", "address", "address", "uint256", "uint256", "uint256"],
						[PERMIT_TYPEHASH, owner, spender, value, nonce, deadline]
					)
				),
			]
		)
	)
}

contract("UToken", async accounts => {
	const [owner, alice, bob, carol, dennis] = accounts

	const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

	// the second account our hardhatenv creates (for Alice)
	// from https://github.com/liquity/dev/blob/main/packages/contracts/hardhatAccountsList2k.js#L3
	const alicePrivateKey = "0xeaa445c85f7b438dEd6e831d06a4eD0CEBDc2f8527f84Fcda6EBB5fCfAd4C0e9"

	let chainId
	let UTokenOriginal
	let UTokenTester
	let stabilityPool
	let troveManager
	let borrowerOperations
	let erc20

	let tokenName
	let tokenVersion

	const testCorpus = ({ withProxy = false }) => {
		beforeEach(async () => {
			const contracts = await deploymentHelper.deployTesterContractsHardhat()
			const YOUContracts = await deploymentHelper.deployYOUContractsHardhat(accounts[0])

			await deploymentHelper.connectCoreContracts(contracts, YOUContracts)
			await deploymentHelper.connectYOUContractsToCore(YOUContracts, contracts)

			erc20 = contracts.erc20
			stabilityPool = await StabilityPool.at(
				await contracts.stabilityPoolManager.getAssetStabilityPool(ZERO_ADDRESS)
			)
			stabilityPoolERC20 = await StabilityPool.at(
				await contracts.stabilityPoolManager.getAssetStabilityPool(erc20.address)
			)

			UTokenOriginal = contracts.vstToken
			if (withProxy) {
				const users = [alice, bob, carol, dennis]
				await deploymentHelper.deployProxyScripts(contracts, YOUContracts, owner, users)
			}

			UTokenTester = contracts.vstToken
			// for some reason this doesn’t work with coverage network
			//chainId = await web3.eth.getChainId()
			chainId = await UTokenOriginal.getChainId()

			borrowerOperations = contracts.borrowerOperations

			tokenVersion = 1
			tokenName = await UTokenOriginal.name()

			// mint some tokens
			if (withProxy) {
				await UTokenOriginal.unprotectedMint(UTokenTester.getProxyAddressFromUser(alice), 150)
				await UTokenOriginal.unprotectedMint(UTokenTester.getProxyAddressFromUser(bob), 100)
				await UTokenOriginal.unprotectedMint(UTokenTester.getProxyAddressFromUser(carol), 50)
			} else {
				await UTokenOriginal.unprotectedMint(alice, 150)
				await UTokenOriginal.unprotectedMint(bob, 100)
				await UTokenOriginal.unprotectedMint(carol, 50)
			}
		})

		it("balanceOf(): gets the balance of the account", async () => {
			const aliceBalance = (await UTokenTester.balanceOf(alice)).toNumber()
			const bobBalance = (await UTokenTester.balanceOf(bob)).toNumber()
			const carolBalance = (await UTokenTester.balanceOf(carol)).toNumber()

			assert.equal(aliceBalance, 150)
			assert.equal(bobBalance, 100)
			assert.equal(carolBalance, 50)
		})

		it("totalSupply(): gets the total supply", async () => {
			const total = (await UTokenTester.totalSupply()).toString()
			assert.equal(total, "300") // 300
		})

		it("name(): returns the token's name", async () => {
			const name = await UTokenTester.name()
			assert.equal(name, "Vesta Stable")
		})

		it("symbol(): returns the token's symbol", async () => {
			const symbol = await UTokenTester.symbol()
			assert.equal(symbol, "U")
		})

		it("decimal(): returns the number of decimal digits used", async () => {
			const decimals = await UTokenTester.decimals()
			assert.equal(decimals, "18")
		})

		it("allowance(): returns an account's spending allowance for another account's balance", async () => {
			await UTokenTester.approve(alice, 100, { from: bob })

			const allowance_A = await UTokenTester.allowance(bob, alice)
			const allowance_D = await UTokenTester.allowance(bob, dennis)

			assert.equal(allowance_A, 100)
			assert.equal(allowance_D, "0")
		})

		it("approve(): approves an account to spend the specified amount", async () => {
			const allowance_A_before = await UTokenTester.allowance(bob, alice)
			assert.equal(allowance_A_before, "0")

			await UTokenTester.approve(alice, 100, { from: bob })

			const allowance_A_after = await UTokenTester.allowance(bob, alice)
			assert.equal(allowance_A_after, 100)
		})

		if (!withProxy) {
			it("approve(): reverts when spender param is address(0)", async () => {
				const txPromise = UTokenTester.approve(ZERO_ADDRESS, 100, { from: bob })
				await assertAssert(txPromise)
			})

			it("approve(): reverts when owner param is address(0)", async () => {
				const txPromise = UTokenTester.callInternalApprove(
					ZERO_ADDRESS,
					alice,
					dec(1000, 18),
					{ from: bob }
				)
				await assertAssert(txPromise)
			})
		}

		it("transferFrom(): successfully transfers from an account which is it approved to transfer from", async () => {
			const allowance_A_0 = await UTokenTester.allowance(bob, alice)
			assert.equal(allowance_A_0, "0")

			await UTokenTester.approve(alice, 50, { from: bob })

			// Check A's allowance of Bob's funds has increased
			const allowance_A_1 = await UTokenTester.allowance(bob, alice)
			assert.equal(allowance_A_1, 50)

			assert.equal(await UTokenTester.balanceOf(carol), 50)

			// Alice transfers from bob to Carol, using up her allowance
			await UTokenTester.transferFrom(bob, carol, 50, { from: alice })
			assert.equal(await UTokenTester.balanceOf(carol), 100)

			// Check A's allowance of Bob's funds has decreased
			const allowance_A_2 = await UTokenTester.allowance(bob, alice)
			assert.equal(allowance_A_2, "0")

			// Check bob's balance has decreased
			assert.equal(await UTokenTester.balanceOf(bob), 50)

			// Alice tries to transfer more tokens from bob's account to carol than she's allowed
			await expectRevert.unspecified(
				UTokenTester.transferFrom(bob, carol, 50, { from: alice })
			)
		})

		it("transfer(): increases the recipient's balance by the correct amount", async () => {
			assert.equal(await UTokenTester.balanceOf(alice), 150)

			await UTokenTester.transfer(alice, 37, { from: bob })

			assert.equal(await UTokenTester.balanceOf(alice), 187)
		})

		it("transfer(): reverts if amount exceeds sender's balance", async () => {
			assert.equal(await UTokenTester.balanceOf(bob), 100)
			await expectRevert.unspecified(UTokenTester.transfer(alice, 101, { from: bob }))
		})

		it("increaseAllowance(): increases an account's allowance by the correct amount", async () => {
			const allowance_A_Before = await UTokenTester.allowance(bob, alice)
			assert.equal(allowance_A_Before, "0")

			await UTokenTester.increaseAllowance(alice, 100, { from: bob })

			const allowance_A_After = await UTokenTester.allowance(bob, alice)
			assert.equal(allowance_A_After, 100)
		})

		if (!withProxy) {
			it("mint(): issues correct amount of tokens to the given address", async () => {
				const alice_balanceBefore = await UTokenTester.balanceOf(alice)
				assert.equal(alice_balanceBefore, 150)

				await UTokenTester.unprotectedMint(alice, 100)

				const alice_BalanceAfter = await UTokenTester.balanceOf(alice)
				assert.equal(alice_BalanceAfter, 250)
			})

			it("burn(): burns correct amount of tokens from the given address", async () => {
				const alice_balanceBefore = await UTokenTester.balanceOf(alice)
				assert.equal(alice_balanceBefore, 150)

				await UTokenTester.unprotectedBurn(alice, 70)

				const alice_BalanceAfter = await UTokenTester.balanceOf(alice)
				assert.equal(alice_BalanceAfter, 80)
			})

			// TODO: Rewrite this test - it should check the actual UTokenTester's balance.
			it("sendToPool(): changes balances of Stability pool and user by the correct amounts", async () => {
				const stabilityPool_BalanceBefore = await UTokenTester.balanceOf(stabilityPool.address)
				const bob_BalanceBefore = await UTokenTester.balanceOf(bob)
				assert.equal(stabilityPool_BalanceBefore, 0)
				assert.equal(bob_BalanceBefore, 100)

				await UTokenTester.unprotectedSendToPool(bob, stabilityPool.address, 75)

				const stabilityPool_BalanceAfter = await UTokenTester.balanceOf(stabilityPool.address)
				const bob_BalanceAfter = await UTokenTester.balanceOf(bob)
				assert.equal(stabilityPool_BalanceAfter, 75)
				assert.equal(bob_BalanceAfter, 25)
			})

			it("returnFromPool(): changes balances of Stability pool and user by the correct amounts", async () => {
				/// --- SETUP --- give pool 100 U
				await UTokenTester.unprotectedMint(stabilityPool.address, 100)

				/// --- TEST ---
				const stabilityPool_BalanceBefore = await UTokenTester.balanceOf(stabilityPool.address)
				const bob_BalanceBefore = await UTokenTester.balanceOf(bob)
				assert.equal(stabilityPool_BalanceBefore, 100)
				assert.equal(bob_BalanceBefore, 100)

				await UTokenTester.unprotectedReturnFromPool(stabilityPool.address, bob, 75)

				const stabilityPool_BalanceAfter = await UTokenTester.balanceOf(stabilityPool.address)
				const bob_BalanceAfter = await UTokenTester.balanceOf(bob)
				assert.equal(stabilityPool_BalanceAfter, 25)
				assert.equal(bob_BalanceAfter, 175)
			})
		}

		it("decreaseAllowance(): decreases allowance by the expected amount", async () => {
			await UTokenTester.approve(bob, dec(3, 18), { from: alice })
			assert.equal((await UTokenTester.allowance(alice, bob)).toString(), dec(3, 18))
			await UTokenTester.decreaseAllowance(bob, dec(1, 18), { from: alice })
			assert.equal((await UTokenTester.allowance(alice, bob)).toString(), dec(2, 18))
		})

		it("decreaseAllowance(): fails trying to decrease more than previously allowed", async () => {
			await UTokenTester.approve(bob, dec(3, 18), { from: alice })
			assert.equal((await UTokenTester.allowance(alice, bob)).toString(), dec(3, 18))
			await expectRevert.unspecified(
				UTokenTester.decreaseAllowance(bob, dec(4, 18), { from: alice })
			)
			assert.equal((await UTokenTester.allowance(alice, bob)).toString(), dec(3, 18))
		})

		// EIP2612 tests

		if (!withProxy) {
			it("Initializes PERMIT_TYPEHASH correctly", async () => {
				assert.equal(await UTokenTester.PERMIT_TYPEHASH(), PERMIT_TYPEHASH)
			})

			it("Initial nonce for a given address is 0", async function () {
				assert.equal(toBN(await UTokenTester.nonces(alice)).toString(), "0")
			})

			// Create the approval tx data
			const approve = {
				owner: alice,
				spender: bob,
				value: 1,
			}

			const buildPermitTx = async deadline => {
				const nonce = (await UTokenTester.nonces(approve.owner)).toString()

				// Get the EIP712 digest
				const digest = getPermitDigest(
					await UTokenTester.DOMAIN_SEPARATOR(),
					approve.owner,
					approve.spender,
					approve.value,
					nonce,
					deadline
				)

				const { v, r, s } = sign(digest, alicePrivateKey)

				const tx = UTokenTester.permit(
					approve.owner,
					approve.spender,
					approve.value,
					deadline,
					v,
					hexlify(r),
					hexlify(s)
				)

				return { v, r, s, tx }
			}

			it("permits and emits an Approval event (replay protected)", async () => {
				const deadline = 100000000000000

				// Approve it
				const { v, r, s, tx } = await buildPermitTx(deadline)
				const receipt = await tx
				const event = receipt.logs[0]

				// Check that approval was successful
				assert.equal(event.event, "Approval")
				assert.equal(await UTokenTester.nonces(approve.owner), 1)
				assert.equal(
					await UTokenTester.allowance(approve.owner, approve.spender),
					approve.value
				)

				// Check that we can not use re-use the same signature, since the user's nonce has been incremented (replay protection)
				await assertRevert(
					UTokenTester.permit(
						approve.owner,
						approve.spender,
						approve.value,
						deadline,
						v,
						r,
						s
					),
					"U: invalid signature"
				)

				// Check that the zero address fails
				await assertAssert(
					UTokenTester.permit(
						"0x0000000000000000000000000000000000000000",
						approve.spender,
						approve.value,
						deadline,
						"0x99",
						r,
						s
					)
				)
			})

			it("permits(): fails with expired deadline", async () => {
				const deadline = 1

				const { v, r, s, tx } = await buildPermitTx(deadline)
				await assertRevert(tx, "U: expired deadline")
			})

			it("permits(): fails with the wrong signature", async () => {
				const deadline = 100000000000000

				const { v, r, s } = await buildPermitTx(deadline)

				const tx = UTokenTester.permit(
					carol,
					approve.spender,
					approve.value,
					deadline,
					v,
					hexlify(r),
					hexlify(s)
				)

				await assertRevert(tx, "U: invalid signature")
			})
		}
	}
	describe("Basic token functions, without Proxy", async () => {
		testCorpus({ withProxy: false })
	})

	describe("Basic token functions, with Proxy", async () => {
		testCorpus({ withProxy: true })
	})
})

contract("Reset chain state", async accounts => {})

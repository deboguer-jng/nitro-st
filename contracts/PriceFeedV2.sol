// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "./Interfaces/IPriceFeed.sol";
import "@chainlink/contracts/src/v0.8/interfaces/FlagsInterface.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./Dependencies/CheckContract.sol";
import "./Dependencies/BaseMath.sol";
import "./Dependencies/VestaMath.sol";
import "./Interfaces/ITellorCaller.sol";

contract PriceFeedV2 is OwnableUpgradeable, CheckContract, BaseMath, IPriceFeed {
	using SafeMathUpgradeable for uint256;

	string public constant NAME = "PriceFeedV2";
	address public constant FLAG_ARBITRUM_SEQ_OFFLINE =
		0xa438451D6458044c3c8CD2f6f31c91ac882A6d91;

	FlagsInterface public chainlinkFlags;
	ITellorCaller public tellorCaller;

	// Use to convert a price answer to an 18-digit precision uint
	uint256 public constant TARGET_DIGITS = 18;
	uint256 public constant TELLOR_DIGITS = 6;

	uint256 public constant TIMEOUT = 4 hours;

	// Maximum deviation allowed between two consecutive Chainlink oracle prices. 18-digit precision.
	uint256 public constant MAX_PRICE_DEVIATION_FROM_PREVIOUS_ROUND = 5e17; // 50%
	uint256 public constant MAX_PRICE_DIFFERENCE_BETWEEN_ORACLES = 5e16; // 5%

	bool public isInitialized;

	address public adminContract;

	IPriceFeed.Status public status;
	mapping(address => RegisterOracle) public registeredOracles;
	mapping(address => uint256) public lastGoodPrice;

	modifier isController() {
		require(msg.sender == owner() || msg.sender == adminContract, "Invalid Permission");
		_;
	}

	function setAddresses(
		address _chainlinkFlag,
		address _adminContract,
		address _tellorCaller
	) external initializer {
		require(!isInitialized);
		checkContract(_chainlinkFlag);
		checkContract(_adminContract);
		checkContract(_tellorCaller);
		isInitialized = true;

		__Ownable_init();

		adminContract = _adminContract;
		chainlinkFlags = FlagsInterface(_chainlinkFlag);
		tellorCaller = ITellorCaller(_tellorCaller);
		status = Status.chainlinkWorking;
	}

	function setAdminContract(address _admin) external onlyOwner {
		require(_admin != address(0));
		adminContract = _admin;
	}

	function addOracle(
		address _token,
		address _chainlinkOracle,
		bytes32 _tellorId
	) external override isController {
		AggregatorV3Interface priceOracle = AggregatorV3Interface(_chainlinkOracle);

		registeredOracles[_token] = RegisterOracle(priceOracle, true, _tellorId);

		(
			ChainlinkResponse memory chainlinkResponse,
			ChainlinkResponse memory prevChainlinkResponse
		) = _getChainlinkResponses(priceOracle);

		require(
			!_chainlinkIsBroken(chainlinkResponse, prevChainlinkResponse) &&
				!_chainlinkIsFrozen(chainlinkResponse),
			"PriceFeed: Chainlink must be working and current"
		);

		_storeChainlinkPrice(_token, chainlinkResponse);

		emit RegisteredNewOracle(_token, _chainlinkOracle, _tellorId);
	}

	function fetchPrice(address _token) external override returns (uint256) {
		RegisterOracle storage oracle = registeredOracles[_token];
		require(oracle.isRegistered, "Oracle is not registered!");

		(
			ChainlinkResponse memory chainlinkResponse,
			ChainlinkResponse memory prevChainlinkResponse
		) = _getChainlinkResponses(oracle.chainLinkOracle);

		TellorResponse memory tellorResponse = _getCurrentTellorResponse(oracle.tellorId);

		uint256 lastTokenGoodPrice = lastGoodPrice[_token];

		// --- CASE 1: System fetched last price from Chainlink  ---
		if (status == Status.chainlinkWorking) {
			// If Chainlink is broken, try Tellor
			if (_chainlinkIsBroken(chainlinkResponse, prevChainlinkResponse)) {
				// If Tellor is broken then both oracles are untrusted, so return the last good price
				if (_tellorIsBroken(tellorResponse)) {
					_changeStatus(Status.bothOraclesUntrusted);
					return lastTokenGoodPrice;
				}
				/*
				 * If Tellor is only frozen but otherwise returning valid data, return the last good price.
				 * Tellor may need to be tipped to return current data.
				 */
				if (_tellorIsFrozen(tellorResponse)) {
					_changeStatus(Status.usingTellorChainlinkUntrusted);
					return lastTokenGoodPrice;
				}

				// If Chainlink is broken and Tellor is working, switch to Tellor and return current Tellor price
				_changeStatus(Status.usingTellorChainlinkUntrusted);
				return _storeTellorPrice(_token, tellorResponse);
			}

			// If Chainlink is frozen, try Tellor
			if (_chainlinkIsFrozen(chainlinkResponse)) {
				// If Tellor is broken too, remember Tellor broke, and return last good price
				if (_tellorIsBroken(tellorResponse)) {
					_changeStatus(Status.usingChainlinkTellorUntrusted);
					return lastTokenGoodPrice;
				}

				// If Tellor is frozen or working, remember Chainlink froze, and switch to Tellor
				_changeStatus(Status.usingTellorChainlinkFrozen);

				if (_tellorIsFrozen(tellorResponse)) {
					return lastTokenGoodPrice;
				}

				// If Tellor is working, use it
				return _storeTellorPrice(_token, tellorResponse);
			}

			// If Chainlink price has changed by > 50% between two consecutive rounds, compare it to Tellor's price
			if (_chainlinkPriceChangeAboveMax(chainlinkResponse, prevChainlinkResponse)) {
				// If Tellor is broken, both oracles are untrusted, and return last good price
				if (_tellorIsBroken(tellorResponse)) {
					_changeStatus(Status.bothOraclesUntrusted);
					return lastTokenGoodPrice;
				}

				// If Tellor is frozen, switch to Tellor and return last good price
				if (_tellorIsFrozen(tellorResponse)) {
					_changeStatus(Status.usingTellorChainlinkUntrusted);
					return lastTokenGoodPrice;
				}

				/*
				 * If Tellor is live and both oracles have a similar price, conclude that Chainlink's large price deviation between
				 * two consecutive rounds was likely a legitmate market price movement, and so continue using Chainlink
				 */
				if (_bothOraclesSimilarPrice(chainlinkResponse, tellorResponse)) {
					return _storeChainlinkPrice(_token, chainlinkResponse);
				}

				// If Tellor is live but the oracles differ too much in price, conclude that Chainlink's initial price deviation was
				// an oracle failure. Switch to Tellor, and use Tellor price
				_changeStatus(Status.usingTellorChainlinkUntrusted);
				return _storeTellorPrice(_token, tellorResponse);
			}

			// If Chainlink is working and Tellor is broken, remember Tellor is broken
			if (_tellorIsBroken(tellorResponse)) {
				_changeStatus(Status.usingChainlinkTellorUntrusted);
			}

			// If Chainlink is working, return Chainlink current price (no status change)
			return _storeChainlinkPrice(_token, chainlinkResponse);
		}

		// --- CASE 2: The system fetched last price from Tellor ---
		if (status == Status.usingTellorChainlinkUntrusted) {
			// If both Tellor and Chainlink are live, unbroken, and reporting similar prices, switch back to Chainlink
			if (
				_bothOraclesLiveAndUnbrokenAndSimilarPrice(
					chainlinkResponse,
					prevChainlinkResponse,
					tellorResponse
				)
			) {
				_changeStatus(Status.chainlinkWorking);
				return _storeChainlinkPrice(_token, chainlinkResponse);
			}

			if (_tellorIsBroken(tellorResponse)) {
				_changeStatus(Status.bothOraclesUntrusted);
				return lastTokenGoodPrice;
			}

			/*
			 * If Tellor is only frozen but otherwise returning valid data, just return the last good price.
			 * Tellor may need to be tipped to return current data.
			 */
			if (_tellorIsFrozen(tellorResponse)) {
				return lastTokenGoodPrice;
			}

			// Otherwise, use Tellor price
			return _storeTellorPrice(_token, tellorResponse);
		}

		// --- CASE 3: Both oracles were untrusted at the last price fetch ---
		if (status == Status.bothOraclesUntrusted) {
			/*
			 * If both oracles are now live, unbroken and similar price, we assume that they are reporting
			 * accurately, and so we switch back to Chainlink.
			 */
			if (
				_bothOraclesLiveAndUnbrokenAndSimilarPrice(
					chainlinkResponse,
					prevChainlinkResponse,
					tellorResponse
				)
			) {
				_changeStatus(Status.chainlinkWorking);
				return _storeChainlinkPrice(_token, chainlinkResponse);
			}

			// Otherwise, return the last good price - both oracles are still untrusted (no status change)
			return lastTokenGoodPrice;
		}

		// --- CASE 4: Using Tellor, and Chainlink is frozen ---
		if (status == Status.usingTellorChainlinkFrozen) {
			if (_chainlinkIsBroken(chainlinkResponse, prevChainlinkResponse)) {
				// If both Oracles are broken, return last good price
				if (_tellorIsBroken(tellorResponse)) {
					_changeStatus(Status.bothOraclesUntrusted);
					return lastTokenGoodPrice;
				}

				// If Chainlink is broken, remember it and switch to using Tellor
				_changeStatus(Status.usingTellorChainlinkUntrusted);

				if (_tellorIsFrozen(tellorResponse)) {
					return lastTokenGoodPrice;
				}

				// If Tellor is working, return Tellor current price
				return _storeTellorPrice(_token, tellorResponse);
			}

			if (_chainlinkIsFrozen(chainlinkResponse)) {
				// if Chainlink is frozen and Tellor is broken, remember Tellor broke, and return last good price
				if (_tellorIsBroken(tellorResponse)) {
					_changeStatus(Status.usingChainlinkTellorUntrusted);
					return lastTokenGoodPrice;
				}

				// If both are frozen, just use lastGoodPrice
				if (_tellorIsFrozen(tellorResponse)) {
					return lastTokenGoodPrice;
				}

				// if Chainlink is frozen and Tellor is working, keep using Tellor (no status change)
				return _storeTellorPrice(_token, tellorResponse);
			}

			// if Chainlink is live and Tellor is broken, remember Tellor broke, and return Chainlink price
			if (_tellorIsBroken(tellorResponse)) {
				_changeStatus(Status.usingChainlinkTellorUntrusted);
				return _storeChainlinkPrice(_token, chainlinkResponse);
			}

			// If Chainlink is live and Tellor is frozen, just use last good price (no status change) since we have no basis for comparison
			if (_tellorIsFrozen(tellorResponse)) {
				return lastTokenGoodPrice;
			}

			// If Chainlink is live and Tellor is working, compare prices. Switch to Chainlink
			// if prices are within 5%, and return Chainlink price.
			if (_bothOraclesSimilarPrice(chainlinkResponse, tellorResponse)) {
				_changeStatus(Status.chainlinkWorking);
				return _storeChainlinkPrice(_token, chainlinkResponse);
			}

			// Otherwise if Chainlink is live but price not within 5% of Tellor, distrust Chainlink, and return Tellor price
			_changeStatus(Status.usingTellorChainlinkUntrusted);
			return _storeTellorPrice(_token, tellorResponse);
		}

		// --- CASE 5: Using Chainlink, Tellor is untrusted ---
		if (status == Status.usingChainlinkTellorUntrusted) {
			// If Chainlink breaks, now both oracles are untrusted
			if (_chainlinkIsBroken(chainlinkResponse, prevChainlinkResponse)) {
				_changeStatus(Status.bothOraclesUntrusted);
				return lastTokenGoodPrice;
			}

			// If Chainlink is frozen, return last good price (no status change)
			if (_chainlinkIsFrozen(chainlinkResponse)) {
				return lastTokenGoodPrice;
			}

			// If Chainlink and Tellor are both live, unbroken and similar price, switch back to chainlinkWorking and return Chainlink price
			if (
				_bothOraclesLiveAndUnbrokenAndSimilarPrice(
					chainlinkResponse,
					prevChainlinkResponse,
					tellorResponse
				)
			) {
				_changeStatus(Status.chainlinkWorking);
				return _storeChainlinkPrice(_token, chainlinkResponse);
			}

			// If Chainlink is live but deviated >50% from it's previous price and Tellor is still untrusted, switch
			// to bothOraclesUntrusted and return last good price
			if (_chainlinkPriceChangeAboveMax(chainlinkResponse, prevChainlinkResponse)) {
				_changeStatus(Status.bothOraclesUntrusted);
				return lastTokenGoodPrice;
			}

			// Otherwise if Chainlink is live and deviated <50% from it's previous price and Tellor is still untrusted,
			// return Chainlink price (no status change)
			return _storeChainlinkPrice(_token, chainlinkResponse);
		}

		return lastTokenGoodPrice;
	}

	function _getCurrentTellorResponse(
		bytes32 _queryId
	) internal view returns (TellorResponse memory tellorResponse) {
		if (_queryId == bytes32(0)) {
			return (tellorResponse);
		}

		try tellorCaller.getTellorCurrentValue(_queryId) returns (
			bool ifRetrieve,
			uint256 value,
			uint256 _timestampRetrieved
		) {
			tellorResponse.ifRetrieve = ifRetrieve;
			tellorResponse.value = value;
			tellorResponse.timestamp = _timestampRetrieved;
			tellorResponse.success = true;

			return (tellorResponse);
		} catch {
			// If call to Tellor reverts, return a zero response with success = false
			return (tellorResponse);
		}
	}

	function _tellorIsBroken(TellorResponse memory _response) internal view returns (bool) {
		// Check for response call reverted
		if (!_response.success) {
			return true;
		}
		// Check for an invalid timeStamp that is 0, or in the future
		if (_response.timestamp == 0 || _response.timestamp > block.timestamp) {
			return true;
		}
		// Check for zero price
		if (_response.value == 0) {
			return true;
		}

		return false;
	}

	function _tellorIsFrozen(
		TellorResponse memory _tellorResponse
	) internal view returns (bool) {
		return block.timestamp.sub(_tellorResponse.timestamp) > TIMEOUT;
	}

	function _bothOraclesLiveAndUnbrokenAndSimilarPrice(
		ChainlinkResponse memory _chainlinkResponse,
		ChainlinkResponse memory _prevChainlinkResponse,
		TellorResponse memory _tellorResponse
	) internal view returns (bool) {
		// Return false if either oracle is broken or frozen
		if (
			_tellorIsBroken(_tellorResponse) ||
			_tellorIsFrozen(_tellorResponse) ||
			_chainlinkIsBroken(_chainlinkResponse, _prevChainlinkResponse) ||
			_chainlinkIsFrozen(_chainlinkResponse)
		) {
			return false;
		}

		return _bothOraclesSimilarPrice(_chainlinkResponse, _tellorResponse);
	}

	function _bothOraclesSimilarPrice(
		ChainlinkResponse memory _chainlinkResponse,
		TellorResponse memory _tellorResponse
	) internal pure returns (bool) {
		uint256 scaledChainlinkPrice = _scaleChainlinkPriceByDigits(
			uint256(_chainlinkResponse.answer),
			_chainlinkResponse.decimals
		);
		uint256 scaledTellorPrice = _scaleTellorPriceByDigits(_tellorResponse.value);

		// Get the relative price difference between the oracles. Use the lower price as the denominator, i.e. the reference for the calculation.
		uint256 minPrice = VestaMath._min(scaledTellorPrice, scaledChainlinkPrice);
		uint256 maxPrice = VestaMath._max(scaledTellorPrice, scaledChainlinkPrice);
		uint256 percentPriceDifference = maxPrice.sub(minPrice).mul(DECIMAL_PRECISION).div(
			minPrice
		);

		/*
		 * Return true if the relative price difference is <= 3%: if so, we assume both oracles are probably reporting
		 * the honest market price, as it is unlikely that both have been broken/hacked and are still in-sync.
		 */
		return percentPriceDifference <= MAX_PRICE_DIFFERENCE_BETWEEN_ORACLES;
	}

	function _scaleTellorPriceByDigits(uint256 _price) internal pure returns (uint256) {
		return _price.mul(10 ** (TARGET_DIGITS - TELLOR_DIGITS));
	}

	function _getChainlinkResponses(
		AggregatorV3Interface _chainLinkOracle
	)
		internal
		view
		returns (ChainlinkResponse memory currentChainlink, ChainlinkResponse memory prevChainLink)
	{
		currentChainlink = _getCurrentChainlinkResponse(_chainLinkOracle);
		prevChainLink = _getPrevChainlinkResponse(
			_chainLinkOracle,
			currentChainlink.roundId,
			currentChainlink.decimals
		);

		return (currentChainlink, prevChainLink);
	}

	function _chainlinkIsBroken(
		ChainlinkResponse memory _currentResponse,
		ChainlinkResponse memory _prevResponse
	) internal view returns (bool) {
		return _badChainlinkResponse(_currentResponse) || _badChainlinkResponse(_prevResponse);
	}

	function _badChainlinkResponse(
		ChainlinkResponse memory _response
	) internal view returns (bool) {
		if (!_response.success) {
			return true;
		}
		if (_response.roundId == 0) {
			return true;
		}
		if (_response.timestamp == 0 || _response.timestamp > block.timestamp) {
			return true;
		}
		if (_response.answer <= 0) {
			return true;
		}

		return false;
	}

	function _chainlinkIsFrozen(
		ChainlinkResponse memory _response
	) internal view returns (bool) {
		return block.timestamp.sub(_response.timestamp) > TIMEOUT;
	}

	function _chainlinkPriceChangeAboveMax(
		ChainlinkResponse memory _currentResponse,
		ChainlinkResponse memory _prevResponse
	) internal pure returns (bool) {
		uint256 currentScaledPrice = _scaleChainlinkPriceByDigits(
			uint256(_currentResponse.answer),
			_currentResponse.decimals
		);
		uint256 prevScaledPrice = _scaleChainlinkPriceByDigits(
			uint256(_prevResponse.answer),
			_prevResponse.decimals
		);

		uint256 minPrice = VestaMath._min(currentScaledPrice, prevScaledPrice);
		uint256 maxPrice = VestaMath._max(currentScaledPrice, prevScaledPrice);

		/*
		 * Use the larger price as the denominator:
		 * - If price decreased, the percentage deviation is in relation to the the previous price.
		 * - If price increased, the percentage deviation is in relation to the current price.
		 */
		uint256 percentDeviation = maxPrice.sub(minPrice).mul(DECIMAL_PRECISION).div(maxPrice);

		// Return true if price has more than doubled, or more than halved.
		return percentDeviation > MAX_PRICE_DEVIATION_FROM_PREVIOUS_ROUND;
	}

	function _scaleChainlinkPriceByDigits(
		uint256 _price,
		uint256 _answerDigits
	) internal pure returns (uint256) {
		uint256 price;
		if (_answerDigits >= TARGET_DIGITS) {
			// Scale the returned price value down to Vesta's target precision
			price = _price.div(10 ** (_answerDigits - TARGET_DIGITS));
		} else if (_answerDigits < TARGET_DIGITS) {
			// Scale the returned price value up to Vesta's target precision
			price = _price.mul(10 ** (TARGET_DIGITS - _answerDigits));
		}
		return price;
	}

	function _changeStatus(Status _status) internal {
		status = _status;
		emit PriceFeedStatusChanged(_status);
	}

	function _storeTellorPrice(
		address _token,
		TellorResponse memory _tellorResponse
	) internal returns (uint256) {
		uint256 scaledTellorPrice = _scaleTellorPriceByDigits(_tellorResponse.value);
		_storePrice(_token, scaledTellorPrice);

		return scaledTellorPrice;
	}

	function _storeChainlinkPrice(
		address _token,
		ChainlinkResponse memory _chainlinkResponse
	) internal returns (uint256) {
		uint256 scaledChainlinkPrice = _scaleChainlinkPriceByDigits(
			uint256(_chainlinkResponse.answer),
			_chainlinkResponse.decimals
		);

		_storePrice(_token, scaledChainlinkPrice);
		return scaledChainlinkPrice;
	}

	function _storePrice(address _token, uint256 _currentPrice) internal {
		lastGoodPrice[_token] = _currentPrice;
		emit LastGoodPriceUpdated(_token, _currentPrice);
	}

	// --- Oracle response wrapper functions ---

	function _getCurrentChainlinkResponse(
		AggregatorV3Interface _priceAggregator
	) internal view returns (ChainlinkResponse memory chainlinkResponse) {
		if (chainlinkFlags.getFlag(FLAG_ARBITRUM_SEQ_OFFLINE)) {
			return chainlinkResponse;
		}

		try _priceAggregator.decimals() returns (uint8 decimals) {
			chainlinkResponse.decimals = decimals;
		} catch {
			return chainlinkResponse;
		}

		try _priceAggregator.latestRoundData() returns (
			uint80 roundId,
			int256 answer,
			uint256 /* startedAt */,
			uint256 timestamp,
			uint80 /* answeredInRound */
		) {
			chainlinkResponse.roundId = roundId;
			chainlinkResponse.answer = answer;
			chainlinkResponse.timestamp = timestamp;
			chainlinkResponse.success = true;
			return chainlinkResponse;
		} catch {
			return chainlinkResponse;
		}
	}

	function _getPrevChainlinkResponse(
		AggregatorV3Interface _priceAggregator,
		uint80 _currentRoundId,
		uint8 _currentDecimals
	) internal view returns (ChainlinkResponse memory prevChainlinkResponse) {
		if (_currentRoundId == 0) {
			return prevChainlinkResponse;
		}

		unchecked {
			try _priceAggregator.getRoundData(_currentRoundId - 1) returns (
				uint80 roundId,
				int256 answer,
				uint256 /* startedAt */,
				uint256 timestamp,
				uint80 /* answeredInRound */
			) {
				prevChainlinkResponse.roundId = roundId;
				prevChainlinkResponse.answer = answer;
				prevChainlinkResponse.timestamp = timestamp;
				prevChainlinkResponse.decimals = _currentDecimals;
				prevChainlinkResponse.success = true;
				return prevChainlinkResponse;
			} catch {
				return prevChainlinkResponse;
			}
		}
	}
}

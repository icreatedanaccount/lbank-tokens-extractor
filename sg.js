const BITMARTLIB = require('./lib/bitmart/bitmartlib')
const BITMARTWS = require('./lib/bitmart/ws/websocket-client')
const HOTBITLIB = require('./lib/hotbit/hotbit')

// OTHER LIBRARIES AND MODELS
const EXCHANGES = require('./models/exchanges')
const DISCORDBOTLIB = require('./discord/discord-bot')
const NodeCache = require('node-cache')
const Image = require('ascii-art-image')
const Table = require('cli-table')
const TokenInfo = require('./models/token-info')
const TokenOrdersFactory = require('./models/token-orders.factory')
const BitmartOrdersService = require('./lib/bitmart/bitmart-orders.service')
const ChainService = require('./lib/token-lib/chain.service')
const COLUMNS = require('./models/columns')
const allSettled = require('promise.allsettled')

const debugEnabled = process.env.DEBUG === 'true'

// HOTBIT
const hotbitApi = new HOTBITLIB.HotBitApi()

// BITMART
const bitmartApi = new BITMARTLIB.BitMartApi()
const bitmartWebSocket = new BITMARTWS.WebsocketClient(1)
const bitmartOrdersService = new BitmartOrdersService.BitmartOrdersService()

// CHAIN
let chainService = null
let tokenConfigurations = []

// DISCORD
const discordBotEnabled = process.env.BOT_TOKEN != null
let discordBot = null
let profitNotificationCache = null
let reverseProfitNotificationCache = null
let liquidityNotificationCache = null

// IMAGE
const image = new Image({filepath: './images/swapgang.png'})

main()

/**
 * Main function.
 */
function main () {
  image.write(function (err, rendered) {
    printBannerAndWelcomeMessage(rendered)
    chainService = new ChainService.ChainService()
    chainService.init(() => {
      if (discordBotEnabled) {
        discordBot = new DISCORDBOTLIB.DiscordBot()
        initNotificationCaches()
      }
      tokenConfigurations = chainService.getTokenConfigurations()
      initBitmartWebSocketStream()
      mainLoop()
    })
  })

}

/**
 * Prints the SG logo and a welcome message.
 * @param rendered
 */
function printBannerAndWelcomeMessage (rendered) {
  console.log(rendered)
  console.log('LIQUIDITYYYYYYY.')
  console.log('--------------------')
  console.log('')
}

/**
 * Handles notifications dispatching to the discord bot.
 * @param tokenValues
 */
function handleNotifications (tokenValues) {
  const forwardProfitableTokens = getForwardProfitableMovableTokens(tokenValues)
  const reverseProfitableTokens = getReverseProfitableMovableTokens(tokenValues)
  sendProfitNotifications(forwardProfitableTokens, profitNotificationCache)
  sendProfitNotifications(reverseProfitableTokens, reverseProfitNotificationCache)
}

/**
 * Main loop. Will call getTokenInfo for all tokens and wait for all Promises
 * to settle to then print and send discord notifications (if enabled).
 */
function mainLoop () {
  setTimeout(async () => {
    try {
      // Get currencies list
      const bitmartCurrencyList = await bitmartApi.getCurrencies()

      const tokenPromises = tokenConfigurations
        .filter(tokenConfig => tokenConfig != null)
        .map(tokenConfig => getTokenInfo(tokenConfig, bitmartCurrencyList))

      allSettled(tokenPromises).then(results => {
        const tokenValues = results.map(r => r.value).flat()
        printTokensTable(tokenValues)
        if (discordBotEnabled) {
          handleNotifications(tokenValues)
        }
      })
    }
    catch (e) {
      console.error(e)
    }
    mainLoop()
  }, 10000)
}

/**
 * Prints the token table to console.
 * @param tokens
 * @param maxTokens
 */
function printTokensTable (tokens, maxTokens = 20) {
  const table = new Table({head: COLUMNS.COLUMN_NAMES, colWidths: COLUMNS.COLUMN_SIZES})

  // Filter out non-profitable tokens
  if (!debugEnabled) {
    tokens = getProfitableTokens(tokens)
  }
  tokens.sort((a, b) => {
    if (isFinite(b.getMaxProfit() - a.getMaxProfit())) {
      return b.getMaxProfit() - a.getMaxProfit()
    } else {
      return isFinite(a.getMaxProfit()) ? -1 : 1
    }
  })
  tokens = tokens.slice(0, !debugEnabled ? maxTokens : Number.MAX_VALUE)
  tokens.filter(token => !!token).forEach(token => table.push(token.toArray()))
  console.log(table.toString())
}

/**
 * Gets profitable tokens.
 * @param tokens
 * @param threshold
 * @return {TokenInfo[]}
 */
function getProfitableTokens (tokens, threshold = Number(process.env.PROFIT_THRESHOLD)) {
  return tokens.filter(token => !!token && token.isProfitableAndRatioProfitable(threshold))
}

/**
 * Gets forward profitable tokens using a profit threshold and token ratios.
 * @param tokens
 * @param threshold
 * @return {TokenInfo[]}
 */
function getForwardProfitableMovableTokens (tokens, threshold = Number(process.env.PROFIT_THRESHOLD)) {
  return tokens.filter(token => !!token &&
    token.isForwardProfitable(threshold) &&
    token.isForwardRatioProfitable() &&
    token.isMovable(true))
}

/**
 * Gets reverse profitable tokens using a profit threshold and token ratios.
 * @param tokens
 * @param threshold
 * @return {TokenInfo[]}
 */
function getReverseProfitableMovableTokens (tokens, threshold = Number(process.env.PROFIT_THRESHOLD)) {
  return tokens.filter(token => !!token &&
    token.isReverseProfitable(threshold) &&
    token.isReverseRatioProfitable() &&
    token.isMovable(false))
}

/**
 * Returns true if the liquidity of a token is lower than a threshold.
 * @param token
 * @param liquidityThreshold
 * @return {boolean}
 */
function isLowLiquidity (token, liquidityThreshold = Number(process.env.TOKEN_LIQUIDITY_THRESHOLD)) {
  return !!token && token.isLowLiquidity(liquidityThreshold)
}

/**
 * Sends discord notifications for profitable tokens with good liquidity.
 * Also sends warning notifications for low liquidity tokens.
 * @param tokens
 * @param cache
 * @param threshold
 */
function sendProfitNotifications (tokens, cache, threshold = Number(process.env.PROFIT_THRESHOLD)) {
  tokens.filter(token => !cache.get(token.symbol + token.exchange) && !isLowLiquidity(token))
    .forEach(token => {
      cache.set(token.symbol + token.exchange, token)
      discordBot.sendTokenProfitNotification(token, threshold)
    })

  tokens.filter(token => !liquidityNotificationCache.get(token.symbol + token.exchange) && isLowLiquidity(token))
    .forEach(token => {
      liquidityNotificationCache.set(token.symbol + token.exchange, token)
      discordBot.sendLiquidityNotification(token)
    })
}

/**
 * Initializes the Bitmart web socket stream to fetch order books.
 */
function initBitmartWebSocketStream () {
  bitmartWebSocket.subscribeOrders(
    tokenConfigurations
      .filter(token => token.exchanges.includes(EXCHANGES.Exchanges.BITMART))
      .map(token => token.symbol), (orders) => {
      orders.forEach(o =>
        bitmartOrdersService.addOrders(
          o.symbol,
          TokenOrdersFactory.TokenOrdersFactory.fromAsksBidsTokenOrders(o)
        )
      )
    }
  )
}

/**
 * Initializes caches.
 */
function initNotificationCaches () {
  profitNotificationCache = new NodeCache({stdTTL: parseInt(process.env.TOKEN_NOTIFICATION_COOLDOWN)})
  reverseProfitNotificationCache = new NodeCache({stdTTL: parseInt(process.env.TOKEN_NOTIFICATION_COOLDOWN)})
  liquidityNotificationCache = new NodeCache({stdTTL: parseInt(process.env.TOKEN_LIQUIDITY_COOLDOWN)})
}

/**
 * Gets token information using a {TokenConfiguration} object.
 * @param tokenConfig {TokenConfiguration}
 * @param currencyList
 * @param symbolSuffix
 * @return {Promise<Array<TokenInfo>>}
 */
async function getTokenInfo (tokenConfig, currencyList, symbolSuffix = 'USDT') {
  let pancakePrice = NaN
  let pancakeBnbLiquidity = NaN
  const tokenInformation = []
  try {
    pancakePrice = await chainService.getLatestPrice(tokenConfig.symbol)
    pancakeBnbLiquidity = await chainService.getPancakeBNBLiquidity(tokenConfig.symbol)
  }
  catch (e) {
    console.error('Error fetching prices on chain for: ' + tokenConfig.symbol)
    if (debugEnabled) {
      console.error(e)
    }
  }
  if (tokenConfig.exchanges.includes(EXCHANGES.Exchanges.BITMART)) {
    tokenInformation.push(getBitmartTokenInfo(pancakePrice, pancakeBnbLiquidity, tokenConfig, currencyList, symbolSuffix))
  }
  if (tokenConfig.exchanges.includes(EXCHANGES.Exchanges.HOTBIT)) {
    tokenInformation.push(await getHotbitTokenInfo(pancakePrice, pancakeBnbLiquidity, tokenConfig, symbolSuffix))
  }
  return tokenInformation
}

/**
 * Create and return a {EXCHANGES.Exchange.BITMART} TokenInfo
 * @param pancakePrice
 * @param pancakeBnbLiquidity
 * @param tokenConfig {TokenConfiguration}
 * @param currencyList
 * @param symbolSuffix
 * @return {Promise<TokenInfo>}
 */
function getBitmartTokenInfo (pancakePrice, pancakeBnbLiquidity, tokenConfig, currencyList, symbolSuffix) {
  try {
    return new TokenInfo.TokenInfo(
      tokenConfig.symbol,
      tokenConfig.blockchain,
      pancakePrice,
      pancakeBnbLiquidity,
      tokenConfig.tax,
      bitmartOrdersService.getOrders(tokenConfig.symbol + '_' + 'USDT'),
      getCurrencyInfo(tokenConfig.symbol, currencyList),
      EXCHANGES.Exchanges.BITMART)
  }
  catch (e) {
    console.error('Error fetching ' + EXCHANGES.Exchanges.BITMART + ' prices for: ' + tokenConfig.symbol)
    if (debugEnabled) {
      console.error(e)
    }
  }
}

/**
 * Create and return a {EXCHANGES.Exchange.HOTBIT} TokenInfo
 * @param pancakePrice
 * @param pancakeBnbLiquidity
 * @param tokenConfig {TokenConfiguration}
 * @param symbolSuffix
 * @return {Promise<TokenInfo>}
 */
async function getHotbitTokenInfo (pancakePrice, pancakeBnbLiquidity, tokenConfig, symbolSuffix) {
  let orders = null
  try {
    orders = await hotbitApi.getOrderBook(tokenConfig.symbol + '/' + symbolSuffix)
  }
  catch (e) {
    console.error('Error fetching ' + EXCHANGES.Exchanges.HOTBIT + ' prices for: ' + tokenConfig.symbol)
    if (debugEnabled) {
      console.error(e)
    }
  }
  return new TokenInfo.TokenInfo(
    tokenConfig.symbol,
    pancakePrice,
    pancakeBnbLiquidity,
    tokenConfig.tax,
    TokenOrdersFactory.TokenOrdersFactory.fromAsksBidsTokenOrders(orders),
    {
      withdraw_enabled:
        !tokenConfig.disabledReverseExchanges.includes(EXCHANGES.Exchanges.HOTBIT)
    },
    EXCHANGES.Exchanges.HOTBIT)
}

/**
 * Parses a currency list to get a currency information
 * @param symbol
 * @param currencyList
 */
function getCurrencyInfo (symbol, currencyList) {
  return currencyList.find(currency => currency['id'] === symbol)
}


// IMAGE
const Image = require('ascii-art-image')
const image = new Image({filepath: './images/logo.jpg'})

// SERVICES
const lbankService = require('./services/lbank.service')

// LIB
const fs = require('fs')
const converter = require('json-2-csv')

// CONST
const usdtPairSuffix = '_usdt'
const outputFile = 'lbank_usdt_currencies.csv'

main()

/**
 * Main function.
 */
function main () {
  image.write(function (err, rendered) {
    printBannerAndWelcomeMessage(rendered)
    saveCurrencyPairs()
  })

}

/**
 * Prints logo and welcome message.
 * @param rendered
 */
function printBannerAndWelcomeMessage (rendered) {
  console.log(rendered)
  console.log('LBANK TOKENS EXTRACTOR.')
  console.log('--------------------')
  console.log('')
}

/**
 * Saves all USDT pairs to CSV.
 * @return {Promise<void>}
 */
async function saveCurrencyPairs () {
  const currencyPairs = await lbankService.LBankService.getCurrencyPairs()
  const usdtCurrencyPairs = currencyPairs
    .filter(pair => pair.endsWith(usdtPairSuffix))
    .map(pair => { return {tokenName: pair.replace(usdtPairSuffix, '').toUpperCase()}})

  let json2csvCallback = function (err, csv) {
    if (err) throw err;
    fs.writeFile(outputFile, csv, function(err) {
      if(err) {
        return console.log(err);
      }
    });
  };

  converter.json2csv(usdtCurrencyPairs, json2csvCallback);
}
const axios = require('axios')

class LBankService {

  static V1_BASE_URL = 'https://api.lbkex.com/v1/'

  /**
   * Gets all currency pairs.
   * @return {Promise<*>}
   */
  static async getCurrencyPairs () {
    const response = await axios.get(LBankService.V1_BASE_URL + 'currencyPairs.do')
    if (response && response.status === 200) {
      return response.data
    }
    else {
      console.error('Unable to fetch LBank full currency pairs listing...')
      return []
    }
  }
}

module.exports.LBankService = LBankService

// IMAGE
const Image = require('ascii-art-image')
const image = new Image({filepath: './images/logo.jpg'})

main()

/**
 * Main function.
 */
function main () {
  image.write(function (err, rendered) {
    printBannerAndWelcomeMessage(rendered)
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
const base = require('./package.json').build
const thumbprint = process.env.HASARBOTU_SIGNING_CERT_SHA1
const publisher = process.env.HASARBOTU_SIGNING_PUBLISHER
const timestamp = process.env.HASARBOTU_SIGNING_TIMESTAMP_URL
if (!/^[a-fA-F0-9]{40}$/.test(thumbprint ?? '') || !publisher) throw new Error('Explicit signing certificate and publisher are required')
const url = new URL(timestamp)
if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('An HTTPS RFC3161 timestamp URL without credentials is required')
if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' || process.env.CSC_LINK || process.env.WIN_CSC_LINK || process.env.ELECTRON_BUILDER_OFFLINE === 'true') throw new Error('Signed packaging requires the explicitly selected Windows certificate store identity and online timestamping')
module.exports = {
  ...base,
  forceCodeSigning: true,
  directories: { ...base.directories, output: 'release/signed' },
  win: { ...base.win, signtoolOptions: { certificateSha1: thumbprint, certificateSubjectName: publisher,
    signingHashAlgorithms: ['sha256'], rfc3161TimeStampServer: timestamp } },
}

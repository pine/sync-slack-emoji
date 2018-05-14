'use strict'

const assert = require('assert')
const cheerio = require('cheerio')
const config = require('config')
const _ = require('lodash')
const rp = require('request-promise')
const v = require('voca')

// -----------------------------------------------------------------------------

const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.139 Safari/537.36'

async function fetchSigninFormData({ domain }) {
  process.stdout.write('Fetch login form data ...')

  const uri = `https://${domain}.slack.com/customize/emoji`
  const $ = await rp({
    uri,
    headers: { 'User-Agent': ua },
    transform: v => cheerio.load(v),
  })
  return $('#signin_form').serializeArray()
}

async function tryLogin({ formData, jar, domain, email, password }) {
  process.stdout.write('\nTry login ...')

  for (const f of formData) {
    if (f.name === 'email') f.value = email
    if (f.name === 'password') f.value = password
  }
  const form =_(formData)
    .map(f => [ f.name, f.value ])
    .fromPairs()
    .value()

  const uri = `https://${domain}.slack.com`
  const { statusCode } = await rp({
    method: 'POST',
    uri,
    form,
    headers: { 'User-Agent': ua },
    jar,
    resolveWithFullResponse: true,
    simple: false,
  })

  assert(statusCode === 302)
}

// -----------------------------------------------------------------------------

async function fetchEmojis({ domain, jar }) {
  process.stdout.write('\nFetch emoji ')

  const emojis = []
  for (let page = 0; ; ++page) {
    process.stdout.write('.')

    const uri = `https://${domain}.slack.com/customize/emoji?page=${page}`
    const $ = await rp({
      uri,
      headers: { 'User-Agent': ua },
      jar,
      transform: v => cheerio.load(v),
    })

    const elems = $('#custom_emoji .emoji_row').toArray()
    if (elems.length === 0) break

    for (const elem of elems) {
      const uri = $('[data-original]', elem).attr('data-original')
      const name = v($('.custom_emoji_name', elem).text())
        .trim('\n\t ')
        .replace(/\:/g, '')
        .value()
      emojis.push({ uri, name })
    }
    // break // for debug
  }

  process.stdout.write(` ${emojis.length} emojis found\n`)
  return emojis
}

// -----------------------------------------------------------------------------

async function registerEmojis({ emojis, jar, domain }) {
  process.stdout.write('\nRegister emojis ...')

  for (const emoji of emojis) {
    const registerFormData = await fetchRegisterFormData({ jar, domain })
    await postRegisterForm({ formData: registerFormData, emoji, jar, domain })
    // break // for debug
  }

  process.stdout.write(`\n`)
}

async function fetchRegisterFormData({ jar, domain }) {
  const uri = `https://${domain}.slack.com/customize/emoji`
  const $ = await rp({
    uri,
    headers: { 'User-Agent': ua },
    jar,
    transform: v => cheerio.load(v),
  })
  return $('#addemoji').serializeArray()
}

async function postRegisterForm({ formData, emoji, jar, domain }) {
  process.stdout.write(`\n  ${emoji.name} .`)

  // Download img data
  const img = await rp({
    uri: emoji.uri,
    headers: { 'User-Agent': ua },
    jar,
    encoding: null,
  })
  process.stdout.write('.')

  // Create form data
  for (const f of formData) {
    if (f.name === 'name') f.value = emoji.name
  }
  const newFormData =_(formData)
    .map(f => [ f.name, f.value ])
    .fromPairs()
    .value()
  newFormData['img'] = {
    value: img,
    options: {
      filename: 'emoji.png',
      contentType: 'image/png',
    },
  }

  // Upload emoji
  const uri = `https://${domain}.slack.com/customize/emoji`
  const $ = await rp({
    method: 'POST',
    uri,
    headers: { 'User-Agent': ua },
    formData: newFormData,
    jar,
    transform: v => cheerio.load(v),
    followRedirect: true,
    followAllRedirects: true,
  })
  process.stdout.write('. ')

  const elem = $('.alert:first-of-type')
  if (elem.hasClass('alert_success')) {
    const msg = elem.find('strong').text().trim()
    process.stdout.write(msg)
  } else {
    const msg = elem.text().trim()
    process.stdout.write(msg)
  }
}


// -----------------------------------------------------------------------------

!async function() {
  // Collect all emojis from old Slack team
  const from = config.get('from')
  const fromJar = rp.jar()
  const fromFormData = await fetchSigninFormData(from)
  await tryLogin({ formData: fromFormData, jar: fromJar, ...from })
  const emojis = await fetchEmojis({ jar: fromJar, ...from })

  // Register all emojis for new Slack team
  const to = config.get('to')
  const toJar = rp.jar()
  const toSigninFormData = await fetchSigninFormData(to)
  await tryLogin({ formData: toSigninFormData, jar: toJar, ...to })
  await registerEmojis({ emojis, jar: toJar, ...to })
}()

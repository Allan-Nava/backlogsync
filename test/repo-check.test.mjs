// The leak shapes. Every sample is assembled from pieces, so this file does not
// trip the check it tests.
import assert from 'node:assert/strict'
import test from 'node:test'
import { checkManifest, findings } from '../scripts/repo-check.mjs'

const j = (...p) => p.join('')

test('each shape is found, by kind', () => {
  assert.deepEqual(findings(j('see /', 'Users/', 'someone/notes')), ['a home directory path'])
  assert.deepEqual(findings(j('cd /', 'home/', 'someone')), ['a home directory path'])
  assert.deepEqual(findings(j('fi', 'le:///tmp/x')), ['a file URL'])
  assert.deepEqual(findings(j('10', '.1.2.3')), ['a private IPv4 address'])
  assert.deepEqual(findings(j('192.', '168.0.10')), ['a private IPv4 address'])
  assert.deepEqual(findings(j('gh', 'p_', 'a'.repeat(36))), ['a key or token'])
  assert.deepEqual(findings(j('np', 'm_', 'b'.repeat(36))), ['a key or token'])
  assert.deepEqual(findings(j('-----BEGIN OPENSSH PRIV', 'ATE KEY-----')), ['a private key'])
  assert.deepEqual(findings(j('someone', '@', 'example.org')), ['an email address'])
})

test('the public shapes pass', () => {
  assert.deepEqual(findings('/' + 'home/<name>/x is a placeholder'), [])
  assert.deepEqual(findings('https://example.com/home/about/'), [])
  assert.deepEqual(findings(j('allannava95', '@', 'gmail.com')), [])
  assert.deepEqual(findings(j('noreply', '@', 'github.com')), [])
  assert.deepEqual(findings(j('1+someone', '@', 'users.noreply.github.com')), [])
  assert.deepEqual(findings(j('git', '@', 'github.com:Allan-Nava/backlogsync.git')), [], 'an SSH remote is not an address')
  assert.deepEqual(findings('http://127.0.0.1:8080 and 8.8.8.8'), [])
  assert.deepEqual(findings('test-token'), [])
})

test('private terms come from outside and match case-insensitively', () => {
  assert.deepEqual(findings('Mentions ACME-internal here', ['acme-internal']), ['a private term (LEAK_TERMS)'])
  assert.deepEqual(findings('nothing here', ['acme-internal']), [])
})

test('this repository passes its own manifest check', () => {
  assert.deepEqual(checkManifest(), [])
})

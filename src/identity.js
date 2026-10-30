'use strict';

// TLS identity for receiving files over HTTPS. As in LocalSend, a device's fingerprint is the
// SHA-256 of its certificate, so senders can check that they reached the device that announced itself.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const RENEW_BEFORE_MS = 30 * 24 * 3600 * 1000;

function describe(cert, key) {
  const x = new crypto.X509Certificate(cert);
  return { key, cert, fingerprint: crypto.createHash('sha256').update(x.raw).digest('hex'), validTo: new Date(x.validTo) };
}

async function loadOrCreateCert(dir) {
  const keyFile = path.join(dir, 'tls-key.pem');
  const certFile = path.join(dir, 'tls-cert.pem');
  try {
    const id = describe(fs.readFileSync(certFile, 'utf8'), fs.readFileSync(keyFile, 'utf8'));
    if (id.validTo.getTime() - Date.now() > RENEW_BEFORE_MS) return id;
  } catch { /* first run or unreadable: create a new one */ }

  const notAfterDate = new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Recme' }], { keySize: 2048, algorithm: 'sha256', notAfterDate });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  fs.writeFileSync(certFile, pems.cert);
  return describe(pems.cert, pems.private);
}

module.exports = { loadOrCreateCert };

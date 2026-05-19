'use strict';

function required(name) {
  const v = process.env[name];
  if (v == null || v === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name, fallback = null) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return v;
}

function requiredJsonBase64(name) {
  const raw = required(name);
  let decoded;
  try {
    decoded = Buffer.from(raw, 'base64').toString('utf8');
  } catch {
    throw new Error(`Env var ${name} is not valid base64.`);
  }
  try {
    return JSON.parse(decoded);
  } catch {
    throw new Error(`Env var ${name} (base64-decoded) is not valid JSON.`);
  }
}

module.exports = { required, optional, requiredJsonBase64 };

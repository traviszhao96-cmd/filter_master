#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE_NAME = 'com.scene.lut.mlkitlabeler';
const RECEIVER_NAME = `${PACKAGE_NAME}/.LabelReceiver`;
const imagePath = process.argv[2] || process.env.MLKIT_IMAGE_PATH;

if (!imagePath) {
  fail('Usage: mlkit-labeler-adb.mjs /absolute/path/to/image');
}

if (!fs.existsSync(imagePath)) {
  fail(`Image not found: ${imagePath}`);
}

const serialArgs = process.env.ADB_SERIAL ? ['-s', process.env.ADB_SERIAL] : [];
const hash = crypto.createHash('sha1').update(`${imagePath}:${Date.now()}`).digest('hex');
const ext = path.extname(imagePath).toLowerCase() || '.jpg';
const tempInput = `/data/local/tmp/scene-lut-${hash}${ext}`;
const remoteBase = `/data/data/${PACKAGE_NAME}/files`;
const remoteInput = `${remoteBase}/input/${hash}${ext}`;
const remoteOutput = `${remoteBase}/output/${hash}.json`;

try {
  adb(['shell', 'run-as', PACKAGE_NAME, 'mkdir', '-p', `${remoteBase}/input`, `${remoteBase}/output`]);
  adb(['shell', 'run-as', PACKAGE_NAME, 'rm', '-f', remoteOutput]);
  adb(['push', imagePath, tempInput], { stdio: 'ignore' });
  adb(['shell', 'run-as', PACKAGE_NAME, 'cp', tempInput, remoteInput]);
  adb([
    'shell',
    'am',
    'broadcast',
    '-n',
    RECEIVER_NAME,
    '--es',
    'input',
    remoteInput,
    '--es',
    'output',
    remoteOutput
  ], { stdio: 'ignore' });

  const output = waitForOutput(remoteOutput);
  const parsed = JSON.parse(output);
  if (parsed.error) fail(parsed.error);
  process.stdout.write(`${JSON.stringify(parsed)}\n`);
} catch (error) {
  fail(error.message);
} finally {
  try {
    adb(['shell', 'rm', '-f', tempInput], { stdio: 'ignore' });
    adb(['shell', 'run-as', PACKAGE_NAME, 'rm', '-f', remoteInput, remoteOutput], { stdio: 'ignore' });
  } catch {
    // Best-effort cleanup only.
  }
}

function waitForOutput() {
  const deadline = Date.now() + Number(process.env.MLKIT_ADB_TIMEOUT_MS || 45000);
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const output = adb(['shell', 'run-as', PACKAGE_NAME, 'cat', remoteOutput], { encoding: 'utf8', stdio: 'pipe' });
      if (output.trim()) return output.trim();
    } catch (error) {
      lastError = error.message;
    }
    sleep(350);
  }
  throw new Error(`Timed out waiting for ML Kit output. ${lastError}`);
}

function adb(args, options = {}) {
  return execFileSync('adb', [...serialArgs, ...args], {
    encoding: options.encoding === null ? 'buffer' : options.encoding || 'utf8',
    input: options.input,
    stdio: options.stdio || 'pipe'
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

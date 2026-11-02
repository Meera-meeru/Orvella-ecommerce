const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const connectDB = require('../config/db');
const User = require('../models/user');

const readTerminalInput = (prompt, { hidden = false } = {}) => new Promise((resolve, reject) => {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return reject(new Error('Run this command in an interactive terminal so the password can be entered securely.'));
  }

  const wasRaw = input.isRaw;
  let value = '';
  output.write(prompt);
  input.setRawMode(true);
  input.resume();

  const finish = (error) => {
    input.removeListener('data', onData);
    input.setRawMode(wasRaw);
    input.pause();
    output.write('\n');
    if (error) return reject(error);
    return resolve(value);
  };

  const onData = (chunk) => {
    for (const character of chunk.toString('utf8')) {
      if (character === '\u0003') return finish(new Error('Admin creation cancelled.'));
      if (character === '\r' || character === '\n') return finish();
      if (character === '\u007f' || character === '\b') {
        value = value.slice(0, -1);
        if (!hidden) output.write('\b \b');
        continue;
      }
      value += character;
      if (!hidden) output.write(character);
    }
  };

  input.on('data', onData);
});

const main = async () => {
  await connectDB();
  try {
    const name = (await readTerminalInput('Admin name: ')).trim();
    const email = (await readTerminalInput('Admin email: ')).trim().toLowerCase();
    const password = await readTerminalInput('Admin password (input hidden): ', { hidden: true });
    if (!name || name.length > 100) throw new Error('Admin name must contain 1 to 100 characters.');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid admin email address.');
    if (password.length < 12) throw new Error('Admin password must be at least 12 characters long.');
    if (Buffer.byteLength(password, 'utf8') > 72) throw new Error('Admin password must be no longer than 72 UTF-8 bytes.');

    const existing = await User.findOne({ email }).select('_id isAdmin').lean();
    if (existing) {
      if (existing.isAdmin === true) {
        console.log('An admin account with this email already exists. No changes were made.');
        return;
      }
      throw new Error('An account with this email already exists as a customer. Choose a different email; no account data was changed.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({
      name,
      email,
      password: passwordHash,
      emailVerified: true,
      isAdmin: true
    });
    console.log('Admin account created successfully.');
  } catch (error) {
    if (error.code === 11000) {
      throw new Error('An account with that email already exists. No duplicate account was created.');
    }
    throw error;
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error('Could not create the admin account:', error.message);
  process.exitCode = 1;
});

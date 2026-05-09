import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function readEnvFile(path) {
  const env = {};
  if (!fs.existsSync(path)) return env;

  for (const line of fs.readFileSync(path, 'utf8').split(/\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }

  return env;
}

function safeError(error) {
  if (!error) return null;
  return {
    name: error.name,
    message: error.message,
    status: error.status
  };
}

const fileEnv = readEnvFile('.env.local');
const env = { ...fileEnv, ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  console.error('Missing one of NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const email = `docflow-auth-check-${Date.now()}@example.com`;
const password = `DocFlowCheck-${Date.now()}!`;
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const ownerClient = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

let userId;
let ok = false;
try {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (created.error || !created.data.user) {
    console.error('Admin createUser failed:', safeError(created.error));
  } else {
    userId = created.data.user.id;
    const signedIn = await ownerClient.auth.signInWithPassword({ email, password });

    if (signedIn.error || !signedIn.data.session) {
      console.error('Anon signInWithPassword failed:', safeError(signedIn.error));
      console.error('Check NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and Vercel environment variables.');
    } else {
      ok = true;
      console.log('Supabase Auth check passed. Admin createUser and anon signInWithPassword both work.');
    }
  }
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
  }
}

process.exit(ok ? 0 : 1);

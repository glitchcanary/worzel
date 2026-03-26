import { createClient } from './dist/supabase.js';
import { initRegister } from './register.js';

// Supabase config is injected by the server at /fink/api/supabase-config
let supabase = null;

function showTab(name) {
  document.getElementById('panel-signin').style.display = name === 'signin' ? '' : 'none';
  document.getElementById('panel-register').style.display = name === 'register' ? '' : 'none';
  document.getElementById('tab-signin').classList.toggle('active', name === 'signin');
  document.getElementById('tab-register').classList.toggle('active', name === 'register');
}

document.getElementById('tab-signin').addEventListener('click', () => showTab('signin'));
document.getElementById('tab-register').addEventListener('click', () => showTab('register'));

async function init() {
  try {
    const res = await fetch('./api/supabase-config');
    if (!res.ok) {
      showMessage('Supabase not configured. Contact your admin.', 'error');
      disableForm();
      return;
    }
    const cfg = await res.json();
    supabase = createClient(cfg.url, cfg.anonKey);

    // Initialize registration form
    initRegister(supabase);

    // Check if already logged in
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      setTokenAndRedirect(session);
    }

    // Listen for auth state changes (e.g. magic link callback)
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setTokenAndRedirect(session);
      }
    });
  } catch (err) {
    showMessage('Failed to initialize auth.', 'error');
    disableForm();
  }
}

function setTokenAndRedirect(session) {
  const token = session.access_token;

  // Store in localStorage (works even when cookies are blocked)
  try { localStorage.setItem('sb-token', token); } catch {}

  // Also try cookie as a belt-and-suspenders approach for the server redirect gate
  try { document.cookie = `sb-token=${token}; path=/; max-age=${session.expires_in ?? 3600}; SameSite=Lax`; } catch {}

  // Redirect with token in query param so the server gate can verify
  // without relying on cookies. The Fink client will strip it on load.
  const redirect = new URLSearchParams(window.location.search).get('redirect') || './';
  const separator = redirect.includes('?') ? '&' : '?';
  window.location.href = `${redirect}${separator}sb-token=${encodeURIComponent(token)}`;
}

function showMessage(text, type = 'error') {
  const el = document.getElementById('message');
  el.textContent = text;
  el.className = `message ${type}`;
}

function disableForm() {
  document.getElementById('btn-signin').disabled = true;
  document.getElementById('btn-magic').disabled = true;
}

// Email + password sign in
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!supabase) return;

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email) {
    showMessage('Email is required.', 'error');
    return;
  }

  const btn = document.getElementById('btn-signin');
  btn.disabled = true;

  if (!password) {
    // No password — treat as magic link
    await sendMagicLink(email);
    btn.disabled = false;
    return;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  btn.disabled = false;

  if (error) {
    showMessage(error.message, 'error');
  }
});

// Magic link
document.getElementById('btn-magic').addEventListener('click', async () => {
  if (!supabase) return;
  const email = document.getElementById('email').value.trim();
  if (!email) {
    showMessage('Enter your email first.', 'error');
    return;
  }
  document.getElementById('btn-magic').disabled = true;
  await sendMagicLink(email);
  document.getElementById('btn-magic').disabled = false;
});

async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  if (error) {
    showMessage(error.message, 'error');
  } else {
    showMessage('Check your email for the login link!', 'success');
  }
}

init();

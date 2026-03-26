// fink/client/register.js
export async function initRegister(supabaseClient) {
  const form = document.getElementById('register-form');
  const msg = document.getElementById('reg-message');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    const { error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });

    msg.style.display = '';
    if (error) {
      msg.textContent = `Registration failed: ${error.message}`;
      msg.style.color = '#f88';
    } else {
      msg.textContent = 'Account created! Check your email to confirm, then sign in.';
      msg.style.color = '#8f8';
    }
  });
}

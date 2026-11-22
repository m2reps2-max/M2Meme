'use strict';
const form = document.querySelector('#login-form');
const error = document.querySelector('#error');
form.addEventListener('submit', async event => {
  event.preventDefault(); error.textContent = '';
  const button = form.querySelector('button'); button.disabled = true; button.textContent = 'Vérification…';
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: form.code.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Connexion impossible.');
    location.replace('/');
  } catch (err) { error.textContent = err.message; button.disabled = false; button.innerHTML = 'Accéder au dashboard <span>→</span>'; }
});
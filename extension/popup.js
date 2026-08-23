const input = document.getElementById('path');
const status = document.getElementById('status');

chrome.storage.local.get('outputBaseUrl').then(({ outputBaseUrl }) => {
  if (outputBaseUrl) input.value = outputBaseUrl;
});

document.getElementById('save').addEventListener('click', async () => {
  const value = input.value.trim().replace(/\/+$/, ''); // strip trailing slash

  if (!value.startsWith('file://')) {
    status.textContent = 'Must start with file://';
    status.style.color = 'crimson';
    return;
  }

  await chrome.storage.local.set({ outputBaseUrl: value });
  status.textContent = 'Saved.';
  status.style.color = 'green';
});
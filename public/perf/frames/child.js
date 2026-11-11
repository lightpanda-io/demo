const params = new URLSearchParams(location.search);
const id = params.get('i');
window.addEventListener('message', (e) => {
  if (e.data.ping !== undefined) e.source.postMessage({ pong: e.data.ping }, '*');
});
window.addEventListener('load', () => {
  const list = document.getElementById('list');
  for (let i = 0; i < 200; i++) {
    const li = document.createElement('li');
    li.className = 'item i' + (i % 10);
    li.textContent = 'frame ' + id + ' item ' + i;
    list.appendChild(li);
  }
  if (params.get('nest') === '1') {
    const f = document.createElement('iframe');
    f.src = 'child.html?i=' + id + '-nested';
    document.body.appendChild(f);
  }
  // Nested frames answer the top window directly, but don't take pings.
  const nested = id.endsWith('-nested');
  window.top.postMessage({ ready: id, ping: nested === false }, '*');
});

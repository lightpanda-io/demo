
async function loadAmiibo(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Response status: ${response.status}");
    }
    update(await response.json());
  } catch (error) {
    console.error(error.message);
  }
}

function update(data) {
  document.getElementById('title').textContent = data.amiibo.name;
  document.getElementById('name').textContent = data.amiibo.name;
  document.getElementById('game').textContent = data.amiibo.amiiboSeries;
  document.getElementById('serie').textContent = data.amiibo.gameSeries;
  document.getElementById('image').setAttribute('src', data.amiibo.image);

  const nav = document.getElementById('nav');

  const prev = document.createElement("a");
  prev.setAttribute('href', data.prev);
  prev.textContent = "Previous";
  nav.appendChild(prev);

  nav.appendChild(document.createTextNode(" | "));

  const next = document.createElement("a");
  next.setAttribute('href', data.next);
  next.textContent = "Next";
  nav.appendChild(next);

  const alt = document.getElementById('alt');
  for (const key in data.list) {
  	const a = document.createElement("a");
	a.setAttribute('href', key + '.html');
	a.textContent = data.list[key];
  	const li = document.createElement("li");
	li.append(a);
	alt.append(li);
  }
}

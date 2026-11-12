// Shared helpers for the perf pages: a deterministic RNG, a generated
// document (body > main > section* > h2 + ul > li.item > a + span), and a
// stylesheet with the selectors badly built sites ship.
window.__perf = new Promise(r => window.__resolve = r);

let seed = 12345;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

function buildDocument(target) {
  const main = document.createElement('main');
  document.body.appendChild(main);
  const sections = [];
  let count = 0;
  while (count < target) {
    const sec = document.createElement('section');
    sec.className = 'sec c' + (sections.length % 200);
    const h = document.createElement('h2');
    h.textContent = 'Section ' + sections.length;
    const ul = document.createElement('ul');
    if (sections.length % 3 === 0) ul.className = 'row';
    for (let i = 0; i < 25; i++) {
      const li = document.createElement('li');
      li.className = 'item';
      li.innerHTML = '<a href="#">link ' + i + '</a><span>text</span>';
      ul.appendChild(li);
    }
    sec.append(h, ul);
    main.appendChild(sec);
    sections.push(sec);
    count += 3 + 25 * 3;
  }
  return { main, sections };
}

// `wild` = number of 4-rule groups of expensive selectors.
function addStylesheet(wild, extra = '') {
  let css = '.row{display:flex}.card{width:300px}.hidden{display:none}.wide{width:100%}\n';
  for (let i = 0; i < 200; i++) {
    css += `.c${i} > .item:not(.x${i}) span{color:red}\n.sec .c${i}{margin:1px}\n`;
  }
  for (let i = 0; i < wild; i++) {
    css += `main section ul li a[href*="${i}"]{padding:1px}\n`;
    css += `[class*="c${i}"] li:nth-child(${(i % 25) + 1}) > span{height:${i % 7}px}\n`;
    css += `.sec ~ .sec .item + .item *:not(.x${i}){margin-top:0}\n`;
    css += `div div div .c${i} *{border:0}\n`;
  }
  const style = document.createElement('style');
  style.textContent = css + extra;
  document.head.appendChild(style);
  return style;
}

// Run fn(i) for i in [0, n), one per task, then resolve.
function eachTask(n, fn) {
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (i === n) return resolve();
      fn(i++);
      setTimeout(tick, 0);
    };
    tick();
  });
}

const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

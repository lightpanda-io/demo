// Some CPU work per message, then answer.
onmessage = (e) => {
  let acc = 0;
  for (let i = 0; i < 2000; i++) acc = (acc * 31 + i) % 1000003;
  const parts = [];
  for (let i = 0; i < 50; i++) parts.push({ i, s: 'x'.repeat(i) });
  postMessage({ n: e.data.n, acc, size: JSON.stringify(parts).length });
};

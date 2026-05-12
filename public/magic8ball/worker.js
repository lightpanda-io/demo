const answers = [
	'It is certain.',
	'Without a doubt.',
	'Most likely.',
	'Outlook good.',
	'Yes, definitely.',
	'Signs point to yes.',
	'Reply hazy, try again.',
	'Ask again later.',
	'Cannot predict now.',
	"Don't count on it.",
	'My reply is no.',
	'Very doubtful.',
	'Outlook not so good.',
	'Concentrate and ask again.',
	'Absolutely not.',
	'The stars say yes.',
];

self.addEventListener('message', (event) => {
	const question = String(event.data || '');
	setTimeout(() => {
		const pick = answers[Math.floor(Math.random() * answers.length)];
		self.postMessage(pick);
	}, 0);
});

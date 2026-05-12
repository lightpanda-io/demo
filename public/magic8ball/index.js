const child = document.getElementById('child');
const answer = document.getElementById('answer');
const form = document.getElementById('ask-form');
const question = document.getElementById('question');

window.addEventListener('message', (event) => {
	if (event.source !== child.contentWindow) return;
	if (event.data && event.data.type === 'oracle-response') {
		answer.textContent = event.data.answer;
	}
});

form.addEventListener('submit', (e) => {
	e.preventDefault();
	const q = question.value.trim() || 'Will I be famous one day?';
	answer.textContent = '...';
	child.contentWindow.postMessage({ type: 'ask', question: q }, '*');
});
